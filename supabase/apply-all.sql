/*
  MAGI — all 8 migrations, in order, as one script.

  GENERATED FILE: run `python3 tools/build_combined_sql.py` to rebuild.

  How to use:
    1. Open the Supabase dashboard for the MAGI project -> SQL Editor -> New query.
    2. Paste this entire file and run it.
    3. Then, locally:  npm run embed:intents

  It is safe to run against an EMPTY project. It is NOT idempotent as a whole: the CREATE
  TYPE and CREATE TABLE statements will error on a second run. The seed data at the end is
  idempotent on its own (ON CONFLICT DO UPDATE), so re-seeding after a content change means
  running just the final section.

  Requires the `vector` extension, which Supabase provides. If the CREATE EXTENSION line
  fails, enable "vector" under Database -> Extensions first.

  One statement needs owner rights and will only work as the dashboard's postgres role:
  the trigger on auth.users that provisions an account row on sign-up.
*/



-- ==========================================================================
-- 20260901100000_magi_foundation.sql
-- ==========================================================================

/*
  MAGI — foundation: extensions, identity, consent and age assurance.

  Written for a clean Supabase project. It does not attempt to migrate the previous
  Bolt-generated schema; that schema keyed everything off a bespoke `users` table whose
  primary key defaulted to `auth.uid()`, which produced the two "fix_users_*" patch
  migrations and is unsafe under service-role writes. Here, identity is anchored directly
  on auth.users.

  Design commitments encoded below:
    * Under-18 users are in scope, so this is built to the ICO Age Appropriate Design Code:
      high-privacy defaults, data minimisation, explicit consent records, and no field that
      exists purely to profile a child.
    * Date of birth is stored once, for age assurance and guardian rules. Age *bands* are
      derived, never stored, so they cannot drift out of date.
    * A guardian can be linked to a minor's account, but a guardian has NO read access to
      conversation content. See the deliberate absence of guardian SELECT policies in
      20260901100002_magi_conversation.sql.
*/

-- pgcrypto for gen_random_uuid(); citext for case-insensitive emails.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE account_state AS ENUM (
  'pending_age_check',      -- signed up, age not yet established
  'pending_guardian',       -- minor, awaiting verified guardian consent
  'active',
  'suspended',
  'deletion_requested'
);

CREATE TYPE guardian_relationship AS ENUM (
  'parent', 'carer', 'guardian', 'other_trusted_adult'
);

CREATE TYPE guardian_consent_state AS ENUM (
  'invited', 'verified', 'declined', 'withdrawn', 'expired'
);

CREATE TYPE consent_kind AS ENUM (
  'terms',
  'privacy_notice',
  'health_data_processing',   -- UK GDPR Art.9 explicit consent
  'guardian_consent',
  'research_contribution',    -- entirely optional, off by default
  'push_notifications'
);

-- ============================================================
-- ACCOUNT
-- ============================================================

CREATE TABLE account (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email citext NOT NULL,
  state account_state NOT NULL DEFAULT 'pending_age_check',

  -- Age assurance. Stored to the day because guardian obligations change on a birthday.
  date_of_birth date,
  date_of_birth_confirmed_at timestamptz,

  -- Set when the user asks to be forgotten. A background job performs the erasure; the
  -- request is recorded so the 30-day statutory clock is auditable.
  deletion_requested_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dob_not_future CHECK (date_of_birth IS NULL OR date_of_birth <= CURRENT_DATE),
  CONSTRAINT dob_plausible CHECK (date_of_birth IS NULL OR date_of_birth >= CURRENT_DATE - INTERVAL '120 years')
);

COMMENT ON COLUMN account.date_of_birth IS
  'Age assurance under the ICO Age Appropriate Design Code. Derived age bands are computed on read; never denormalised.';

-- Age helpers. IMMUTABLE is deliberately avoided: age depends on the current date.
CREATE OR REPLACE FUNCTION magi_age(p_dob date)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_dob IS NULL THEN NULL
    ELSE date_part('year', age(CURRENT_DATE, p_dob))::integer
  END;
$$;

CREATE OR REPLACE FUNCTION magi_is_minor(p_dob date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE WHEN p_dob IS NULL THEN NULL ELSE magi_age(p_dob) < 18 END;
$$;

/*
  Age band, matching the bands used by the response taxonomy so retrieval filters line up
  with what the app knows about the user.
*/
CREATE OR REPLACE FUNCTION magi_age_band(p_dob date)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_dob IS NULL THEN NULL
    WHEN magi_age(p_dob) < 13 THEN 'under-13'
    WHEN magi_age(p_dob) <= 15 THEN '13-15'
    WHEN magi_age(p_dob) <= 18 THEN '16-18'
    WHEN magi_age(p_dob) <= 21 THEN '19-21'
    WHEN magi_age(p_dob) <= 25 THEN '22-25'
    WHEN magi_age(p_dob) <= 29 THEN '26-29'
    WHEN magi_age(p_dob) <= 34 THEN '30-34'
    WHEN magi_age(p_dob) <= 39 THEN '35-39'
    WHEN magi_age(p_dob) <= 44 THEN '40-44'
    WHEN magi_age(p_dob) <= 49 THEN '45-49'
    WHEN magi_age(p_dob) <= 55 THEN '50-55'
    ELSE '56-65+'
  END;
$$;

ALTER TABLE account ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_select_own ON account
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY account_update_own ON account
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Rows are created by the auth trigger below, never by the client.

CREATE OR REPLACE FUNCTION magi_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER account_touch
  BEFORE UPDATE ON account
  FOR EACH ROW EXECUTE FUNCTION magi_touch_updated_at();

/*
  Provision an account row when a user signs up. SECURITY DEFINER because the inserting
  role is the auth system, not the user. search_path is pinned to defeat search-path
  hijacking, which is the standard failure mode for SECURITY DEFINER functions.
*/
CREATE OR REPLACE FUNCTION magi_handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.account (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION magi_handle_new_auth_user();

-- ============================================================
-- GUARDIAN LINK
-- ============================================================

CREATE TABLE guardian_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minor_account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,

  guardian_name text NOT NULL,
  guardian_email citext NOT NULL,
  guardian_phone text,
  relationship guardian_relationship NOT NULL,

  state guardian_consent_state NOT NULL DEFAULT 'invited',

  -- Verification is by emailed token. The token itself is never stored in plaintext.
  verification_token_hash text,
  verification_sent_at timestamptz,
  verification_expires_at timestamptz,
  verified_at timestamptz,
  withdrawn_at timestamptz,

  /*
    What the guardian may receive. Deliberately narrow and not user-extensible:
    a guardian is told that their child is at risk, never what their child said.
  */
  notify_on_high_risk boolean NOT NULL DEFAULT true,
  notify_on_account_changes boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX guardian_link_one_active
  ON guardian_link (minor_account_id)
  WHERE state IN ('invited', 'verified');

CREATE INDEX guardian_link_minor ON guardian_link (minor_account_id);

ALTER TABLE guardian_link ENABLE ROW LEVEL SECURITY;

-- The young person can always see who is linked to their account and can revoke it.
CREATE POLICY guardian_link_select_own ON guardian_link
  FOR SELECT TO authenticated USING (minor_account_id = auth.uid());
CREATE POLICY guardian_link_insert_own ON guardian_link
  FOR INSERT TO authenticated WITH CHECK (minor_account_id = auth.uid());
CREATE POLICY guardian_link_update_own ON guardian_link
  FOR UPDATE TO authenticated USING (minor_account_id = auth.uid())
  WITH CHECK (minor_account_id = auth.uid());

CREATE TRIGGER guardian_link_touch
  BEFORE UPDATE ON guardian_link
  FOR EACH ROW EXECUTE FUNCTION magi_touch_updated_at();

COMMENT ON TABLE guardian_link IS
  'Guardian relationship for under-18 accounts. Guardians have no read access to conversation content anywhere in this schema — only the notification flags above.';

-- ============================================================
-- CONSENT RECORDS
-- ============================================================

CREATE TABLE consent_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  kind consent_kind NOT NULL,

  -- Version of the document consented to, so a policy change invalidates stale consent.
  document_version text NOT NULL,
  granted boolean NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,

  -- Where the consent was given, for evidential purposes. No IP address: not needed.
  surface text NOT NULL DEFAULT 'app',
  /* If a guardian gave this consent on the minor's behalf. */
  given_by_guardian_link_id uuid REFERENCES guardian_link (id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consent_record_account_kind
  ON consent_record (account_id, kind, granted_at DESC);

ALTER TABLE consent_record ENABLE ROW LEVEL SECURITY;

CREATE POLICY consent_select_own ON consent_record
  FOR SELECT TO authenticated USING (account_id = auth.uid());
CREATE POLICY consent_insert_own ON consent_record
  FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());
-- Consent history is append-only: withdrawal is a new row, never an edit.

/* Current state of each consent kind, newest row wins. */
CREATE OR REPLACE VIEW consent_current
WITH (security_invoker = true) AS
SELECT DISTINCT ON (account_id, kind)
  account_id, kind, document_version, granted, granted_at, withdrawn_at
FROM consent_record
ORDER BY account_id, kind, granted_at DESC;

-- ============================================================
-- DATA SUBJECT REQUESTS
-- ============================================================

CREATE TABLE data_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('export', 'erasure', 'rectification')),
  state text NOT NULL DEFAULT 'requested'
    CHECK (state IN ('requested', 'in_progress', 'fulfilled', 'refused')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz,
  /* Signed URL of the produced export, short-lived. */
  artefact_path text,
  note text
);

CREATE INDEX data_request_account ON data_request (account_id, requested_at DESC);

ALTER TABLE data_request ENABLE ROW LEVEL SECURITY;

CREATE POLICY data_request_select_own ON data_request
  FOR SELECT TO authenticated USING (account_id = auth.uid());
CREATE POLICY data_request_insert_own ON data_request
  FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());


