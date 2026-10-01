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
