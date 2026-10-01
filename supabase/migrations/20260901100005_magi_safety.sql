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
