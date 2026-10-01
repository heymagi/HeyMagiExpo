/**
 * Fills scenario_intent.embedding for the 80 intents.
 *
 * Run once after applying migrations, and again whenever magi/data/intents.json changes.
 * Idempotent: intents that already have an embedding are skipped unless --force is passed.
 *
 *   node scripts/embed-intents.mjs [--force] [--dry-run]
 *
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and OPENAI_API_KEY in the environment.
 * The service role key is needed because scenario_intent is reference data that authenticated
 * users can read but not write.
 *
 * Cost note: 80 short strings against text-embedding-3-small is a fraction of a penny. The
 * source workbook's 70,400 rows would have been ~880x that for no additional signal, since
 * they are the same 80 intents crossed with attribute combinations.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(HERE, '..', '.env');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;

/**
 * Reads .env directly rather than trusting the runner to have exported it.
 *
 * This script originally read process.env alone, on the assumption that whatever started it
 * had loaded .env. That assumption does not hold: Expo's loader exports only the variables
 * *it* needs to the app bundle, so a plain `npm run` reached this file with SUPABASE_URL
 * unset even though the file plainly contained it.
 *
 * Handles the three things that actually break .env parsing on Windows: a UTF-8 BOM on the
 * first line, CRLF endings, and `export KEY=value` prefixes. Existing environment variables
 * always win, so CI can override without editing the file.
 */
function loadEnvFile() {
  let raw;
  try {
    raw = readFileSync(ENV_PATH, 'utf8');
  } catch {
    return { found: false, keys: [] };
  }
  const keys = [];
  for (const line of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    keys.push(key);
    if (!process.env[key]) process.env[key] = value;
  }
  return { found: true, keys };
}

const env = loadEnvFile();

const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY } = process.env;

const missing = Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY })
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length) {
  console.error(`Missing ${missing.join(', ')}.`);
  console.error(
    env.found
      ? `Read ${ENV_PATH} and found: ${env.keys.join(', ') || '(no variables)'}`
      : `No .env file at ${ENV_PATH} — copy .env.example to .env and fill it in.`,
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const intents = JSON.parse(readFileSync(join(HERE, '..', 'magi', 'data', 'intents.json'), 'utf8'));
console.log(`${intents.length} intents in magi/data/intents.json`);

const { data: existing, error: readError } = await db
  .from('scenario_intent')
  .select('id, phrase, embedding');
if (readError) {
  console.error('Could not read scenario_intent:', readError.message);
  console.error('Have the migrations been applied to this project?');
  process.exit(1);
}

const embeddedIds = new Set((existing ?? []).filter((r) => r.embedding).map((r) => r.id));
const missingRows = intents.filter((i) => force || !embeddedIds.has(i.id));

if (!missingRows.length) {
  console.log('Every intent already has an embedding. Pass --force to redo them.');
  process.exit(0);
}

console.log(
  `${missingRows.length} to embed${force ? ' (forced)' : ''}${dryRun ? ' — dry run, nothing will be written' : ''}`,
);

/** One request for the whole batch: 80 short strings is well inside the input limit. */
async function embedBatch(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: DIMENSIONS }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data.map((d) => d.embedding);
}

const BATCH = 64;
let written = 0;

for (let offset = 0; offset < missingRows.length; offset += BATCH) {
  const slice = missingRows.slice(offset, offset + BATCH);
  const vectors = await embedBatch(slice.map((i) => i.phrase));

  for (const [index, intent] of slice.entries()) {
    const vector = vectors[index];
    if (vector.length !== DIMENSIONS) {
      // A dimension mismatch would produce plausible-looking nonsense matches rather than an
      // error, which is the worst failure mode for something that steers tone. Stop instead.
      console.error(
        `Dimension mismatch for "${intent.id}": got ${vector.length}, column expects ${DIMENSIONS}.`,
      );
      process.exit(1);
    }
    if (dryRun) continue;

    const { error } = await db
      .from('scenario_intent')
      .update({ embedding: `[${vector.join(',')}]` })
      .eq('id', intent.id);
    if (error) {
      console.error(`Failed to write "${intent.id}":`, error.message);
      process.exit(1);
    }
    written++;
  }
  console.log(`  ${Math.min(offset + BATCH, missingRows.length)}/${missingRows.length}`);
}

if (dryRun) {
  console.log('Dry run complete — embeddings were generated and discarded.');
} else {
  console.log(`Done. ${written} intents embedded.`);
  const { count } = await db
    .from('scenario_intent')
    .select('id', { count: 'exact', head: true })
    .not('embedding', 'is', null);
  console.log(`${count} of ${intents.length} intents now have an embedding.`);
}
