/**
 * MAGI — the orchestrator. One endpoint, one turn.
 *
 * Order of operations, and why:
 *
 *   1. Lexicon risk pass, synchronously, before anything else. It is free and it cannot fail.
 *   2. In parallel: load the user's context, embed the message, and run the model risk
 *      assessment. All three are independent, and the risk assessment must finish before the
 *      prompt is built, so parallelising it is the difference between one round trip and two.
 *   3. Take the HIGHER of the two risk assessments. The lexicon can raise a tier; nothing can
 *      lower one.
 *   4. Retrieve nearest scenario intents to steer tone and approach — unless risk has already
 *      decided the tone, in which case retrieval is recorded but overridden.
 *   5. Compose, with the tool list filtered by risk tier.
 *   6. Run the tool loop, persist everything, return.
 *
 * The reply is generated last and never streams, because a partial reply to someone in
 * distress that then rewrites itself is worse than a two-second wait.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import {
  assessLexicon,
  highestTier,
  atLeast,
  RISK_PROTOCOL,
  guardianInvolvement,
  type RiskTier,
} from '../_shared/risk.ts';
import { resourcesForAge, type CrisisResource } from '../_shared/crisis-resources.ts';
import { INTENTS_BY_ID, type DbtSkill, type ResponseTone } from '../_shared/taxonomy.ts';
import { buildSystemPrompt, RISK_ASSESSOR_PROMPT } from '../_shared/prompt.ts';
import { toolsForTurn, toLlmTools } from '../_shared/tools.ts';
import { loadContext } from '../_shared/context.ts';
import { executeTool, applyProposal, type ExecuteDeps } from '../_shared/tool-executor.ts';
import { embed, toVectorLiteral } from '../_shared/embedding.ts';
import { resolveLlm, ProviderConfigError } from '../_shared/provider.ts';
import { extractJsonObject, type LlmClient, type LlmMessage } from '../_shared/llm.ts';
import type {
  MagiCard,
  MagiRequestBody,
  MagiResponse,
  RetrievalCandidate,
} from '../_shared/types.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
};

/** Maximum tool round trips in a single turn. Four is generous; two is typical. */
const MAX_TOOL_ROUNDS = 4;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  });

/**
 * Server-sent events, so her reply can arrive as she writes it.
 *
 *   token  {delta}          a fragment of text, in order
 *   reset  {}               discard everything streamed for this turn so far
 *   done   MagiResponse     the real answer, cards, risk and all
 *   error  {message}        the turn failed after the stream had already opened
 *
 * `reset` is the one that earns its place. A turn can stream a sentence and then decide to
 * call a tool, at which point that sentence is superseded by whatever she says after seeing
 * the tool's result. Text that appears and then silently changes underneath someone is worse
 * than a wait -- especially for the person this app is for -- so the client is told to throw
 * it away rather than left to reconcile it.
 *
 * `done` still carries the complete response. The stream is a nicety; the payload is the
 * contract, and a client that ignores every token event still works correctly.
 */
type Emit = (event: 'token' | 'reset' | 'done' | 'error', data: unknown) => Promise<void>;

const SSE_HEADERS = {
  ...CORS,
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Belt and braces against an intermediary that would otherwise buffer the whole response
  // and defeat the point of streaming it.
  'x-accel-buffering': 'no',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // Content negotiation rather than a second endpoint or a flag in the body: a client that
  // cannot stream (or a curl in a terminal) asks for JSON and gets exactly what it always
  // got, and the two paths run the same code.
  const wantsStream = req.headers.get('accept')?.includes('text/event-stream') ?? false;

  if (!wantsStream) {
    const result = await handleTurn(req, null);
    return result instanceof Response ? result : json(result);
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;

  const emit: Emit = async (event, data) => {
    if (closed) return;
    try {
      await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    } catch {
      // The client hung up. Nothing to do about it, and it must not abort the turn -- the
      // persistence and the risk record still have to finish.
      closed = true;
    }
  };

  // Deliberately not awaited: the Response has to be returned now so the client starts
  // reading. The turn keeps running and writing into the stream behind it.
  (async () => {
    try {
      const result = await handleTurn(req, emit);
      if (result instanceof Response) {
        // An early rejection -- unauthenticated, bad JSON. Deliver the status through the
        // stream, since the headers have already gone out as a 200.
        const body = await result.text();
        await emit('error', { status: result.status, body });
      } else {
        await emit('done', result);
      }
    } catch (err) {
      console.error('[magi] streamed turn failed', err);
      await emit('error', { message: 'turn_failed' });
    } finally {
      closed = true;
      try {
        await writer.close();
      } catch {
        /* already closed by the client hanging up */
      }
    }
  })();

  return new Response(readable, { status: 200, headers: SSE_HEADERS });
});

