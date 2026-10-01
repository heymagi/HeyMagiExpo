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
