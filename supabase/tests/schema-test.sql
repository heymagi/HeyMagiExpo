\set ON_ERROR_STOP on
\pset pager off

-- ============================================================
-- Fixtures: two unrelated users, plus a minor with a guardian.
-- ============================================================
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'ada@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'bea@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'kit@example.com');

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM account;
  ASSERT n = 3, format('expected 3 accounts auto-provisioned by trigger, got %s', n);
  SELECT count(*) INTO n FROM profile;
  ASSERT n = 3, format('expected 3 profiles auto-provisioned by trigger, got %s', n);
  RAISE NOTICE 'PASS  account + profile provisioning triggers';
END $$;

-- Ada is an adult; Kit is 14.
UPDATE account SET date_of_birth = '1990-04-02', state = 'active'
 WHERE id = '11111111-1111-1111-1111-111111111111';
UPDATE account SET date_of_birth = '1985-01-01', state = 'active'
 WHERE id = '22222222-2222-2222-2222-222222222222';
UPDATE account SET date_of_birth = (CURRENT_DATE - INTERVAL '14 years 3 months')::date,
                   state = 'pending_guardian'
 WHERE id = '33333333-3333-3333-3333-333333333333';

DO $$
DECLARE dob date; band text; minor boolean;
BEGIN
  SELECT date_of_birth INTO dob FROM account WHERE id='33333333-3333-3333-3333-333333333333';
  band := magi_age_band(dob); minor := magi_is_minor(dob);
  ASSERT band = '13-15', format('expected band 13-15, got %s', band);
  ASSERT minor IS TRUE, 'expected minor = true';
  SELECT date_of_birth INTO dob FROM account WHERE id='11111111-1111-1111-1111-111111111111';
  ASSERT magi_is_minor(dob) IS FALSE, 'expected adult';
  ASSERT magi_age_band(dob) IN ('35-39','30-34'), format('unexpected adult band %s', magi_age_band(dob));
  ASSERT magi_age_band(NULL) IS NULL, 'null dob must yield null band';
  RAISE NOTICE 'PASS  age assurance helpers';
END $$;

-- Ada's data, written as Ada.
SET ROLE authenticated;
SET "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

INSERT INTO conversation (id, account_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
INSERT INTO message (id, conversation_id, account_id, author, body) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'user', 'I am exhausted from masking all day');
INSERT INTO check_in (account_id, local_date, overall) VALUES
  ('11111111-1111-1111-1111-111111111111', CURRENT_DATE, 'low');
INSERT INTO magi_memory (account_id, kind, key, value, provenance, state) VALUES
  ('11111111-1111-1111-1111-111111111111', 'boundary', 'family.mother',
   'Does not want her mother brought up', 'stated', 'active');
INSERT INTO healthcare_summary
  (account_id, purpose, period_start, period_end, draft_body, body) VALUES
  ('11111111-1111-1111-1111-111111111111', 'gp_appointment',
   CURRENT_DATE - 28, CURRENT_DATE, 'MAGI draft text', 'MAGI draft text');
INSERT INTO safety_plan (account_id, what_helps) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Cold water, then phone Jo');

RESET ROLE;

-- ============================================================
-- Isolation: Bea must see none of Ada's rows.
-- ============================================================
SET ROLE authenticated;
SET "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

DO $$
DECLARE
  t text; n integer;
  tables text[] := ARRAY['conversation','message','check_in','magi_memory',
                         'healthcare_summary','safety_plan','profile','account'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %s = %L', t,
                   CASE WHEN t = 'account' THEN 'id' ELSE 'account_id' END,
                   '11111111-1111-1111-1111-111111111111') INTO n;
    ASSERT n = 0, format('LEAK: as Bea, saw %s row(s) of Ada''s in %s', n, t);
  END LOOP;
  RAISE NOTICE 'PASS  cross-user isolation across % tables', array_length(tables,1);
END $$;

-- Bea must not be able to write into Ada's account either.
DO $$
BEGIN
  BEGIN
    INSERT INTO check_in (account_id, local_date, overall)
    VALUES ('11111111-1111-1111-1111-111111111111', CURRENT_DATE - 1, 'ok');
    RAISE EXCEPTION 'LEAK: Bea inserted a check_in against Ada''s account';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS  write into another account rejected by RLS';
  END;
END $$;

RESET ROLE;

-- ============================================================
-- Integrity triggers and constraints
-- ============================================================
SET ROLE authenticated;
SET "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

