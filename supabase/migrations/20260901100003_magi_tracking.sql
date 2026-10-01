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
