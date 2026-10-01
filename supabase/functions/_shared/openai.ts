/**
 * OpenAI chat-completions client.
 *
 * Written defensively about request parameters, because the parameter surface has moved
 * between model generations: `max_tokens` became `max_completion_tokens`, and several recent
 * models reject any `temperature` other than the default. Rather than pin assumptions that
 * break silently on the next model, an unsupported-parameter 400 drops the offending
 * parameter and retries once. A wellbeing app cannot show someone an API error because a
 * field was renamed.
 *
 * Verify the configured model in one command before relying on it:
 *   node scripts/smoke-llm.mjs
 */

import {
  backoff,
  LlmError,
  RETRYABLE_STATUS,
  type LlmClient,
  type LlmMessage,
  type LlmRequest,
  type LlmResult,
  type LlmTool,
} from './llm.ts';

const API_URL = 'https://api.openai.com/v1/chat/completions';

/** Balanced intelligence and cost — the right default for per-turn conversation. */
export const OPENAI_REPLY_MODEL = 'gpt-5.6-terra';

/**
 * The risk assessor defaults to the same model as the reply. Recall on novel phrasing is the
 * entire reason there is a model in the safety path at all — the lexicon already covers the
 * phrasings we thought of. `gpt-5.6-luna` will cut cost, but that is a deliberate reduction
 * in safety headroom and should be a decision, not a default.
 */
export const OPENAI_RISK_MODEL = 'gpt-5.6-terra';

interface OpenAiToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

interface OpenAiResponse {
  model: string;
  choices: {
    finish_reason: string;
    message: { content: string | null; tool_calls?: OpenAiToolCall[] };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function toOpenAiMessages(system: string | undefined, messages: LlmMessage[]) {
  const out: Record<string, unknown>[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const entry: Record<string, unknown> = { role: 'assistant' };
      // An assistant turn that only called tools has no content; the field must be null
      // rather than an empty string or the API rejects the turn.
      entry.content = m.content || null;
      if (m.toolCalls?.length) {
        entry.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        }));
      }
      out.push(entry);
      continue;
    }
    out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
  }
  return out;
}

function toOpenAiTools(tools: LlmTool[] | undefined) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      // Not `strict: true`: strict mode requires every property to appear in `required`, and
      // MAGI's tools are deliberately full of optional fields — a check-in with only a mood,
      // a challenge with no detail. Strict would force her to invent values.
    },
  }));
}