async function handleTurn(req: Request, emit: Emit | null): Promise<Response | MagiResponse> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const startedAt = Date.now();

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const openaiKey = Deno.env.get('OPENAI_API_KEY');

  if (!supabaseUrl || !anonKey) {
    console.error('[magi] SUPABASE_URL or SUPABASE_ANON_KEY is missing');
    return json({ error: 'server_misconfigured' }, 500);
  }

  // Which provider answers is a matter of configuration; nothing below this line knows.
  let llm: LlmClient;
  try {
    llm = resolveLlm({
      MAGI_LLM_PROVIDER: Deno.env.get('MAGI_LLM_PROVIDER'),
      OPENAI_API_KEY: openaiKey,
      ANTHROPIC_API_KEY: Deno.env.get('ANTHROPIC_API_KEY'),
      MAGI_MODEL: Deno.env.get('MAGI_MODEL'),
      MAGI_RISK_MODEL: Deno.env.get('MAGI_RISK_MODEL'),
    });
  } catch (err) {
    console.error(
      '[magi] language model provider is not configured:',
      err instanceof ProviderConfigError ? err.message : err,
    );
    return json({ error: 'server_misconfigured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthenticated' }, 401);

  // Every read and write in this request runs as the caller, so RLS is the boundary.
  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  /*
    Audit tables — risk_event and retrieval_trace — have no INSERT policy for `authenticated`
    by design: the record of what the system decided is written by the system, not by the
    subject of it. Both therefore need the service role. retrieval_trace was originally
    written through the caller's client and failed with 42501 on every turn.
  */
  const admin: SupabaseClient | null = serviceKey
    ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    : null;
  if (!admin) {
    console.error('[magi] SUPABASE_SERVICE_ROLE_KEY absent — risk events and retrieval traces cannot be recorded');
  }

  const { data: userData, error: userError } = await db.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'unauthenticated' }, 401);
  const accountId = userData.user.id;

  let body: MagiRequestBody;
  try {
    body = (await req.json()) as MagiRequestBody;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const userMessage = (body.message ?? '').trim();
  const isProposalOnly = Boolean(body.resolve_proposal) && userMessage.length === 0;
  if (!userMessage && !isProposalOnly) return json({ error: 'empty_message' }, 400);

  const localDate = /^\d{4}-\d{2}-\d{2}$/.test(body.local_date ?? '')
    ? body.local_date
    : new Date().toISOString().slice(0, 10);
  const timezone = body.timezone ?? 'Europe/London';

  /* ---------------- 1. lexicon ---------------- */
  const lexicon = assessLexicon(userMessage);

  /* ---------------- 2. parallel work ---------------- */
  const [ctx, embedding, modelRisk] = await Promise.all([
    loadContext({
      db,
      accountId,
      conversationId: body.conversation_id ?? null,
      localDate,
      timezone,
      provisionalTier: lexicon.tier,
    }),
    userMessage && openaiKey
      ? embed(userMessage, openaiKey).catch((err) => {
          // Retrieval is steering, not safety. Losing it degrades tone, not correctness.
          console.error('[magi] embedding failed, continuing without retrieval', err);
          return null;
        })
      : Promise.resolve(null),
    userMessage
      ? assessRiskWithModel(userMessage, llm).catch((err) => {
          console.error('[magi] model risk assessment failed', err);
          return null;
        })
      : Promise.resolve(null),
  ]);

  /* ---------------- 3. final tier ---------------- */
  const tier: RiskTier = highestTier(lexicon.tier, modelRisk?.tier ?? 'none');
  const protocol = RISK_PROTOCOL[tier];
  const involvement = guardianInvolvement(ctx.age, tier);

  const resources: CrisisResource[] = protocol.offerResources
    ? resourcesForAge(ctx.age, protocol.includeEmergency)
    : [];

  /* ---------------- 4. retrieval ---------------- */
  let candidates: RetrievalCandidate[] = [];
  if (embedding) {
    const { data, error } = await db.rpc('magi_match_intents', {
      p_embedding: toVectorLiteral(embedding),
      p_limit: 5,
      p_category_filter: null,
    });
    if (error) console.error('[magi] intent match failed', error);
    else candidates = (data ?? []) as RetrievalCandidate[];
  }

  const best = candidates[0] ?? null;
  // Below this the nearest neighbour is noise, and steering on noise is worse than not steering.
  const MATCH_FLOOR = 0.34;
  const usableMatch = best && best.similarity >= MATCH_FLOOR ? best : null;

  let tone: ResponseTone = (usableMatch?.tone as ResponseTone) ?? 'validating_supportive';
  let skill: DbtSkill | null = (usableMatch?.dbt_skill as DbtSkill) ?? null;
  let allowSomatic = usableMatch?.somatic ?? false;
  let overrideReason: string | null = null;

  if (protocol.forceCrisisTone) {
    tone = 'crisis_supportive';
    allowSomatic = true;
    // TIPP is the approach for a nervous system too activated to think, which is where
    // 'elevated' and above puts us. Retrieval's suggestion is recorded but not used.
    skill = 'Distress_Tolerance-TIPP';
    overrideReason = `risk tier ${tier} forced crisis tone`;
  }

  /* ---------------- 5. conversation row ---------------- */
  const conversationId = await ensureConversation(db, accountId, body.conversation_id ?? null);
  if (!conversationId) return json({ error: 'conversation_unavailable' }, 500);

  const deps: ExecuteDeps = { db, ctx, llm };
  const cards: MagiCard[] = [];
  const preamble: string[] = [];

  /* ---------------- 5a. resolve a pending proposal ---------------- */
  if (body.resolve_proposal) {
    const { tool, decision, input } = body.resolve_proposal;
    if (decision === 'accept') {
      const result = await applyProposal(tool, input ?? {}, deps);
      if (result.card) cards.push(result.card);
      preamble.push(`[She accepted the ${tool.replace(/_/g, ' ')} you offered. ${result.resultForModel}]`);
    } else {
      preamble.push(
        `[She rejected the ${tool.replace(/_/g, ' ')} you offered. Do not defend it, do not ask why, and do not immediately propose another. Take the correction and move on.]`,
      );
      if (tool === 'propose_insight') {
        await db.from('insight').insert({
          account_id: accountId,
          observation: String(input?.observation ?? ''),
          based_on: input?.based_on ?? {},
          state: 'rejected',
          responded_at: new Date().toISOString(),
        });
      }
    }
  }

  /* ---------------- 6. compose ---------------- */
  const system = buildSystemPrompt({
    ctx,
    tone,
    skill,
    allowSomatic,
    candidates,
    riskTier: tier,
    resources,
    possiblyHistorical: lexicon.possiblyHistoricalOrThirdParty || Boolean(modelRisk?.historical),
  });

  const messages: LlmMessage[] = ctx.transcript.map((t) =>
    t.author === 'user'
      ? { role: 'user' as const, content: t.body }
      : { role: 'assistant' as const, content: t.body },
  );

  const turnText = [...preamble, userMessage].filter(Boolean).join('\n\n');
  messages.push({ role: 'user', content: turnText || '[She tapped a button rather than typing.]' });

  const tools = toLlmTools(
    toolsForTurn({
      suppressNonEssential: protocol.suppressNonEssentialFeatures,
      tracksCycle: ctx.profile.tracks_cycle,
    }),
  );

  let reply = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let modelUsed = llm.replyModel;
  const toolCallLog: unknown[] = [];
  // Time to first token, which is the only latency number that tells you anything useful
  // about a streamed generation. Logged once per turn rather than per round.
  const turnStartedAt = Date.now();
  let firstTokenAt: number | null = null;
  // Set for the remainder of a round once a tool call appears, cleared at the top of the
  // next round -- the round that follows a tool result is the one worth showing.
  let streamSuppressed = false;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      streamSuppressed = false;
      const res = await llm.complete({
        system,
        messages,
        tools,
        maxTokens: 1024,
        // Tighter in crisis: this is not the moment for an inventive turn of phrase.
        temperature: protocol.forceCrisisTone ? 0.5 : 0.9,
        // Streamed. The result arrives fully assembled either way, so nothing downstream
        // changes; what it buys today is bytes on the wire during a long generation, and a
        // real time-to-first-token number in the logs. What it does NOT yet buy is text
        // appearing in the app as she writes -- that needs this function to stream its own
        // response to the client, which is a separate piece of work.
        stream: true,
        onToken: (delta) => {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          if (!streamSuppressed) void emit?.('token', { delta });
        },
        // The moment she starts calling a tool, whatever she has already said this round is
        // provisional. Tell the client to drop it and stop forwarding until the next round.
        onToolCallStart: () => {
          if (emit && !streamSuppressed) void emit('reset', {});
          streamSuppressed = true;
        },
      });

      inputTokens += res.usage.input;
      outputTokens += res.usage.output;
      modelUsed = res.model;

      if (res.text) reply = res.text;
      if (!res.toolCalls.length) break;

      messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls });

      for (const call of res.toolCalls) {
        const outcome = await executeTool(call.name, call.input, deps);
        if (outcome.card) cards.push(outcome.card);
        toolCallLog.push({ name: call.name, input: call.input, error: outcome.isError ?? false });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: outcome.resultForModel,
          isError: outcome.isError,
        });
      }
    }
  } catch (err) {
    console.error('[magi] reply generation failed', err);
    // A failure here must still leave the user with something safe and human.
    reply = atLeast(tier, 'elevated')
      ? "I'm here. Something's gone wrong at my end and I can't reply properly right now — but if things feel unmanageable, Samaritans are on 116 123, any time, and you can text SHOUT to 85258."
      : "Something's gone wrong at my end and I couldn't get you a proper answer. Try me again in a moment.";
  }

  if (!reply) {
    reply = atLeast(tier, 'elevated')
      ? "I'm still here with you."
      : "I'm here — say that again for me?";
  }

  // One line per turn. Time to first token is the number that matters for a streamed
  // generation -- total time mostly measures how many tool rounds the turn needed.
  console.log(
    `[magi] turn complete in ${Date.now() - turnStartedAt}ms` +
      (firstTokenAt !== null ? `, first token at ${firstTokenAt - turnStartedAt}ms` : ', no tokens streamed') +
      `, ${toolCallLog.length} tool call(s)`,
  );

  /* ---------------- 7. persist ---------------- */
  const nowIso = new Date().toISOString();
  let userMessageId: string | null = null;

  if (userMessage) {
    const { data, error } = await db
      .from('message')
      .insert({
        conversation_id: conversationId,
        account_id: accountId,
        author: 'user',
        body: userMessage,
        matched_intent_id: usableMatch?.id ?? null,
        matched_intent_score: usableMatch?.similarity ?? null,
        chosen_tone: tone,
        chosen_dbt_skill: skill,
        risk_tier: tier,
      })
      .select('id')
      .single();
    if (error) console.error('[magi] failed to persist user message', error);
    else userMessageId = data.id;
  }

  const { data: magiRow, error: magiErr } = await db
    .from('message')
    .insert({
      conversation_id: conversationId,
      account_id: accountId,
      author: 'magi',
      body: reply,
      chosen_tone: tone,
      chosen_dbt_skill: skill,
      risk_tier: tier,
      tool_calls: toolCallLog,
      model: modelUsed,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: Date.now() - startedAt,
    })
    .select('id')
    .single();
  if (magiErr) console.error('[magi] failed to persist reply', magiErr);

  if (candidates.length && userMessageId && admin) {
    await admin
      .from('retrieval_trace')
      .insert({
        account_id: accountId,
        message_id: userMessageId,
        candidates,
        chosen_intent_id: usableMatch?.id ?? null,
        chosen_similarity: usableMatch?.similarity ?? null,
        override_reason: overrideReason,
      })
      .then(({ error }) => error && console.error('[magi] retrieval trace failed', error));
  }

  /* ---------------- 8. risk record and guardian ---------------- */
  let guardianNotified = false;

  if (protocol.recordEvent) {
    if (!admin) {
      console.error('[magi] risk event NOT recorded — no service role key');
    } else {
      const { data: eventRow, error: eventErr } = await admin
        .from('risk_event')
        .insert({
          account_id: accountId,
          message_id: userMessageId,
          conversation_id: conversationId,
          tier,
          lexicon_tier: lexicon.tier,
          lexicon_reasons: lexicon.reasons,
          lexicon_matches: lexicon.matches,
          lexicon_flagged_historical: lexicon.possiblyHistoricalOrThirdParty,
          model_tier: modelRisk?.tier ?? null,
          model_rationale: modelRisk?.rationale ?? null,
          model_name: modelRisk ? llm.riskModel : null,
          age_at_event: ctx.age,
          offered_resources: protocol.offerResources,
          included_emergency: protocol.includeEmergency,
          suppressed_features: protocol.suppressNonEssentialFeatures,
          pinned_support_panel: protocol.pinSupportPanel,
          resource_ids: resources.map((r) => r.id),
        })
        .select('id')
        .single();
      if (eventErr) console.error('[magi] risk event insert failed', eventErr);

      if (involvement === 'required' && ctx.guardianLinked && protocol.guardianNotifyUnder16) {
        const { data: link } = await admin
          .from('guardian_link')
          .select('id, notify_on_high_risk')
          .eq('minor_account_id', accountId)
          .eq('state', 'verified')
          .maybeSingle();

        if (link?.notify_on_high_risk) {
          // Queued, not sent: delivery is a separate worker so that a mail outage can never
          // block or slow a reply to someone in crisis. `user_informed_before_send` is true
          // because the prompt instructs MAGI to say so in this very reply.
          const { error: notifyErr } = await admin.from('guardian_notification').insert({
            account_id: accountId,
            guardian_link_id: link.id,
            risk_event_id: eventRow?.id ?? null,
            reason: tier === 'imminent' ? 'imminent_risk' : 'high_risk',
            channel: 'email',
            user_informed_at: nowIso,
            user_informed_before_send: true,
            delivery_state: 'queued',
          });
          if (notifyErr) console.error('[magi] guardian notification queue failed', notifyErr);
          else guardianNotified = true;
        }
      }
    }
  }

  const response: MagiResponse = {
    conversation_id: conversationId,
    message_id: magiRow?.id ?? '',
    reply,
    cards,
    risk: {
      tier,
      pin_support_panel: protocol.pinSupportPanel,
      resources,
      guardian_notified: guardianNotified,
    },
    quiet_mode: protocol.suppressNonEssentialFeatures,
    debug: {
      matched_intent_id: usableMatch?.id ?? null,
      similarity: usableMatch?.similarity ?? null,
      tone,
      dbt_skill: skill,
      model: modelUsed,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: Date.now() - startedAt,
    },
  };

  return response;
}