DO $$
BEGIN
  BEGIN
    UPDATE message SET body = 'rewritten history'
     WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    RAISE EXCEPTION 'FAIL: message body was rewritable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS  message body is append-only';
  END;
END $$;

-- but feedback is updatable
UPDATE message SET user_feedback = 'helped'
 WHERE id = 'aaaaaaaa-0000-0000-0000-00000000000a';
DO $$ BEGIN RAISE NOTICE 'PASS  message feedback still updatable'; END $$;

DO $$
BEGIN
  BEGIN
    UPDATE healthcare_summary SET draft_body = 'tampered'
     WHERE account_id = '11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'FAIL: draft_body was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
    RAISE NOTICE 'PASS  healthcare_summary draft is immutable';
  END;
END $$;

UPDATE healthcare_summary SET body = 'my own edited version', edited_at = now()
 WHERE account_id = '11111111-1111-1111-1111-111111111111';
DO $$ BEGIN RAISE NOTICE 'PASS  healthcare_summary body is user-editable'; END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO check_in (account_id, local_date, overall)
    VALUES ('11111111-1111-1111-1111-111111111111', CURRENT_DATE, 'good');
    RAISE EXCEPTION 'FAIL: duplicate check_in for the same day was allowed';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS  one check-in per local day enforced';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    INSERT INTO signal_reading (account_id, signal_id, local_date, value_numeric, value_text)
    VALUES ('11111111-1111-1111-1111-111111111111', 'daily_mood_rating', CURRENT_DATE, 4, 'four');
    RAISE EXCEPTION 'FAIL: signal_reading accepted two values at once';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  signal_reading requires exactly one value column';
  END;
  BEGIN
    INSERT INTO signal_reading (account_id, signal_id, local_date)
    VALUES ('11111111-1111-1111-1111-111111111111', 'daily_mood_rating', CURRENT_DATE);
    RAISE EXCEPTION 'FAIL: signal_reading accepted zero values';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS  signal_reading rejects an empty reading';
  END;
END $$;

INSERT INTO signal_reading (account_id, signal_id, local_date, value_numeric)
VALUES ('11111111-1111-1111-1111-111111111111', 'daily_mood_rating', CURRENT_DATE, 4);

RESET ROLE;

-- Guardian link: only one active link per minor.
SET ROLE authenticated;
SET "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';

INSERT INTO guardian_link (minor_account_id, guardian_name, guardian_email, relationship)
VALUES ('33333333-3333-3333-3333-333333333333', 'Sam Okafor', 'sam@example.com', 'parent');

DO $$
BEGIN
  BEGIN
    INSERT INTO guardian_link (minor_account_id, guardian_name, guardian_email, relationship)
    VALUES ('33333333-3333-3333-3333-333333333333', 'Other Adult', 'other@example.com', 'carer');
    RAISE EXCEPTION 'FAIL: a second active guardian link was allowed';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS  one active guardian link per minor enforced';
  END;
END $$;

-- Consent history is append-only and the view resolves to the newest row.
INSERT INTO consent_record (account_id, kind, document_version, granted)
VALUES ('33333333-3333-3333-3333-333333333333', 'health_data_processing', 'v1', true);
INSERT INTO consent_record (account_id, kind, document_version, granted)
VALUES ('33333333-3333-3333-3333-333333333333', 'health_data_processing', 'v1', false);

DO $$
DECLARE g boolean; n integer;
BEGIN
  SELECT granted INTO g FROM consent_current
   WHERE account_id='33333333-3333-3333-3333-333333333333'
     AND kind='health_data_processing';
  ASSERT g IS FALSE, 'consent_current should reflect the newest row (withdrawn)';
  SELECT count(*) INTO n FROM consent_record
   WHERE account_id='33333333-3333-3333-3333-333333333333';
  ASSERT n = 2, 'consent history should retain both rows';
  RAISE NOTICE 'PASS  consent history append-only, consent_current newest-wins';
END $$;

RESET ROLE;

-- ============================================================
-- Structural check: no guardian read path into conversation content.
-- ============================================================
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s.%s', tablename, policyname), ', ')
    INTO bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('message','conversation','magi_memory','experience_note',
                       'check_in','signal_reading','healthcare_summary','safety_plan')
     AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%guardian_link%';
  ASSERT bad IS NULL,
    format('a guardian read path exists into conversation content: %s', bad);
  RAISE NOTICE 'PASS  no guardian policy touches conversation content';
