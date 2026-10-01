/**
 * Smoke test for the language model and embedding configuration.
 *
 * Neither the cloud sandbox this was written in nor the local VM can reach api.openai.com,
 * so the OpenAI path could not be verified during the build. This script does it in one
 * command, from a machine that can.
 *
 *   node scripts/smoke-llm.mjs
 *
 * It checks the four things that actually break between model generations:
 *   1. the model id exists and the key can use it
 *   2. which token-limit parameter it wants (max_completion_tokens vs max_tokens)
 *   3. whether it accepts a non-default temperature
 *   4. that tool calling returns arguments in the shape the orchestrator expects
 *
 * Plus the embedding model and its dimension, which must match the vector(1536) column.
 * Nothing is written to the database and no keys are printed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal .env loader — no dependencies, no dotenv import.
 *
 * Handles the three things that actually break .env parsing on Windows: a UTF-8 BOM on the
 * first line, CRLF endings, and `export KEY=value` prefixes. Existing environment variables
 * always win.
 */
function loadEnv() {
  let raw;
  try {
    raw = readFileSync(join(HERE, '..', '.env'), 'utf8');
  } catch {
    return; // No .env is fine if the variables are already exported.
  }
  for (const line of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!process.env[key]) {
      process.env[key] = rawValue.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    }
  }
}
loadEnv();

const provider = (process.env.MAGI_LLM_PROVIDER ?? 'openai').toLowerCase();
const replyModel =
  process.env.MAGI_MODEL ?? (provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-5.6-terra');
const riskModel = process.env.MAGI_RISK_MODEL ?? replyModel;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log(`MAGI smoke test`);
console.log(`provider: ${provider}   reply model: ${replyModel}   risk model: ${riskModel}`);
console.log('-'.repeat(72));

if (provider !== 'openai') {
  console.log('This script currently covers the OpenAI path only.');
  process.exit(0);
}

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY is not set. See .env.example.');
  process.exit(1);
}

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

async function post(body) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // A blocked network is the most likely reason this script is being run at all, so say
    // so plainly rather than letting an unhandled rejection surface as a stack trace.
    console.error(`\n  Could not reach api.openai.com: ${err.message}`);
    console.error('  This machine has no route to the OpenAI API — check a firewall, proxy or');
    console.error('  VPN. The Supabase edge function calls it from Supabase, not from here, so');
    console.error('  MAGI can still work in production even if this machine cannot connect.');
    process.exit(2);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON error bodies happen on gateway failures.
  }
  return { status: res.status, ok: res.ok, text, json };
}

/* ---------- 1. does the model exist and answer? ---------- */

let tokenParam = 'max_completion_tokens';

let reply = await post({
  model: replyModel,
  messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
  [tokenParam]: 16,
});

if (!reply.ok && /max_completion_tokens/i.test(reply.text)) {
  tokenParam = 'max_tokens';
  reply = await post({
    model: replyModel,
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    [tokenParam]: 16,
  });
}

if (reply.ok) {
  record('model responds', true, `"${(reply.json?.choices?.[0]?.message?.content ?? '').trim()}"`);
  record('token limit parameter', true, tokenParam);
} else {
  record('model responds', false, `HTTP ${reply.status}: ${reply.text.slice(0, 220)}`);
  if (reply.status === 404 || /does not exist|unknown model/i.test(reply.text)) {
    console.log(
      `\n  The model id "${replyModel}" was rejected. Set MAGI_MODEL in .env to a model this\n` +
        `  key can use, then run this again. The orchestrator reads the same variable.`,
    );
  }
  if (reply.status === 401) console.log('\n  The key was rejected. Check OPENAI_API_KEY.');
  if (reply.status === 429) console.log('\n  Rate limited or out of credit on this account.');
  summarise();
  process.exit(1);
}

/* ---------- 2. non-default temperature ---------- */

const temp = await post({
  model: replyModel,
  messages: [{ role: 'user', content: 'Say: ok' }],
  [tokenParam]: 16,
  temperature: 0.3,
});
record(
  'accepts a custom temperature',
  temp.ok,
  temp.ok ? 'yes' : 'no — the client drops it and retries automatically, so this is safe',
);

/* ---------- 3. tool calling ---------- */

const tooled = await post({
  model: replyModel,
  messages: [
    {
      role: 'user',
      content: "Today has been rough. Log it as rough, using the tool. Don't ask me anything.",
    },
  ],
  [tokenParam]: 256,
  tools: [
    {
      type: 'function',
      function: {
        name: 'log_check_in',
        description: 'Record how the user is doing today.',
        parameters: {
          type: 'object',
          properties: {
            overall: { type: 'string', enum: ['rough', 'low', 'ok', 'good', 'bright'] },
            note: { type: 'string' },
          },
          required: ['overall'],
          additionalProperties: false,
        },
      },
    },
  ],
});

if (!tooled.ok) {
  record('tool calling', false, `HTTP ${tooled.status}: ${tooled.text.slice(0, 220)}`);
} else {
  const call = tooled.json?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) {
    record(
      'tool calling',
      false,
      'the model replied in prose instead of calling the tool — MAGI will still work, but she will log less on her own',
    );
  } else {
    let args = null;
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch {
      // handled below
    }
    record(
      'tool calling',
      Boolean(args && args.overall),
      args ? `${call.function.name}(overall: "${args.overall}")` : 'arguments were not valid JSON',
    );
  }
}

/* ---------- 4. JSON mode, used by the risk assessor ---------- */

const jsonMode = await post({
  model: riskModel,
  messages: [
    { role: 'system', content: 'Return only JSON of the form {"tier":"none"}.' },
    { role: 'user', content: 'I had a nice walk today.' },
  ],
  [tokenParam]: 64,
  response_format: { type: 'json_object' },
});
record(
  'risk model + JSON mode',
  jsonMode.ok,
  jsonMode.ok
    ? 'yes'
    : 'no — the client drops response_format and parses JSON out of the text instead, so this is safe',
);

/* ---------- 5. embeddings ---------- */

let embed;
try {
  embed = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: 'I am exhausted from masking all day',
      dimensions: 1536,
    }),
  });
} catch (err) {
  record('embeddings', false, `could not reach the API: ${err.message}`);
  embed = null;
}

if (!embed) {
  // already recorded
} else if (!embed.ok) {
  record('embeddings', false, `HTTP ${embed.status}: ${(await embed.text()).slice(0, 200)}`);
} else {
  const json = await embed.json();
  const length = json.data?.[0]?.embedding?.length;
  record(
    'embeddings (1536 dimensions)',
    length === 1536,
    length === 1536 ? 'matches the vector(1536) column' : `got ${length} — the column expects 1536`,
  );
}

summarise();

function summarise() {
  const failed = results.filter((r) => !r.ok);
  console.log('-'.repeat(72));
  if (!failed.length) {
    console.log(`All ${results.length} checks passed. MAGI is wired up correctly.`);
    if (tokenParam !== 'max_completion_tokens') {
      console.log(
        `\nNote: this model wants "${tokenParam}". The edge function detects that at runtime\n` +
          `and adapts, so no code change is needed.`,
      );
    }
    return;
  }
  const blocking = failed.filter(
    (r) => r.name === 'model responds' || r.name.startsWith('embeddings'),
  );
  console.log(`${failed.length} of ${results.length} checks failed.`);
  console.log(
    blocking.length
      ? 'At least one is blocking — MAGI will not work until it is fixed.'
      : 'None are blocking: the client already falls back for each of these.',
  );
  if (blocking.length) process.exitCode = 1;
}