/* ------------------------------------------------------------------ */

async function ensureConversation(
  db: SupabaseClient,
  accountId: string,
  existing: string | null,
): Promise<string | null> {
  if (existing) {
    const { data } = await db
      .from('conversation')
      .select('id')
      .eq('id', existing)
      .eq('account_id', accountId)
      .maybeSingle();
    if (data) return data.id;
  }
  const { data, error } = await db
    .from('conversation')
    .insert({ account_id: accountId })
    .select('id')
    .single();
  if (error) {
    console.error('[magi] could not create conversation', error);
    return null;
  }
  return data.id;
}

interface ModelRisk {
  tier: RiskTier;
  rationale: string;
  historical: boolean;
}

/**
 * The risk assessment is its own call with its own prompt, and it never sees MAGI's persona
 * or her instructions. That isolation is the point: a message crafted to talk MAGI into
 * something has no purchase on a model whose only job is to classify one string.
 */
async function assessRiskWithModel(message: string, llm: LlmClient): Promise<ModelRisk | null> {
  const res = await llm.complete({
    model: llm.riskModel,
    system: RISK_ASSESSOR_PROMPT,
    temperature: 0,
    maxTokens: 200,
    attempts: 2,
    jsonObject: true,
    messages: [{ role: 'user', content: message }],
  });

  const parsed = extractJsonObject(res.text);
  if (!parsed) {
    console.error('[magi] risk assessor returned no JSON:', res.text.slice(0, 200));
    return null;
  }

  const valid: RiskTier[] = ['none', 'monitor', 'elevated', 'high', 'imminent'];
  const tier = valid.includes(parsed.tier as RiskTier) ? (parsed.tier as RiskTier) : null;
  if (!tier) {
    console.error('[magi] risk assessor returned unknown tier:', parsed.tier);
    return null;
  }

  return {
    tier,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
    historical: Boolean(parsed.historical_or_third_party),
  };
}

// Referenced for its side effect of validating intent ids at module load in dev.
export const __intentCount = Object.keys(INTENTS_BY_ID).length;
