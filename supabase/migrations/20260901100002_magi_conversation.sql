/*
  MAGI — conversation and memory.

  This is the part the previous build did not have at all: it called an OpenAI endpoint
  with the last few messages and no persistent understanding of the person. "Keeps their
  history and learns from them" needs two separate stores:

    message      — the verbatim transcript. Append-only. Never edited by MAGI.
    magi_memory  — what MAGI has concluded and had confirmed. Small, structured, and
                   entirely visible and editable by the user.

  Keeping them separate matters. A transcript is evidence; a memory is a claim. Users must
  be able to correct a claim without rewriting history, and MAGI must never treat her own
  inference as something the user said.

  Guardian access: none. There are deliberately no guardian policies on any table in this
  file. A guardian of a minor is notified that risk occurred (see magi_safety.sql); they
  cannot read the conversation. Surveillance would stop young people using the product
  honestly, which is the only way it helps them.
*/

CREATE TYPE message_author AS ENUM ('user', 'magi', 'system');

CREATE TYPE memory_kind AS ENUM (
  'fact',        -- "works shifts", "has two kids", "lives alone"
  'preference',  -- "prefers short replies in the morning"
  'boundary',    -- "do not mention her mother"  (hard constraint)
  'pattern',     -- "overwhelm tends to peak the day before her period"
  'goal',        -- "wants to get through a GP appointment without masking"
  'support',     -- "cold water on wrists actually works for her"
  'person'       -- someone in her life and how they figure
);

CREATE TYPE memory_state AS ENUM ('active', 'needs_confirming', 'retired', 'rejected');

-- ============================================================
-- CONVERSATION
-- ============================================================

CREATE TABLE conversation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  /* A short, user-editable label. MAGI proposes one; the user can change or clear it. */
  label text,
  /* Set when the user closes a thread. Nothing is ever auto-archived on a schedule. */
  archived_at timestamptz
);

CREATE INDEX conversation_account ON conversation (account_id, last_message_at DESC);

ALTER TABLE conversation ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversation_all_own ON conversation
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

-- ============================================================
-- MESSAGE
-- ============================================================

CREATE TABLE message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversation (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,

  author message_author NOT NULL,
  body text NOT NULL,

  /*
    Interpretation attached to a user message by the orchestrator. Stored so that a reply
    can always be explained after the fact — which intent matched, which tone was chosen,
    what risk tier applied. Without this, a bad reply is unauditable.
  */
  matched_intent_id text,
  matched_intent_score real,
  chosen_tone text,
  chosen_dbt_skill text,
  risk_tier text,

  /* Tool calls MAGI made on this turn, and their results. */
  tool_calls jsonb NOT NULL DEFAULT '[]'::jsonb,

  /* Model provenance, for reproducing or defending a specific reply. */
  model text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,

  /* Set if the user tells MAGI she got it wrong. Feeds tone tuning, not deletion. */
  user_feedback text CHECK (user_feedback IN ('helped', 'missed', 'wrong_tone', 'too_much')),

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_conversation ON message (conversation_id, created_at);
CREATE INDEX message_account_recent ON message (account_id, created_at DESC);
CREATE INDEX message_risk ON message (account_id, created_at DESC)
  WHERE risk_tier IS NOT NULL AND risk_tier <> 'none';

ALTER TABLE message ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_select_own ON message
  FOR SELECT TO authenticated USING (account_id = auth.uid());
CREATE POLICY message_insert_own ON message
  FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());
/*
  Only the feedback column is user-updatable in practice; the transcript itself is
  append-only. Enforced by trigger rather than column privileges so the error is legible.
*/
CREATE POLICY message_update_own ON message
  FOR UPDATE TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());
CREATE POLICY message_delete_own ON message
  FOR DELETE TO authenticated USING (account_id = auth.uid());

CREATE OR REPLACE FUNCTION magi_message_immutable_body()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.body <> OLD.body OR NEW.author <> OLD.author THEN
    RAISE EXCEPTION 'message body and author are append-only; delete the message instead';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER message_no_rewrite
  BEFORE UPDATE ON message
  FOR EACH ROW EXECUTE FUNCTION magi_message_immutable_body();

CREATE OR REPLACE FUNCTION magi_bump_conversation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE conversation
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER message_bumps_conversation
  AFTER INSERT ON message
  FOR EACH ROW EXECUTE FUNCTION magi_bump_conversation();

-- ============================================================
-- MAGI MEMORY
-- ============================================================

CREATE TABLE magi_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,

  kind memory_kind NOT NULL,
  /* Short stable handle, e.g. 'work.shift_pattern'. Lets MAGI update rather than duplicate. */
  key text NOT NULL,
  /* The claim, in plain language, phrased as MAGI would say it back to her. */
  value text NOT NULL,

  state memory_state NOT NULL DEFAULT 'needs_confirming',
  /*
    How this came to be known:
      'stated'    — she said it
      'inferred'  — MAGI concluded it and it has not been confirmed
      'observed'  — derived from logged data, e.g. a recurring pattern
    Only 'stated' memories are treated as certain. This distinction is the difference
    between a companion and a system that puts words in someone's mouth.
  */
  provenance text NOT NULL DEFAULT 'inferred'
    CHECK (provenance IN ('stated', 'inferred', 'observed')),
  confidence real NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),

  source_message_id uuid REFERENCES message (id) ON DELETE SET NULL,

  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_referenced_at timestamptz,
  confirmed_at timestamptz,
  /* When the user edits the wording, MAGI must use her wording verbatim thereafter. */
  user_edited_at timestamptz,
  retired_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (account_id, kind, key)
);

CREATE INDEX magi_memory_active
  ON magi_memory (account_id, kind)
  WHERE state = 'active';

COMMENT ON TABLE magi_memory IS
  'Everything MAGI has learned. Fully readable, editable and deletable by the user — this is both a UK GDPR requirement and the mechanism that makes her trustworthy.';

ALTER TABLE magi_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY magi_memory_all_own ON magi_memory
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

CREATE TRIGGER magi_memory_touch
  BEFORE UPDATE ON magi_memory
  FOR EACH ROW EXECUTE FUNCTION magi_touch_updated_at();

/*
  Audit trail for memory changes. A user who asks "why does MAGI think that?" gets a
  real answer, and a user who corrects something can see that it stuck.
*/
CREATE TABLE magi_memory_event (
  id bigserial PRIMARY KEY,
  memory_id uuid NOT NULL REFERENCES magi_memory (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN
    ('created', 'confirmed', 'rejected', 'edited', 'retired', 'referenced')),
  actor text NOT NULL CHECK (actor IN ('user', 'magi')),
  before_value text,
  after_value text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX magi_memory_event_memory ON magi_memory_event (memory_id, at DESC);

ALTER TABLE magi_memory_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY magi_memory_event_select_own ON magi_memory_event
  FOR SELECT TO authenticated USING (account_id = auth.uid());
CREATE POLICY magi_memory_event_insert_own ON magi_memory_event
  FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());