-- ==========================================================================
-- 20260901100001_magi_profile.sql
-- ==========================================================================

/*
  MAGI — profile and personalisation.

  What MAGI is told about a person, as they described themselves. Everything here is
  optional; the app must work end to end with an empty profile, because asking a
  dysregulated person twenty onboarding questions is the failure mode this product exists
  to avoid.

  Note on special-category data: neurodivergence, hormone context and health conditions are
  UK GDPR Article 9 data. They are collected under explicit consent, recorded in
  consent_record with kind = 'health_data_processing', and every one of these columns is
  nullable so that consent can be withdrawn by nulling the data rather than deleting the
  account.
*/

CREATE TYPE support_style AS ENUM (
  'brief',            -- fewest words possible
  'warm',             -- validation first
  'practical',        -- give me the step
  'curious'           -- ask me questions, help me think
);

CREATE TYPE reminder_style AS ENUM ('none', 'gentle', 'specific');

CREATE TABLE profile (
  account_id uuid PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,

  -- Identity, as they give it
  preferred_name text,
  pronouns text,

  /*
    Neurotypes as self-described, matching magi/taxonomy.ts NEUROTYPES, plus free text.
    Self-identification is accepted without diagnosis: a large share of neurodivergent
    women are undiagnosed, and gating support on a diagnosis would exclude them.
  */
  neurotypes text[] NOT NULL DEFAULT '{}',
  neurotype_note text,
  self_identified_only boolean,

  /* Hormone context, matching HORMONE_PHASES plus cycle tracking opt-in. */
  hormone_context text[] NOT NULL DEFAULT '{}',
  tracks_cycle boolean NOT NULL DEFAULT false,
  typical_cycle_length_days smallint
    CHECK (typical_cycle_length_days IS NULL
           OR typical_cycle_length_days BETWEEN 15 AND 90),

  life_stage text,
  health_conditions text[] NOT NULL DEFAULT '{}',

  /* How MAGI should talk to her. */
  support_style support_style NOT NULL DEFAULT 'warm',
  reminder_style reminder_style NOT NULL DEFAULT 'none',
  /* Subjects MAGI must not raise unprompted. Honoured absolutely. */
  off_limits_topics text[] NOT NULL DEFAULT '{}',
  /* Words she has asked MAGI not to use — e.g. clinical labels, "should", "just". */
  avoid_words text[] NOT NULL DEFAULT '{}',

  /* Sensory and interaction needs that change how the UI behaves, not just how it looks. */
  sensory_notes text,

  onboarding_completed_at timestamptz,
  /* Last time MAGI confirmed the profile was still accurate. Prompts a light re-check. */
  last_reviewed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN profile.off_limits_topics IS
  'Hard constraint passed into every MAGI turn. She never raises these unprompted, and never as a "gentle check-in".';

ALTER TABLE profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY profile_select_own ON profile
  FOR SELECT TO authenticated USING (account_id = auth.uid());
CREATE POLICY profile_insert_own ON profile
  FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());
CREATE POLICY profile_update_own ON profile
  FOR UPDATE TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());
CREATE POLICY profile_delete_own ON profile
  FOR DELETE TO authenticated USING (account_id = auth.uid());

CREATE TRIGGER profile_touch
  BEFORE UPDATE ON profile
  FOR EACH ROW EXECUTE FUNCTION magi_touch_updated_at();

/* Create an empty profile alongside the account so the app never has to handle its absence. */
CREATE OR REPLACE FUNCTION magi_provision_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profile (account_id) VALUES (NEW.id)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER account_provision_profile
  AFTER INSERT ON account
  FOR EACH ROW EXECUTE FUNCTION magi_provision_profile();

-- ============================================================
-- SYNCED ACCESSIBILITY PREFERENCES
-- ============================================================
/*
  Accessibility preferences live on the device first (AsyncStorage) so the app is usable
  before any network call. This table mirrors them so a user who has painstakingly tuned
  text size and contrast does not lose that when they change phone.
*/
CREATE TABLE ui_preference (
  account_id uuid PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ui_preference ENABLE ROW LEVEL SECURITY;

CREATE POLICY ui_pref_select_own ON ui_preference
  FOR SELECT TO authenticated USING (account_id = auth.uid());
CREATE POLICY ui_pref_upsert_own ON ui_preference
  FOR INSERT TO authenticated WITH CHECK (account_id = auth.uid());
CREATE POLICY ui_pref_update_own ON ui_preference
  FOR UPDATE TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

CREATE TRIGGER ui_preference_touch
  BEFORE UPDATE ON ui_preference
  FOR EACH ROW EXECUTE FUNCTION magi_touch_updated_at();


-- ==========================================================================
-- 20260901100002_magi_conversation.sql
-- ==========================================================================

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


-- ==========================================================================
-- 20260901100003_magi_tracking.sql
-- ==========================================================================

/*
  MAGI — tracking.

  Two principles from the research table drive the shape of this:

    "Experiences are messy and do not fit neatly into checkboxes."
    "User can choose what to track and turn tracking off without losing functionality."

  So tracking is long-format, not a wide table of columns. Adding a new trackable signal is
  a row in `signal_definition`, not a migration, and a user who tracks nothing simply has
  no rows — no half-empty check-in records, no gaps to feel guilty about.

  The 32 signals from the MAGI starter data framework are seeded in
  20260901100007_magi_seed.sql. Nineteen of them are High privacy; every one is optional.
*/

CREATE TYPE signal_value_type AS ENUM ('scale', 'numeric', 'boolean', 'text', 'set');

CREATE TABLE signal_definition (
  id text PRIMARY KEY,                     -- e.g. 'daily_mood_rating'
  label text NOT NULL,                     -- as shown to the user
  category text NOT NULL,
  subcategory text,
  value_type signal_value_type NOT NULL,
  scale_min smallint,
  scale_max smallint,
  unit text,
  /* 'high' signals are Article 9 health data and require health_data_processing consent. */
  privacy_level text NOT NULL DEFAULT 'medium'
    CHECK (privacy_level IN ('low', 'medium', 'high')),
  /* Whether a recognised clinical standard exists — matters for healthcare summaries. */
  clinical_standard text,
  /* Ordering hint for the tracking sheet. Lower appears first. */
  display_order integer NOT NULL DEFAULT 100,
  /* Signals MAGI may offer during onboarding rather than waiting to be asked. */
  offer_early boolean NOT NULL DEFAULT false,
  retired boolean NOT NULL DEFAULT false
);

COMMENT ON TABLE signal_definition IS
  'Catalogue of trackable signals. Reference data, readable by all authenticated users, writable only by service role.';

ALTER TABLE signal_definition ENABLE ROW LEVEL SECURITY;
CREATE POLICY signal_definition_read ON signal_definition
  FOR SELECT TO authenticated USING (retired = false);

/* Which signals this user has actually chosen to track. Empty is a valid, supported state. */
CREATE TABLE signal_subscription (
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  signal_id text NOT NULL REFERENCES signal_definition (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, signal_id)
);

ALTER TABLE signal_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY signal_subscription_all_own ON signal_subscription
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

-- ============================================================
-- CHECK-IN
-- ============================================================
/*
  A check-in is a lightweight container with a timestamp and an optional note. Its values
  live in signal_reading. Every field is nullable: the acceptance criterion is that a user
  can "open the app, log something meaningful, and exit within 30–60 seconds", which means
  one tap must be able to produce a valid check-in.
*/
CREATE TABLE check_in (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,

  /* Local calendar day as the user experiences it, not UTC. Set by the client. */
  local_date date NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  /* The one-tap answer. Everything else is optional detail. */
  overall text CHECK (overall IN ('rough', 'low', 'ok', 'good', 'bright')),

  note text,
  /* Set when the entry came from a voice note rather than typing. Voice-ready, per scope. */
  source text NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice', 'magi_prompted')),
  /* True when MAGI created this from something said in conversation, with the user's nod. */
  captured_by_magi boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now()
);

/* At most one primary check-in per local day, but the note can be appended to. */
CREATE UNIQUE INDEX check_in_one_per_day ON check_in (account_id, local_date);
CREATE INDEX check_in_recent ON check_in (account_id, local_date DESC);

ALTER TABLE check_in ENABLE ROW LEVEL SECURITY;
CREATE POLICY check_in_all_own ON check_in
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

-- ============================================================
-- SIGNAL READING
-- ============================================================

CREATE TABLE signal_reading (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  signal_id text NOT NULL REFERENCES signal_definition (id) ON DELETE CASCADE,
  check_in_id uuid REFERENCES check_in (id) ON DELETE CASCADE,

  local_date date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),

  value_numeric numeric,
  value_boolean boolean,
  value_text text,
  value_set text[],

  captured_by_magi boolean NOT NULL DEFAULT false,

  CONSTRAINT one_value_present CHECK (
    (value_numeric IS NOT NULL)::int
  + (value_boolean IS NOT NULL)::int
  + (value_text    IS NOT NULL)::int
  + (value_set     IS NOT NULL)::int = 1
  )
);

