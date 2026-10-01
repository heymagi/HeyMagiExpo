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