END $$;

-- Every user-scoped table must have RLS enabled.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;
  ASSERT bad IS NULL, format('tables without RLS: %s', bad);
  RAISE NOTICE 'PASS  RLS enabled on every table in public';
END $$;

-- ============================================================
-- Seed data and retrieval
-- ============================================================
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM scenario_intent; ASSERT n = 80, format('intents: %s', n);
  SELECT count(*) INTO n FROM challenge_template; ASSERT n = 36, format('challenges: %s', n);
  SELECT count(*) INTO n FROM signal_definition; ASSERT n = 31, format('signals: %s', n);
  SELECT count(*) INTO n FROM signal_definition WHERE privacy_level = 'high';
  ASSERT n = 19, format('expected 19 high-privacy signals, got %s', n);
  SELECT count(*) INTO n FROM scenario_intent WHERE need_intensity = 5;
  ASSERT n = 2, format('expected 2 top-intensity intents, got %s', n);
  RAISE NOTICE 'PASS  seed counts (80 intents, 36 challenges, 31 signals)';
END $$;

-- No gamification columns anywhere. This is the guard that keeps the non-goal a non-goal.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%s.%s', table_name, column_name), ', ') INTO bad
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND (column_name ~* 'streak|points|badge|xp_|level_up|leaderboard');
  ASSERT bad IS NULL, format('gamification column found: %s', bad);
  RAISE NOTICE 'PASS  no streak/points/badge columns exist';
END $$;

-- Vector search wiring works end to end with a dummy embedding.
SET ROLE authenticated;
SET "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
RESET ROLE;

UPDATE scenario_intent
   SET embedding = (
     SELECT ('[' || string_agg(
              CASE WHEN i = (('x' || substr(md5(scenario_intent.id), 1, 4))::bit(16)::int % 1536) + 1
                   THEN '1' ELSE '0' END, ',') || ']')::vector
       FROM generate_series(1, 1536) AS g(i)
   );

DO $$
DECLARE hit record; n integer;
BEGIN
  SELECT count(*) INTO n FROM scenario_intent WHERE embedding IS NOT NULL;
  ASSERT n = 80, format('expected all 80 intents embedded, got %s', n);
  SELECT * INTO hit FROM magi_match_intents(
    (SELECT embedding FROM scenario_intent WHERE id = 'i_m_exhausted_from_masking_all_day'), 3
  ) LIMIT 1;
  ASSERT hit.id = 'i_m_exhausted_from_masking_all_day',
    format('nearest neighbour should be itself, got %s', hit.id);
  ASSERT hit.similarity > 0.99, format('self-similarity should be ~1, got %s', hit.similarity);
  ASSERT hit.tone = 'validating_supportive', format('unexpected tone %s', hit.tone);
  RAISE NOTICE 'PASS  magi_match_intents returns nearest intent with its tone mapping';
END $$;

DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM magi_match_intents(
    (SELECT embedding FROM scenario_intent LIMIT 1), 5, 'crisis_support');
  ASSERT n = 5, format('category filter returned %s rows', n);
  SELECT count(*) INTO n FROM magi_match_intents(
    (SELECT embedding FROM scenario_intent LIMIT 1), 500);
  ASSERT n = 20, format('limit should clamp to 20, got %s', n);
  RAISE NOTICE 'PASS  magi_match_intents filters by category and clamps its limit';
END $$;

-- Cycle day estimate, including the "nothing logged yet" case.
SET ROLE authenticated;
SET "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
DO $$
DECLARE d integer;
BEGIN
  d := magi_cycle_day('11111111-1111-1111-1111-111111111111', CURRENT_DATE);
  ASSERT d IS NULL, format('with no cycle events the estimate must be NULL, got %s', d);
END $$;
INSERT INTO cycle_event (account_id, kind, local_date)
VALUES ('11111111-1111-1111-1111-111111111111', 'period_start', CURRENT_DATE - 5);
DO $$
DECLARE d integer;
BEGIN
  d := magi_cycle_day('11111111-1111-1111-1111-111111111111', CURRENT_DATE);
  ASSERT d = 6, format('expected cycle day 6, got %s', d);
  RAISE NOTICE 'PASS  cycle day estimate (NULL when unknown, correct when known)';
END $$;
RESET ROLE;

DO $$ BEGIN RAISE NOTICE '--- all schema assertions passed ---'; END $$;