CREATE INDEX signal_reading_lookup
  ON signal_reading (account_id, signal_id, local_date DESC);
CREATE INDEX signal_reading_check_in ON signal_reading (check_in_id);

ALTER TABLE signal_reading ENABLE ROW LEVEL SECURITY;
CREATE POLICY signal_reading_all_own ON signal_reading
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

-- ============================================================
-- EXPERIENCE NOTE  (the "dump" mode)
-- ============================================================
/*
  Unstructured capture. The research finding is explicit: forcing structure at the point of
  entry is the thing that stops people logging at all. This table takes whatever arrives.
  Structure, if any, is added later by MAGI and stored alongside — never in place of — the
  original words.
*/
CREATE TABLE experience_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,

  body text NOT NULL,
  local_date date NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  source text NOT NULL DEFAULT 'text' CHECK (source IN ('text', 'voice')),
  /* Free tags the user typed. Not a controlled vocabulary. */
  tags text[] NOT NULL DEFAULT '{}',

  /* MAGI's later reading of it. Advisory, and visibly separate from `body`. */
  magi_summary text,
  magi_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  magi_reviewed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX experience_note_recent ON experience_note (account_id, local_date DESC);

ALTER TABLE experience_note ENABLE ROW LEVEL SECURITY;
CREATE POLICY experience_note_all_own ON experience_note
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

-- ============================================================
-- CYCLE
-- ============================================================
/*
  Cycle tracking is opt-in (profile.tracks_cycle) and phase is *estimated*, never asserted.
  Estimates are computed on read from logged events so that a corrected event immediately
  corrects the history, rather than leaving a stale denormalised phase behind.
*/
CREATE TABLE cycle_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN
    ('period_start', 'period_end', 'spotting', 'ovulation_signs', 'hrt_change', 'note')),
  local_date date NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cycle_event_recent ON cycle_event (account_id, local_date DESC);

ALTER TABLE cycle_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY cycle_event_all_own ON cycle_event
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