/** Parameters the API may reject depending on the model, mapped to how to recover. */
const PARAMETER_FALLBACKS: {
  detect: RegExp;
  drop: string;
  replaceWith?: string;
  /** Dropped alongside, for parameters that are only valid together. */
  alsoDrop?: string[];
}[] = [
  { detect: /max_tokens.*not supported|use ['"]?max_completion_tokens/i, drop: 'max_tokens', replaceWith: 'max_completion_tokens' },
  { detect: /max_completion_tokens.*(unsupported|unrecognized|not supported)/i, drop: 'max_completion_tokens', replaceWith: 'max_tokens' },
  { detect: /temperature.*(unsupported|not supported|does not support|only the default)/i, drop: 'temperature' },
  { detect: /response_format.*(unsupported|not supported)/i, drop: 'response_format' },
  { detect: /parallel_tool_calls.*(unsupported|not supported)/i, drop: 'parallel_tool_calls' },
  { detect: /reasoning_effort.*(unsupported|not supported|unrecognized)/i, drop: 'reasoning_effort' },
  // If streaming is refused, fall back to a single response rather than failing the turn.
  // `stream_options` goes with it: it is only valid alongside `stream`.
  { detect: /stream_options.*(unsupported|not supported|unrecognized)/i, drop: 'stream_options' },
  { detect: /['"]?stream['"]?.*(unsupported|not supported|not allowed|unrecognized)/i, drop: 'stream', alsoDrop: ['stream_options'] },
];

/**
 * Set when the request carries tools.
 *
 * The gpt-5.6 models reason by default, and chat-completions refuses to combine reasoning
 * with function tools: "Function tools with reasoning_effort are not supported ... use
 * /v1/responses or set reasoning_effort to 'none'". Since every conversational turn carries
 * MAGI's tool list, tool-bearing calls have to opt out explicitly.
 *
 * Deliberately NOT applied to the risk assessment, which carries no tools — that call keeps
 * the model's default reasoning, which is exactly where the extra care is worth paying for.
 *
 * Overridable with MAGI_REASONING_EFFORT if a future model lifts the restriction.
 */
const TOOL_REASONING_EFFORT = Deno.env.get('MAGI_REASONING_EFFORT') ?? 'none';

export function createOpenAiClient(opts: {
  apiKey: string;
  replyModel?: string;
  riskModel?: string;
}): LlmClient {
  const replyModel = opts.replyModel || OPENAI_REPLY_MODEL;
  const riskModel = opts.riskModel || OPENAI_RISK_MODEL;

  async function complete(
    request: Omit<LlmRequest, 'model'> & { model?: string },
  ): Promise<LlmResult> {
    const model = request.model || replyModel;
    const attempts = request.attempts ?? 3;

    const body: Record<string, unknown> = {
      model,
      messages: toOpenAiMessages(request.system, request.messages),
      max_completion_tokens: request.maxTokens ?? 1024,
    };
    const tools = toOpenAiTools(request.tools);
    if (tools) {
      body.tools = tools;
      body.reasoning_effort = TOOL_REASONING_EFFORT;
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.jsonObject) body.response_format = { type: 'json_object' };
    if (request.stream) {
      body.stream = true;
      // Usage is omitted from a streamed response unless asked for, and losing per-turn token
      // counts would quietly break the cost telemetry the app writes for every turn.
      body.stream_options = { include_usage: true };
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      let res: Response;
      try {
        res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.apiKey}`,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        lastError = err;
        if (attempt === attempts) throw err;
        await backoff(attempt);
        continue;
      }

      if (res.ok) {
        if (body.stream === true) {
          return await readStreamedCompletion(res, model, request.onToken, request.onToolCallStart);
        }
        const json = (await res.json()) as OpenAiResponse;
        const choice = json.choices?.[0];
        const rawCalls = choice?.message?.tool_calls ?? [];

        return {
          text: (choice?.message?.content ?? '').trim(),
          toolCalls: rawCalls.map((c) => ({
            id: c.id,
            name: c.function.name,
            // Arguments arrive as a JSON string, and a malformed one must not throw here —
            // an empty object lets the tool executor report a clean failure instead.
            input: safeParseArguments(c.function.arguments, c.function.name),
          })),
          usage: {
            input: json.usage?.prompt_tokens ?? 0,
            output: json.usage?.completion_tokens ?? 0,
          },
          model: json.model ?? model,
        };
      }

      const text = await res.text();

      // A renamed or unsupported parameter is recoverable: drop it and go again.
      if (res.status === 400) {
        const fallback = PARAMETER_FALLBACKS.find((f) => f.detect.test(text));
        if (fallback && fallback.drop in body) {
          const value = body[fallback.drop];
          delete body[fallback.drop];
          for (const also of fallback.alsoDrop ?? []) delete body[also];
          if (fallback.replaceWith) body[fallback.replaceWith] = value;
          console.warn(
            `[llm] ${model} rejected "${fallback.drop}"; ` +
              (fallback.replaceWith ? `retrying as "${fallback.replaceWith}".` : 'retrying without it.'),
          );
          continue;
        }
      }

      const retryable = RETRYABLE_STATUS.has(res.status);
      const error = new LlmError(
        `OpenAI ${res.status}: ${text.slice(0, 400)}`,
        res.status,
        retryable,
      );
      if (!retryable || attempt === attempts) throw error;
      lastError = error;
      await backoff(attempt);
    }

    throw lastError instanceof Error ? lastError : new Error('OpenAI call failed');
  }

  return { provider: 'openai', replyModel, riskModel, complete };
}

function safeParseArguments(raw: string, toolName: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    console.error(`[llm] could not parse arguments for tool "${toolName}":`, raw.slice(0, 200));
    return {};
  }
}

/**
 * Reads a streamed chat completion and returns it in exactly the same shape as a
 * non-streamed one.
 *
 * Three things about the OpenAI SSE format are easy to get wrong and all of them are
 * handled here:
 *
 *   - a chunk can be split across TCP reads, so lines are buffered until a newline arrives
 *     rather than parsed per read;
 *   - tool calls arrive as deltas keyed by `index`, with the id and name usually in the first
 *     delta and the arguments dribbling in as string fragments across many. They have to be
 *     accumulated by index and parsed only at the end -- parsing early gives you a
 *     SyntaxError on a half-written object;
 *   - errors can appear INSIDE a 200 stream. Without the check below, a mid-stream failure
 *     would silently return a truncated reply as though it were complete, which in this app
 *     could mean a half-finished sentence to someone in distress.
 */
async function readStreamedCompletion(
  res: Response,
  fallbackModel: string,
  onToken?: (delta: string) => void,
  onToolCallStart?: () => void,
): Promise<LlmResult> {
  if (!res.body) throw new LlmError('OpenAI returned no stream body', 502, true);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, { id: string; name: string; args: string }>();

  let buffer = '';
  let text = '';
  let model = fallbackModel;
  let usage = { input: 0, output: 0 };
  let sawUsage = false;
  let announcedToolCall = false;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;

    let chunk: Record<string, any>;
    try {
      chunk = JSON.parse(payload);
    } catch {
      // A single malformed frame is not worth failing a turn over.
      console.warn('[llm] unparseable stream frame:', payload.slice(0, 160));
      return;
    }

    if (chunk.error) {
      const message = typeof chunk.error?.message === 'string' ? chunk.error.message : 'stream error';
      throw new LlmError(`OpenAI stream error: ${message}`, 502, true);
    }

    if (typeof chunk.model === 'string') model = chunk.model;
    if (chunk.usage) {
      usage = {
        input: chunk.usage.prompt_tokens ?? 0,
        output: chunk.usage.completion_tokens ?? 0,
      };
      sawUsage = true;
    }

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;

    if (typeof delta.content === 'string' && delta.content.length) {
      text += delta.content;
      onToken?.(delta.content);
    }

    if ((delta.tool_calls ?? []).length && !announcedToolCall) {
      announcedToolCall = true;
      onToolCallStart?.();
    }

    for (const call of delta.tool_calls ?? []) {
      const index: number = call.index ?? 0;
      const current = calls.get(index) ?? { id: '', name: '', args: '' };
      if (call.id) current.id = call.id;
      if (call.function?.name) current.name += call.function.name;
      if (call.function?.arguments) current.args += call.function.arguments;
      calls.set(index, current);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    if (buffer.trim()) handleLine(buffer);
  } finally {
    // Releasing the lock matters on Deno: an abandoned reader keeps the connection open for
    // the rest of the function invocation.
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }

  if (!sawUsage) {
    console.warn('[llm] streamed response carried no usage; token counts for this turn are 0.');
  }

  return {
    text: text.trim(),
    toolCalls: [...calls.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({
        id: c.id,
        name: c.name,
        input: safeParseArguments(c.args, c.name),
      })),
    usage,
    model,
  };
}
