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