/*
  Estimated cycle day for a given date, from the most recent prior period_start.
  Returns NULL when there is nothing to base it on — MAGI must handle "I don't know yet"
  rather than guessing.
*/
CREATE OR REPLACE FUNCTION magi_cycle_day(p_account uuid, p_date date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT (p_date - ce.local_date)::integer + 1
    FROM cycle_event ce
   WHERE ce.account_id = p_account
     AND ce.kind = 'period_start'
     AND ce.local_date <= p_date
   ORDER BY ce.local_date DESC
   LIMIT 1;
$$;


-- ==========================================================================
-- 20260901100004_magi_support.sql
-- ==========================================================================

/*
  MAGI — challenges, insights and healthcare summaries.

  Three explicit non-goals from the brief shape this file:
    * no gamification or streaks
    * no diagnosis
    * no speaking for the user

  So: a challenge has no streak column and no consecutive-days counter — there is nowhere
  to store one, which is the most reliable way to ensure the feature never grows one. An
  insight is a prompt for reflection that the user can reject. A healthcare summary is a
  draft the user edits and owns.
*/

CREATE TYPE challenge_state AS ENUM (
  'offered',    -- MAGI put it on the table
  'accepted',   -- she said yes
  'done',
  'part_done',  -- explicitly first-class: partial is a real outcome, not a failure
  'skipped',    -- passed on it, no consequence
  'declined',   -- not for me, don't offer again
  'expired'     -- quietly aged out, never mentioned
);

CREATE TABLE challenge_template (
  id text PRIMARY KEY,
  title text NOT NULL,
  /* One sentence, second person, no imperative pressure. */
  invitation text NOT NULL,
  detail text,

  category text NOT NULL,           -- ScenarioCategory from magi/taxonomy.ts
  dbt_skill text,                   -- optional; many are simply practical
  /* Effort as the user would judge it, not as a designer would. */
  effort smallint NOT NULL DEFAULT 1 CHECK (effort BETWEEN 1 AND 3),
  minutes smallint,
  /* How much sensory input it demands: some days the answer must be "none". */
  sensory_load smallint NOT NULL DEFAULT 1 CHECK (sensory_load BETWEEN 1 AND 3),
  /* Can it be done lying down, in the dark, without speaking? Matters more than it sounds. */
  low_capacity_safe boolean NOT NULL DEFAULT false,
  somatic boolean NOT NULL DEFAULT false,

  /* Neurotypes this suits particularly well. Empty means generally applicable. */
  suits_neurotypes text[] NOT NULL DEFAULT '{}',
  /* Minimum age this is appropriate for. */
  min_age smallint NOT NULL DEFAULT 13,

  retired boolean NOT NULL DEFAULT false
);

ALTER TABLE challenge_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY challenge_template_read ON challenge_template
  FOR SELECT TO authenticated USING (retired = false);

CREATE TABLE challenge_instance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  template_id text REFERENCES challenge_template (id) ON DELETE SET NULL,

  /* MAGI may compose a one-off instead of using the library. Stored verbatim if so. */
  title text NOT NULL,
  invitation text NOT NULL,
  detail text,

  state challenge_state NOT NULL DEFAULT 'offered',

  offered_at timestamptz NOT NULL DEFAULT now(),
  /* Why she offered it now. Shown to the user on request; never hidden reasoning. */
  offered_because text,
  responded_at timestamptz,
  completed_at timestamptz,

  /* The user's own words on how it went. Optional. */
  reflection text,
  /* Did it help? Three-way, because "not sure" is the honest answer much of the time. */
  helped boolean,

  /* Suppresses re-offering. Set when state = 'declined'. */
  never_offer_again boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX challenge_instance_open
  ON challenge_instance (account_id, offered_at DESC)
  WHERE state IN ('offered', 'accepted');
CREATE INDEX challenge_instance_history
  ON challenge_instance (account_id, completed_at DESC);

ALTER TABLE challenge_instance ENABLE ROW LEVEL SECURITY;
CREATE POLICY challenge_instance_all_own ON challenge_instance
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

CREATE TRIGGER challenge_instance_touch
  BEFORE UPDATE ON challenge_instance
  FOR EACH ROW EXECUTE FUNCTION magi_touch_updated_at();

-- ============================================================
-- INSIGHT
-- ============================================================
/*
  Acceptance criterion from the UX heuristics: 'Language uses "you may notice..." rather
  than definitive statements', and 'user can accept/reject insights'. Both are enforced
  structurally: `observation` is required to be phrased tentatively (checked in the
  orchestrator, which has the model available to judge it), and `state` starts as 'proposed'.
*/
CREATE TABLE insight (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,

  observation text NOT NULL,
  /* The evidence, so the user can check MAGI's working. */
  based_on jsonb NOT NULL DEFAULT '{}'::jsonb,
  /* Window the observation covers. */
  period_start date,
  period_end date,

  state text NOT NULL DEFAULT 'proposed'
    CHECK (state IN ('proposed', 'accepted', 'rejected', 'dismissed')),
  /* When rejected, the user may say why. This is the single most useful correction signal. */
  rejected_reason text,

  /* Never set for anything resembling a diagnosis. Enforced in the orchestrator. */
  category text,

  surfaced_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX insight_pending ON insight (account_id, created_at DESC)
  WHERE state = 'proposed';

ALTER TABLE insight ENABLE ROW LEVEL SECURITY;
CREATE POLICY insight_all_own ON insight
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

-- ============================================================
-- HEALTHCARE SUMMARY
-- ============================================================
/*
  The core beta feature. A user picks a timeframe, tone and level of detail; MAGI drafts;
  the user edits; the user exports. `body` is the user's document from the moment it is
  created — MAGI's original draft is kept separately in `draft_body` so the difference
  between what she wrote and what the user chose to say is always visible.
*/
CREATE TABLE healthcare_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,

  purpose text NOT NULL CHECK (purpose IN
    ('gp_appointment', 'referral', 'workplace', 'education', 'self', 'other')),
  audience_note text,

  period_start date NOT NULL,
  period_end date NOT NULL,
  /* 'bullets' | 'timeline' | 'letter' | 'symptom_table' */
  format text NOT NULL DEFAULT 'bullets',
  detail_level text NOT NULL DEFAULT 'standard'
    CHECK (detail_level IN ('brief', 'standard', 'full')),
  tone text NOT NULL DEFAULT 'plain'
    CHECK (tone IN ('plain', 'clinical', 'personal')),

  /* What MAGI produced. Immutable once written, for comparison. */
  draft_body text NOT NULL,
  /* What the user is actually taking to the appointment. Theirs to change. */
  body text NOT NULL,
  edited_at timestamptz,

  /* Which records fed the draft, so a clinician can ask "where is this from?". */
  sources jsonb NOT NULL DEFAULT '{}'::jsonb,

  exported_at timestamptz,
  export_format text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT period_ordered CHECK (period_end >= period_start)
);

CREATE INDEX healthcare_summary_recent
  ON healthcare_summary (account_id, created_at DESC);

ALTER TABLE healthcare_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY healthcare_summary_all_own ON healthcare_summary
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

CREATE TRIGGER healthcare_summary_touch
  BEFORE UPDATE ON healthcare_summary
  FOR EACH ROW EXECUTE FUNCTION magi_touch_updated_at();

CREATE OR REPLACE FUNCTION magi_summary_draft_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.draft_body <> OLD.draft_body THEN
    RAISE EXCEPTION 'draft_body is immutable; edit body instead so the original draft stays comparable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER healthcare_summary_protect_draft
  BEFORE UPDATE ON healthcare_summary
  FOR EACH ROW EXECUTE FUNCTION magi_summary_draft_immutable();


-- ==========================================================================
-- 20260901100005_magi_safety.sql
-- ==========================================================================

/*
  MAGI — safety.

  Every turn is assessed and, where the assessment is anything other than 'none', recorded.
  The record exists for three reasons: so a clinician reviewing an incident can see exactly
  what MAGI knew and did; so the lexicon and model can be tuned against real misses rather
  than guesses; and because a product serving 13-year-olds needs to be able to evidence its
  own behaviour.

  The two assessments are stored separately and never collapsed. If the lexicon fired and
  the model did not, that disagreement is the most interesting row in the table.
*/

CREATE TABLE risk_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  message_id uuid REFERENCES message (id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversation (id) ON DELETE SET NULL,

  /* The tier acted upon: the higher of the two assessments below. */
  tier text NOT NULL CHECK (tier IN ('monitor', 'elevated', 'high', 'imminent')),

  lexicon_tier text,
  lexicon_reasons text[] NOT NULL DEFAULT '{}',
  /* Matched fragments. Never shown to the user; retained for tuning and review. */
  lexicon_matches text[] NOT NULL DEFAULT '{}',
  lexicon_flagged_historical boolean NOT NULL DEFAULT false,

  model_tier text,
  model_rationale text,
  model_name text,

  /* Age at the moment of the event — guardian duties depend on it and ages change. */
  age_at_event smallint,

  /* What MAGI actually did, so the protocol can be verified after the fact. */
  offered_resources boolean NOT NULL DEFAULT false,
  included_emergency boolean NOT NULL DEFAULT false,
  suppressed_features boolean NOT NULL DEFAULT false,
  pinned_support_panel boolean NOT NULL DEFAULT false,
  resource_ids text[] NOT NULL DEFAULT '{}',

  /* Did the user engage with what was offered? Nothing is inferred beyond a tap. */
  user_opened_resource text,
  user_dismissed boolean NOT NULL DEFAULT false,

  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX risk_event_account ON risk_event (account_id, occurred_at DESC);
CREATE INDEX risk_event_tier ON risk_event (tier, occurred_at DESC);
/* Rows where the two assessments disagreed — the tuning queue. */
CREATE INDEX risk_event_disagreement ON risk_event (occurred_at DESC)
  WHERE lexicon_tier IS DISTINCT FROM model_tier;

ALTER TABLE risk_event ENABLE ROW LEVEL SECURITY;

/*
  The user can see her own risk history. This is deliberate: a person is entitled to know
  what a system has recorded about her, and hiding it would make the app feel like it was
  reporting on her. Inserts come from the orchestrator under the service role.
*/
CREATE POLICY risk_event_select_own ON risk_event
  FOR SELECT TO authenticated USING (account_id = auth.uid());
CREATE POLICY risk_event_update_own_engagement ON risk_event
  FOR UPDATE TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

-- ============================================================
-- GUARDIAN NOTIFICATION
-- ============================================================
/*
  Sent only for under-18 accounts, only at tier 'high' or 'imminent', and the young person
  is always told it is happening — before it happens where there is any way to do so.
  Covert notification would be a betrayal and would also make the app unsafe, because she
  would stop telling MAGI the truth.

  Content is deliberately minimal: that concern arose, when, and what to do. Never the
  message text, never MAGI's reply.
*/
CREATE TABLE guardian_notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  guardian_link_id uuid NOT NULL REFERENCES guardian_link (id) ON DELETE CASCADE,
  risk_event_id uuid REFERENCES risk_event (id) ON DELETE SET NULL,

  reason text NOT NULL CHECK (reason IN ('high_risk', 'imminent_risk', 'account_change')),
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),

  /* Was the young person told, and when. Absence of a value here is a compliance failure. */
  user_informed_at timestamptz,
  user_informed_before_send boolean NOT NULL DEFAULT false,

  sent_at timestamptz,
  delivery_state text NOT NULL DEFAULT 'queued'
    CHECK (delivery_state IN ('queued', 'sent', 'failed', 'suppressed')),
  failure_reason text,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX guardian_notification_account
  ON guardian_notification (account_id, created_at DESC);

ALTER TABLE guardian_notification ENABLE ROW LEVEL SECURITY;

/* The young person can see every notification sent about her. The guardian cannot query this table. */
CREATE POLICY guardian_notification_select_own ON guardian_notification
  FOR SELECT TO authenticated USING (account_id = auth.uid());

COMMENT ON TABLE guardian_notification IS
  'Audit of guardian alerts. Content is limited to the fact of concern — never conversation text. The subject can always read her own row.';

-- ============================================================
-- SAFETY PLAN
-- ============================================================
/*
  Written by the user, in calm moments, for use in bad ones. MAGI can help draft it but
  the wording is the user's. Reachable from the persistent support panel without a network
  call, so it must be cached client-side too.
*/
CREATE TABLE safety_plan (
  account_id uuid PRIMARY KEY REFERENCES account (id) ON DELETE CASCADE,

  warning_signs text,
  what_helps text,
  what_does_not_help text,
  /* People she would contact, in her own order of preference. */
  contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* Anything she wants MAGI to say to her, in her own words. */
  message_to_self text,
  /* Things she wants MAGI to avoid saying when she is in crisis. Honoured absolutely. */
  do_not_say text[] NOT NULL DEFAULT '{}',

  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE safety_plan ENABLE ROW LEVEL SECURITY;
CREATE POLICY safety_plan_all_own ON safety_plan
  FOR ALL TO authenticated USING (account_id = auth.uid())
  WITH CHECK (account_id = auth.uid());

CREATE TRIGGER safety_plan_touch
  BEFORE UPDATE ON safety_plan
  FOR EACH ROW EXECUTE FUNCTION magi_touch_updated_at();


-- ==========================================================================
-- 20260901100006_magi_retrieval.sql
-- ==========================================================================

/*
  MAGI — scenario retrieval.

  The 80 intents distilled from the training dataset, with embeddings, so that a user's
  actual words can be matched to a scenario whose tone and skill mapping has been reviewed.

  Why only 80 rows: the source workbook has 70,400, but they are one intent crossed with
  10 neurotypes x 8 hormone phases x 11 age groups. Embedding all of them would cost
  roughly 880x more, return 880 near-identical neighbours for every query, and inject
  generated context suffixes that are frequently nonsense for the user in front of us
  (rows pair 'Postmenopause' with 'dealing with puberty'). The attribute grid is applied as
  metadata at query time instead, from what MAGI actually knows about this user.

  `needIntensity` here governs how much support to offer. It has no bearing on risk;
  risk is assessed independently. See magi/risk.ts.
*/

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE scenario_intent (
  id text PRIMARY KEY,
  phrase text NOT NULL,
  category text NOT NULL,
  need_intensity smallint NOT NULL CHECK (need_intensity BETWEEN 1 AND 5),
  dbt_skill text NOT NULL,
  tone text NOT NULL,
  somatic boolean NOT NULL DEFAULT false,

  /* Hand-written alternative phrasings, to widen recall beyond the single seed phrase. */
  paraphrases text[] NOT NULL DEFAULT '{}',

  /* text-embedding-3-small. Dimension is pinned; changing provider requires a migration. */
  embedding vector(1536),

  /* Clinical review status. An intent with review_state 'pending' is still usable but is
     reported in the safety dashboard as unreviewed. */
  review_state text NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending', 'approved', 'flagged', 'withdrawn')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

/*
  ivfflat needs a populated table to build good lists, and 80 rows do not warrant an index
  at all — a sequential scan over 80 vectors is faster than an index probe. Left unindexed
  deliberately; add HNSW only if the intent library grows past a few thousand rows.
*/
CREATE INDEX scenario_intent_category ON scenario_intent (category);

ALTER TABLE scenario_intent ENABLE ROW LEVEL SECURITY;
CREATE POLICY scenario_intent_read ON scenario_intent
  FOR SELECT TO authenticated USING (review_state <> 'withdrawn');

CREATE TRIGGER scenario_intent_touch
  BEFORE UPDATE ON scenario_intent
  FOR EACH ROW EXECUTE FUNCTION magi_touch_updated_at();

/*
  Nearest intents for a query embedding. SECURITY INVOKER so RLS still applies; withdrawn
  intents are therefore invisible here too.
*/
CREATE OR REPLACE FUNCTION magi_match_intents(
  p_embedding vector(1536),
  p_limit integer DEFAULT 5,
  p_category_filter text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  phrase text,
  category text,
  need_intensity smallint,
  dbt_skill text,
  tone text,
  somatic boolean,
  similarity real
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT si.id, si.phrase, si.category, si.need_intensity, si.dbt_skill, si.tone, si.somatic,
         (1 - (si.embedding <=> p_embedding))::real AS similarity
    FROM scenario_intent si
   WHERE si.embedding IS NOT NULL
     AND (p_category_filter IS NULL OR si.category = p_category_filter)
   ORDER BY si.embedding <=> p_embedding
   LIMIT GREATEST(1, LEAST(p_limit, 20));
$$;

/*
  Retrieval audit. Records what was retrieved for a turn and whether MAGI's reply actually
  followed it, which is the only way to tell whether the retrieval layer is earning its keep.
*/
CREATE TABLE retrieval_trace (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  message_id uuid REFERENCES message (id) ON DELETE CASCADE,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  chosen_intent_id text,
  chosen_similarity real,
  /* Set when the orchestrator overrode retrieval — e.g. risk forced the crisis tone. */
  override_reason text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX retrieval_trace_account ON retrieval_trace (account_id, at DESC);

ALTER TABLE retrieval_trace ENABLE ROW LEVEL SECURITY;
CREATE POLICY retrieval_trace_select_own ON retrieval_trace
  FOR SELECT TO authenticated USING (account_id = auth.uid());


-- ==========================================================================
-- 20260901100007_magi_seed.sql
-- ==========================================================================

/*
  MAGI — seed data.  GENERATED FILE: run `python3 tools/generate_seed.py` to regenerate.

  Sources:
    magi/data/trackable-signals.json  (31 signals, from the MAGI starter data framework)
    magi/data/intents.json            (80 intents, distilled from the training dataset)
    magi/data/challenges.json         (36 challenges, authored for this build)

  Embeddings are NOT seeded here — vectors do not belong in version-controlled SQL. Run
  `npm run embed:intents` against the target project after applying migrations; it fills
  scenario_intent.embedding and is idempotent.

  All three tables are reference data: readable by any authenticated user, writable only
  by the service role. ON CONFLICT DO UPDATE so re-running is safe.
*/

-- ============================================================
-- TRACKABLE SIGNALS
-- ============================================================

INSERT INTO signal_definition
  (id, label, category, subcategory, value_type, scale_min, scale_max, unit,
   privacy_level, clinical_standard, display_order, offer_early)
VALUES
  ('cycle_length_days', 'Cycle Length (Days)', 'Hormones and Cycle', 'Menstrual Cycle', 'numeric'::signal_value_type, NULL, NULL, NULL, 'high', 'Yes (ICD-11)', 10, true),
  ('hot_flush_frequency', 'Hot Flush Frequency', 'Hormones and Cycle', 'Menopause Symptoms', 'numeric'::signal_value_type, NULL, NULL, NULL, 'high', 'Partial (ICD-11)', 11, true),
  ('task_initiation_difficulty', 'Task Initiation Difficulty', 'Neurodivergence Specific', 'Executive Function', 'scale'::signal_value_type, 1, 5, NULL, 'medium', NULL, 12, true),
  ('overwhelm_from_crowds', 'Overwhelm from Crowds', 'Neurodivergence Specific', 'Sensory Overload', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 13, true),
  ('daily_mood_rating', 'Daily Mood Rating', 'Mental Health', 'Mood', 'scale'::signal_value_type, 1, 10, NULL, 'high', 'Partial (ICD-11)', 14, true),
  ('emotional_exhaustion_rating', 'Emotional Exhaustion Rating', 'Mental Health', 'Burnout', 'scale'::signal_value_type, 1, 10, NULL, 'high', NULL, 15, true),
  ('diagnosed_conditions', 'Diagnosed Conditions', 'Physical Health', 'Chronic Conditions', 'set'::signal_value_type, NULL, NULL, NULL, 'high', 'Yes (SNOMED)', 16, true),
  ('pain_score_0_10', 'Pain Score (0-10)', 'Physical Health', 'Pain Levels', 'numeric'::signal_value_type, NULL, NULL, NULL, 'high', 'Partial (Pain Scales)', 17, true),
  ('daily_fruit_veg_intake', 'Daily Fruit/Veg Intake', 'Lifestyle', 'Nutrition', 'numeric'::signal_value_type, NULL, NULL, NULL, 'low', NULL, 68, false),
  ('daily_steps', 'Daily Steps', 'Lifestyle', 'Movement', 'numeric'::signal_value_type, NULL, NULL, NULL, 'low', NULL, 69, false),
  ('sleep_duration_hours', 'Sleep Duration (Hours)', 'Sleep', 'Sleep Quality', 'numeric'::signal_value_type, NULL, NULL, NULL, 'medium', 'Partial (Sleep Studies)', 20, true),
  ('sleep_disruptions_per_night', 'Sleep Disruptions per Night', 'Sleep', 'Sleep Disruptions', 'numeric'::signal_value_type, NULL, NULL, NULL, 'medium', 'Partial (Sleep Studies)', 21, true),
  ('anger_spike_occurrence', 'Anger Spike Occurrence', 'Emotions', 'Anger Spikes', 'boolean'::signal_value_type, NULL, NULL, NULL, 'medium', NULL, 72, false),
  ('joy_burst_occurrence', 'Joy Burst Occurrence', 'Emotions', 'Joy Bursts', 'boolean'::signal_value_type, NULL, NULL, NULL, 'medium', NULL, 73, false),
  ('level_of_money_anxiety', 'Level of Money Anxiety', 'Financial Health', 'Money Anxiety', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 74, false),
  ('progress_towards_goal', 'Progress Towards Goal (%)', 'Financial Health', 'Financial Independence Goals', 'numeric'::signal_value_type, 0, 100, NULL, 'medium', NULL, 105, false),
  ('feeling_of_loneliness_1_5', 'Feeling of Loneliness (1-5)', 'Social and Relationships', 'Loneliness', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 76, false),
  ('support_quality_1_5', 'Support Quality (1-5)', 'Social and Relationships', 'Support System', 'scale'::signal_value_type, 1, 5, NULL, 'medium', NULL, 107, false),
  ('sensitivity_to_loud_sounds', 'Sensitivity to Loud Sounds', 'Environmental Triggers', 'Noise Sensitivity', 'scale'::signal_value_type, 1, 5, NULL, 'medium', NULL, 78, false),
  ('sensitivity_to_bright_lights', 'Sensitivity to Bright Lights', 'Environmental Triggers', 'Light Sensitivity', 'scale'::signal_value_type, 1, 5, NULL, 'medium', NULL, 79, false),
  ('difficulty_making_decisions', 'Difficulty Making Decisions', 'Cognitive Load', 'Decision Fatigue', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 80, false),
  ('stress_from_task_switching', 'Stress from Task Switching', 'Cognitive Load', 'Task Switching Stress', 'scale'::signal_value_type, 1, 5, NULL, 'high', NULL, 111, false),
  ('daily_overwhelm_rating', 'Daily Overwhelm Rating', 'Custom MAGI Factors', 'Overwhelm Meter', 'scale'::signal_value_type, 1, 10, NULL, 'high', NULL, 32, true),
  ('nervous_system_load_self_rating', 'Nervous System Load Self-Rating', 'Custom MAGI Factors', 'Nervous System Load', 'scale'::signal_value_type, 1, 10, NULL, 'high', NULL, 33, true),
  ('working_memory_fluctuations', 'Working Memory Fluctuations', 'Hormones & Neurodivergence', 'Cognitive Function', 'scale'::signal_value_type, 1, 10, NULL, 'high', NULL, 54, false),
  ('pmdd_symptom_severity', 'PMDD Symptom Severity', 'Reproductive Health', 'PMDD', 'scale'::signal_value_type, 1, 10, NULL, 'high', 'Yes (ICD-10: N94.3)', 35, true),
  ('menstrual_irregularity', 'Menstrual Irregularity', 'Reproductive Health', 'PCOS', 'boolean'::signal_value_type, NULL, NULL, NULL, 'high', 'Yes (ICD-10: E28.2)', 56, false),
  ('pelvic_pain_frequency', 'Pelvic Pain Frequency', 'Reproductive Health', 'Endometriosis', 'scale'::signal_value_type, 1, 10, NULL, 'high', 'Yes (ICD-10: N80)', 57, false),
  ('workplace_stress_rating', 'Workplace Stress Rating', 'Social Determinants', 'Work & Employment', 'scale'::signal_value_type, 1, 10, NULL, 'medium', NULL, 59, false),
  ('current_pregnancy_status', 'Current Pregnancy Status', 'Reproductive Health', 'Pregnancy', 'boolean'::signal_value_type, NULL, NULL, NULL, 'high', 'Yes (ICD-10: Z34-Z39)', 60, false),
  ('postpartum_mood_rating', 'Postpartum Mood Rating', 'Reproductive Health', 'Postpartum', 'scale'::signal_value_type, 1, 10, NULL, 'high', 'Yes (ICD-10: F53)', 61, false)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  subcategory = EXCLUDED.subcategory,
  value_type = EXCLUDED.value_type,
  scale_min = EXCLUDED.scale_min,
  scale_max = EXCLUDED.scale_max,
  privacy_level = EXCLUDED.privacy_level,
  clinical_standard = EXCLUDED.clinical_standard,
  display_order = EXCLUDED.display_order,
  offer_early = EXCLUDED.offer_early;

-- ============================================================
-- SCENARIO INTENTS
-- ============================================================
-- need_intensity is how much support to offer. It is NOT a risk level;
-- risk is assessed independently on every turn. See magi/risk.ts.

INSERT INTO scenario_intent
  (id, phrase, category, need_intensity, dbt_skill, tone, somatic)
VALUES
  ('i_can_t_concentrate_on_anything_today', 'I can''t concentrate on anything today', 'focus_attention', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('my_mind_is_racing_with_too_many_thoughts', 'My mind is racing with too many thoughts', 'focus_attention', 3, 'Mindfulness-Observe', 'validating_supportive', false),
  ('i_keep_getting_distracted_by_every_little_so', 'I keep getting distracted by every little sound', 'focus_attention', 2, 'Mindfulness-Participate', 'encouraging_educational', false),
  ('i_m_hyperfocusing', 'I''m hyperfocusing', 'focus_attention', 2, 'Mindfulness-Describe', 'encouraging_educational', false),
  ('my_attention_jumps_around_constantly', 'My attention jumps around constantly', 'focus_attention', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('i_can_t_follow_conversations_in_groups', 'I can''t follow conversations in groups', 'focus_attention', 2, 'Mindfulness-Participate', 'encouraging_educational', false),
  ('reading_feels_impossible_right_now', 'Reading feels impossible right now', 'focus_attention', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('i_lose_track_of_what_i_m_doing_mid_task', 'I lose track of what I''m doing mid-task', 'focus_attention', 2, 'Mindfulness-Describe', 'encouraging_educational', false),
  ('my_brain_feels_foggy', 'My brain feels foggy', 'focus_attention', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('i_can_t_filter_out_background_noise', 'I can''t filter out background noise', 'focus_attention', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', false),
  ('i_m_feeling_overwhelmed_by_my_emotions', 'I''m feeling overwhelmed by my emotions', 'emotional_regulation', 3, 'Emotion_Regulation-PLEASE', 'validating_supportive', true),
  ('my_emotions_change_so_quickly', 'My emotions change so quickly', 'emotional_regulation', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', true),
  ('i_m_so_angry', 'I''m so angry', 'emotional_regulation', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', true),
  ('i_feel_like_i_m_going_to_explode_emotionally', 'I feel like I''m going to explode emotionally', 'emotional_regulation', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_can_t_stop_crying', 'I can''t stop crying', 'emotional_regulation', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', true),
  ('i_feel_numb', 'I feel numb', 'emotional_regulation', 2, 'Mindfulness-Observe', 'encouraging_educational', true),
  ('my_emotions_feel_too_big_for_my_body', 'My emotions feel too big for my body', 'emotional_regulation', 3, 'Distress_Tolerance-TIPP', 'validating_supportive', true),
  ('i_m_having_an_emotional_flashback', 'I''m having an emotional flashback', 'emotional_regulation', 4, 'Distress_Tolerance-Radical_Acceptance', 'crisis_supportive', true),
  ('i_feel_ashamed_of_my_emotional_reactions', 'I feel ashamed of my emotional reactions', 'emotional_regulation', 2, 'Emotion_Regulation-Check_Facts', 'encouraging_educational', true),
  ('i_m_stuck_in_a_negative_emotion_spiral', 'I''m stuck in a negative emotion spiral', 'emotional_regulation', 3, 'Emotion_Regulation-Opposite_Action', 'validating_supportive', true),
  ('i_m_having_a_panic_attack', 'I''m having a panic attack', 'crisis_support', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_feel_like_i_can_t_cope_anymore', 'I feel like I can''t cope anymore', 'crisis_support', 4, 'Distress_Tolerance-Radical_Acceptance', 'crisis_supportive', true),
  ('everything_feels_too_much_right_now', 'Everything feels too much right now', 'crisis_support', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('i_m_having_thoughts_of_self_harm', 'I''m having thoughts of self-harm', 'crisis_support', 5, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_m_in_complete_shutdown_mode', 'I''m in complete shutdown mode', 'crisis_support', 4, 'Distress_Tolerance-Radical_Acceptance', 'crisis_supportive', true),
  ('i_want_to_run_away_from_everything', 'I want to run away from everything', 'crisis_support', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('i_m_having_a_complete_meltdown', 'I''m having a complete meltdown', 'crisis_support', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_feel_like_i_m_drowning_in_overwhelm', 'I feel like I''m drowning in overwhelm', 'crisis_support', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('i_m_having_suicidal_thoughts', 'I''m having suicidal thoughts', 'crisis_support', 5, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_can_t_breathe_properly_from_anxiety', 'I can''t breathe properly from anxiety', 'crisis_support', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('my_period_is_making_everything_harder', 'My period is making everything harder', 'hormone_impact', 3, 'Emotion_Regulation-PLEASE', 'validating_supportive', false),
  ('i_feel_crazy_during_pms', 'I feel crazy during PMS', 'hormone_impact', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', false),
  ('my_adhd_symptoms_are_worse_during_my_cycle', 'My ADHD symptoms are worse during my cycle', 'hormone_impact', 3, 'Mindfulness-Observe', 'validating_supportive', false),
  ('my_medications_don_t_work_during_my_period', 'My medications don''t work during my period', 'hormone_impact', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('i_have_intense_mood_swings_before_my_period', 'I have intense mood swings before my period', 'hormone_impact', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', false),
  ('my_hormones_make_me_feel_out_of_control', 'My hormones make me feel out of control', 'hormone_impact', 3, 'Emotion_Regulation-PLEASE', 'validating_supportive', false),
  ('i_have_pmdd', 'I have PMDD', 'hormone_impact', 4, 'Distress_Tolerance-Radical_Acceptance', 'crisis_supportive', false),
  ('ovulation_makes_me_hypersensitive', 'Ovulation makes me hypersensitive', 'hormone_impact', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', false),
  ('perimenopause_is_affecting_my_brain_fog', 'Perimenopause is affecting my brain fog', 'hormone_impact', 2, 'Mindfulness-Describe', 'encouraging_educational', false),
  ('my_cycle_makes_my_autism_symptoms_worse', 'My cycle makes my autism symptoms worse', 'hormone_impact', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('i_don_t_know_how_to_ask_for_help', 'I don''t know how to ask for help', 'social_interpersonal', 2, 'Interpersonal-DEAR_MAN', 'encouraging_educational', false),
  ('i_feel_like_nobody_understands_me', 'I feel like nobody understands me', 'social_interpersonal', 3, 'Interpersonal-GIVE', 'validating_supportive', false),
  ('i_m_struggling_in_my_relationship', 'I''m struggling in my relationship', 'social_interpersonal', 3, 'Interpersonal-DEAR_MAN', 'validating_supportive', false),
  ('i_need_to_set_boundaries_but_don_t_know_how', 'I need to set boundaries but don''t know how', 'social_interpersonal', 2, 'Interpersonal-FAST', 'encouraging_educational', false),
  ('i_m_having_conflict_with_someone_important', 'I''m having conflict with someone important', 'social_interpersonal', 3, 'Interpersonal-GIVE', 'validating_supportive', false),
  ('i_feel_rejected', 'I feel rejected', 'social_interpersonal', 3, 'Distress_Tolerance-Radical_Acceptance', 'validating_supportive', false),
  ('i_m_struggling_to_communicate_my_needs', 'I''m struggling to communicate my needs', 'social_interpersonal', 2, 'Interpersonal-DEAR_MAN', 'encouraging_educational', false),
  ('people_don_t_believe_i_m_struggling', 'People don''t believe I''m struggling', 'social_interpersonal', 3, 'Interpersonal-FAST', 'validating_supportive', false),
  ('i_m_afraid_of_being_abandoned', 'I''m afraid of being abandoned', 'social_interpersonal', 3, 'Distress_Tolerance-Radical_Acceptance', 'validating_supportive', false),
  ('i_can_t_read_social_cues_properly', 'I can''t read social cues properly', 'social_interpersonal', 2, 'Mindfulness-Observe', 'encouraging_educational', false),
  ('everything_is_too_loud', 'Everything is too loud', 'sensory_overload', 4, 'Distress_Tolerance-TIPP', 'crisis_supportive', true),
  ('i_need_to_calm_my_body_down', 'I need to calm my body down', 'sensory_overload', 3, 'Distress_Tolerance-TIPP', 'validating_supportive', true),
  ('i_m_having_a_sensory_overload', 'I''m having a sensory overload', 'sensory_overload', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('my_body_feels_disconnected', 'My body feels disconnected', 'sensory_overload', 2, 'Mindfulness-Observe', 'encouraging_educational', true),
  ('i_can_t_handle_any_more_stimulation', 'I can''t handle any more stimulation', 'sensory_overload', 4, 'Distress_Tolerance-ACCEPTS', 'crisis_supportive', true),
  ('textures_are_making_me_want_to_scream', 'Textures are making me want to scream', 'sensory_overload', 3, 'Distress_Tolerance-TIPP', 'validating_supportive', true),
  ('the_lights_are_hurting_my_eyes', 'The lights are hurting my eyes', 'sensory_overload', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', true),
  ('i_need_help_grounding_myself', 'I need help grounding myself', 'sensory_overload', 2, 'Mindfulness-Participate', 'encouraging_educational', true),
  ('sounds_are_physically_painful_right_now', 'Sounds are physically painful right now', 'sensory_overload', 3, 'Distress_Tolerance-TIPP', 'validating_supportive', true),
  ('i_m_overwhelmed_by_smells', 'I''m overwhelmed by smells', 'sensory_overload', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', true),
  ('i_can_t_make_decisions_today', 'I can''t make decisions today', 'executive_function', 2, 'Distress_Tolerance-Radical_Acceptance', 'encouraging_educational', false),
  ('i_m_procrastinating_on_important_tasks', 'I''m procrastinating on important tasks', 'executive_function', 2, 'Emotion_Regulation-Opposite_Action', 'encouraging_educational', false),
  ('i_feel_paralyzed', 'I feel paralyzed', 'executive_function', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('i_can_t_organize_my_thoughts', 'I can''t organize my thoughts', 'executive_function', 2, 'Mindfulness-Describe', 'encouraging_educational', false),
  ('time_management_feels_impossible', 'Time management feels impossible', 'executive_function', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', false),
  ('i_need_accommodations_at_work', 'I need accommodations at work', 'work_school', 2, 'Interpersonal-DEAR_MAN', 'encouraging_educational', false),
  ('i_can_t_keep_up_with_coursework', 'I can''t keep up with coursework', 'work_school', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('my_boss_doesn_t_understand_my_needs', 'My boss doesn''t understand my needs', 'work_school', 3, 'Interpersonal-FAST', 'validating_supportive', false),
  ('i_m_struggling_with_deadlines', 'I''m struggling with deadlines', 'work_school', 3, 'Emotion_Regulation-PLEASE', 'validating_supportive', false),
  ('meetings_are_overwhelming_for_me', 'Meetings are overwhelming for me', 'work_school', 2, 'Distress_Tolerance-ACCEPTS', 'encouraging_educational', false),
  ('i_feel_like_i_m_failing_at_everything', 'I feel like I''m failing at everything', 'identity_masking', 3, 'Emotion_Regulation-Check_Facts', 'validating_supportive', false),
  ('i_don_t_know_who_i_am_without_my_mask', 'I don''t know who I am without my mask', 'identity_masking', 3, 'Mindfulness-Observe', 'validating_supportive', false),
  ('i_m_tired_of_pretending_i_m_okay', 'I''m tired of pretending I''m okay', 'identity_masking', 3, 'Interpersonal-FAST', 'validating_supportive', false),
  ('i_m_exhausted_from_masking_all_day', 'I''m exhausted from masking all day', 'identity_masking', 3, 'Distress_Tolerance-ACCEPTS', 'validating_supportive', false),
  ('i_want_to_stop_hiding_my_struggles', 'I want to stop hiding my struggles', 'identity_masking', 2, 'Interpersonal-DEAR_MAN', 'encouraging_educational', false),
  ('i_accomplished_something_important_today', 'I accomplished something important today', 'success_positive', 1, 'Mindfulness-Participate', 'positive_reinforcing', false),
  ('i_successfully_used_a_dbt_skill', 'I successfully used a DBT skill', 'success_positive', 1, 'Mindfulness-Describe', 'positive_reinforcing', false),
  ('i_m_feeling_proud_of_my_progress', 'I''m feeling proud of my progress', 'success_positive', 1, 'Mindfulness-Observe', 'positive_reinforcing', false),
  ('i_managed_a_difficult_situation_well', 'I managed a difficult situation well', 'success_positive', 1, 'Emotion_Regulation-Check_Facts', 'positive_reinforcing', false),
  ('i_advocated_for_myself_successfully', 'I advocated for myself successfully', 'success_positive', 1, 'Interpersonal-FAST', 'positive_reinforcing', false)
ON CONFLICT (id) DO UPDATE SET
  phrase = EXCLUDED.phrase,
  category = EXCLUDED.category,
  need_intensity = EXCLUDED.need_intensity,
  dbt_skill = EXCLUDED.dbt_skill,
  tone = EXCLUDED.tone,
  somatic = EXCLUDED.somatic;

-- ============================================================
-- CHALLENGE LIBRARY
-- ============================================================
-- No streak, consecutive-day or points column exists anywhere in this schema,
-- and none should be added: gamification is an explicit product non-goal.

INSERT INTO challenge_template
  (id, title, invitation, detail, category, dbt_skill, effort, minutes,
   sensory_load, low_capacity_safe, somatic, suits_neurotypes, min_age)
VALUES
  ('one_sip', 'One sip', 'Have a mouthful of water, whenever you next move.', 'Not a glass. A mouthful. Dehydration makes everything harder to think through and it is the easiest thing on this list to fix.', 'emotional_regulation', NULL, 1, 1, 1, true, true, '{}', 13),
  ('cold_water_wrists', 'Cold water on your wrists', 'Run cold water over the inside of your wrists for thirty seconds.', 'This is the fastest way to bring a spiked nervous system down without having to think or decide anything. Face works too, if you can.', 'crisis_support', 'Distress_Tolerance-TIPP', 1, 1, 1, true, true, '{}', 13),
  ('long_exhale', 'Longer out than in', 'Breathe in for four, out for eight. Six rounds.', 'The long exhale is the part that does the work. Counting is optional if counting is annoying today.', 'crisis_support', 'Distress_Tolerance-TIPP', 1, 2, 1, true, true, '{}', 13),
  ('weight_on_you', 'Something heavy on you', 'Put something with weight across your lap or chest for a few minutes.', 'A blanket, a cushion, a cat if one is available. Deep pressure tells the body it is contained.', 'sensory_overload', NULL, 1, 5, 1, true, true, ARRAY['Autism', 'Sensory Processing Disorder', 'ADHD-Autism']::text[], 13),
  ('lights_down', 'Take the lights down', 'Turn off the overhead light and use a lamp, or nothing at all.', 'Overhead light is the single most common unnoticed source of sensory load indoors.', 'sensory_overload', NULL, 1, 1, 1, true, false, ARRAY['Autism', 'Sensory Processing Disorder', 'ADHD-Autism', 'OCD-ADHD']::text[], 13),
  ('ears_off', 'Ears off for ten minutes', 'Put in ear defenders, loops or headphones with nothing playing.', 'Silence is a different thing from quiet music. Ten minutes of actual silence can reset a whole afternoon.', 'sensory_overload', NULL, 1, 10, 1, true, true, ARRAY['Autism', 'Sensory Processing Disorder', 'ADHD-Autism']::text[], 13),
  ('name_five', 'Name five things', 'Look around and name five things you can see. Out loud or in your head.', 'Not to fix anything. Just to put you back in the room you are actually in.', 'sensory_overload', 'Mindfulness-Observe', 1, 2, 1, true, true, '{}', 13),
  ('floor_time', 'Lie on the floor', 'Get on the floor for five minutes. That is the whole thing.', 'No stretching, no breathing exercise, no app. The floor holds you up so nothing else has to.', 'crisis_support', NULL, 1, 5, 1, true, true, '{}', 13),
  ('two_minute_start', 'Two minutes only', 'Set a timer for two minutes on the thing you are avoiding, and stop when it goes.', 'You are allowed to stop. The point is starting, and starting is the part that is actually hard.', 'executive_function', 'Emotion_Regulation-Opposite_Action', 2, 2, 1, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'ADHD-Hyperactive', 'Dyslexia-ADHD', 'OCD-ADHD']::text[], 13),
  ('body_double', 'Do it near someone', 'Do the task with another person in the room, or on a video call, doing their own thing.', 'Body doubling. Nobody has to talk or help. Presence alone does something that willpower does not.', 'executive_function', NULL, 2, 20, 2, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'ADHD-Hyperactive', 'PDA', 'Dyspraxia']::text[], 13),
  ('one_surface', 'One surface', 'Clear one surface. Not the room. One surface.', 'Pick the smallest one you can see. A visible finished thing is worth more than a plan.', 'executive_function', NULL, 2, 10, 2, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'Dyspraxia']::text[], 13),
  ('decide_by_coin', 'Let a coin decide', 'For the next low-stakes decision you are stuck on, flip for it.', 'When decision fatigue has set in, the cost of choosing badly is usually far lower than the cost of not choosing.', 'executive_function', 'Distress_Tolerance-Radical_Acceptance', 1, 1, 1, true, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'OCD-ADHD']::text[], 13),
  ('write_it_down_wherever', 'Write it anywhere', 'Put the thing you are trying not to forget somewhere outside your head. Anywhere.', 'Back of your hand, a voice note, a text to yourself. Working memory is not a storage system and pretending otherwise costs you all day.', 'focus_attention', 'Mindfulness-Describe', 1, 1, 1, true, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'Dyslexia-ADHD', 'Dyspraxia']::text[], 13),
  ('one_tab', 'Close all but one', 'Close every tab, window and app except the one you need.', 'Not for tidiness. Every open thing is a small pull on attention you are paying for without noticing.', 'focus_attention', NULL, 2, 3, 1, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'ADHD-Hyperactive']::text[], 13),
  ('walk_the_thought', 'Walk while you think', 'If a thought will not resolve sitting still, move while you have it.', 'Pacing counts. Some brains genuinely process better in motion, and sitting still to concentrate is advice written for other people.', 'focus_attention', NULL, 2, 10, 2, false, true, ARRAY['ADHD-Hyperactive', 'ADHD-Combined', 'ADHD-Inattentive']::text[], 13),
  ('hyperfocus_anchor', 'Set one anchor', 'Before you go in deep, set one alarm for something you must not miss.', 'Hyperfocus is not the problem. Losing the thing on the other side of it is.', 'focus_attention', NULL, 1, 1, 1, true, false, ARRAY['ADHD-Combined', 'ADHD-Hyperactive', 'Autism', 'ADHD-Autism']::text[], 13),
  ('flat_words', 'Say it flat', 'Describe what is happening in the most boring words you can find.', '"My chest is tight and my thoughts are fast" rather than "I am falling apart". Same facts, much less to carry.', 'emotional_regulation', 'Mindfulness-Describe', 2, 3, 1, true, false, '{}', 13),
  ('check_the_floor', 'Check the floor under it', 'Before anything else: have you eaten, drunk, slept, and taken what you take?', 'Not a telling-off. Four physical things account for a startling share of what feels like emotional collapse.', 'emotional_regulation', 'Emotion_Regulation-PLEASE', 1, 2, 1, true, true, '{}', 13),
  ('let_it_be_ninety', 'Ninety seconds', 'When the wave hits, set ninety seconds and just let it be there.', 'You do not have to do anything with it or about it. Most surges of feeling crest and start to drop in about that long.', 'emotional_regulation', 'Distress_Tolerance-Radical_Acceptance', 2, 2, 1, true, true, '{}', 13),
  ('shame_out_loud', 'Say the shame part', 'Say the bit you are most embarrassed about out loud, to yourself, once.', 'Shame gets most of its weight from being unsaid. This is not confession and nobody has to hear it.', 'identity_masking', 'Emotion_Regulation-Check_Facts', 3, 3, 1, true, false, '{}', 16),
  ('unmask_ten', 'Ten minutes unmasked', 'For ten minutes, drop the performance. Stim, slump, stare, script nothing.', 'Alone, door shut. Masking is genuine physical work and this is the only rest from it.', 'identity_masking', NULL, 1, 10, 1, true, true, ARRAY['Autism', 'ADHD-Autism', 'PDA', 'Sensory Processing Disorder']::text[], 13),
  ('one_true_thing', 'One true thing about today', 'Write one sentence about today that is true and not a judgement.', '"I got through a meeting I was dreading" counts. "I should have done more" does not — that is a verdict, not a fact.', 'identity_masking', 'Emotion_Regulation-Check_Facts', 2, 3, 1, true, false, '{}', 13),
  ('draft_the_ask', 'Draft the ask', 'Write the message you are dreading, and do not send it yet.', 'Writing it and sending it are two separate jobs. Doing the first one today makes the second one much smaller.', 'social_interpersonal', 'Interpersonal-DEAR_MAN', 3, 10, 1, false, false, '{}', 13),
  ('one_boundary_sentence', 'One sentence, no apology', 'Write your boundary as one sentence with no "sorry" and no explanation.', 'You can add the softening back afterwards if you want it. Start from the version that is just true.', 'social_interpersonal', 'Interpersonal-FAST', 3, 5, 1, false, false, ARRAY['PDA', 'Autism', 'ADHD-Autism']::text[], 16),
  ('tell_one_person', 'Tell one person a real thing', 'Tell one person one honest thing about how you actually are.', 'Not everyone. One. It can be small and it does not have to lead anywhere.', 'social_interpersonal', 'Interpersonal-GIVE', 3, 5, 2, false, false, '{}', 13),
  ('leave_early_plan', 'Decide your exit first', 'Before the social thing, decide when you are leaving and how.', 'Having an exit makes it possible to be there at all. Deciding it in advance means not negotiating with yourself while depleted.', 'social_interpersonal', NULL, 2, 5, 1, true, false, ARRAY['Autism', 'ADHD-Autism', 'Sensory Processing Disorder', 'PDA']::text[], 13),
  ('phase_note', 'Note where you are in the month', 'Log roughly where you are in your cycle, alongside how today felt.', 'A few weeks of this and the pattern usually becomes obvious. Until then it just looks like being unreliable.', 'hormone_impact', NULL, 1, 1, 1, true, false, '{}', 13),
  ('lower_the_bar_deliberately', 'Lower the bar on purpose', 'Pick one thing this week that gets the minimum version, decided in advance.', 'Choosing where to do less is different from running out of capacity and failing at everything at once.', 'hormone_impact', 'Distress_Tolerance-Radical_Acceptance', 2, 5, 1, true, false, '{}', 13),
  ('pain_before_mood', 'Check pain before mood', 'Before you decide how you feel, rate any physical pain out of ten.', 'Persistent low-level pain reliably reads as low mood or irritability, and it is treated very differently.', 'hormone_impact', 'Emotion_Regulation-PLEASE', 1, 2, 1, true, true, '{}', 13),
  ('three_bullets_for_gp', 'Three bullets for the appointment', 'Write the three things you must say, in order, before you go.', 'Under pressure the important one is the one that goes missing. On paper it cannot.', 'work_school', NULL, 2, 10, 1, false, false, '{}', 13),
  ('one_accommodation', 'Name one adjustment', 'Name one specific thing that would make work or study easier. Just name it.', '"A written summary after meetings" is askable. "More support" is not. Naming it is most of the work.', 'work_school', 'Interpersonal-DEAR_MAN', 2, 10, 1, false, false, '{}', 16),
  ('meeting_recovery', 'Book the recovery, not just the meeting', 'Put ten empty minutes in the diary straight after the demanding thing.', 'The cost of the meeting is not the meeting. It is the hour afterwards you had already promised to something else.', 'work_school', NULL, 2, 5, 1, true, false, ARRAY['Autism', 'ADHD-Autism', 'Sensory Processing Disorder', 'ADHD-Combined']::text[], 16),
  ('deadline_out_loud', 'Say the deadline to someone', 'Tell one person what you are doing and by when.', 'External structure does what internal intention cannot, and this is the cheapest version of it.', 'work_school', NULL, 2, 3, 1, false, false, ARRAY['ADHD-Inattentive', 'ADHD-Combined', 'ADHD-Hyperactive']::text[], 13),
  ('note_what_worked', 'Note what worked', 'Write down the thing that helped today, so you have it next time.', 'You will not remember. Everyone assumes they will and nobody does.', 'success_positive', 'Mindfulness-Describe', 1, 2, 1, true, false, '{}', 13),
  ('credit_yourself', 'Take the credit', 'Say what you did today and leave out the word "just".', '"I just replied to some emails" and "I replied to some emails" describe the same day very differently.', 'success_positive', 'Emotion_Regulation-Check_Facts', 1, 2, 1, true, false, '{}', 13),
  ('absorb_in_one_thing', 'Get absorbed in one thing', 'Do one thing you like for its own sake, without checking how it is going.', 'Not productive, not measured, not posted. The point is being in it.', 'success_positive', 'Mindfulness-Participate', 1, 20, 2, true, false, '{}', 13)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  invitation = EXCLUDED.invitation,
  detail = EXCLUDED.detail,
  category = EXCLUDED.category,
  dbt_skill = EXCLUDED.dbt_skill,
  effort = EXCLUDED.effort,
  minutes = EXCLUDED.minutes,
  sensory_load = EXCLUDED.sensory_load,
  low_capacity_safe = EXCLUDED.low_capacity_safe,
  somatic = EXCLUDED.somatic,
  suits_neurotypes = EXCLUDED.suits_neurotypes,
  min_age = EXCLUDED.min_age;
