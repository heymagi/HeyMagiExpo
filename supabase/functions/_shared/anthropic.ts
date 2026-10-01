/**
 * Anthropic messages client, behind the same interface as the OpenAI one.
 *
 * MAGI is running on OpenAI for now because that is the funded key. This path is kept live
 * rather than deleted: the prompt was written for it, and switching back is a single env var
 * (`MAGI_LLM_PROVIDER=anthropic`) once there is credit on the Anthropic account.
 *
 * The translation work is here rather than in the orchestrator. Anthropic wants content
 * blocks and groups tool results into a single user turn; the neutral shape is flat. Grouping
 * flat results into blocks is mechanical, which is why the neutral shape is the flat one.
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

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export const ANTHROPIC_REPLY_MODEL = 'claude-sonnet-5';
export const ANTHROPIC_RISK_MODEL = 'claude-sonnet-5';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicResponse {
  model: string;
  stop_reason: string | null;
  content: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> })[];
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Flat neutral messages become Anthropic turns. Consecutive tool results must be collapsed
 * into one user turn containing all their blocks, or the API rejects the sequence.
 */
function toAnthropicMessages(messages: LlmMessage[]) {
  const out: { role: 'user' | 'assistant'; content: string | Block[] }[] = [];
  let pendingResults: Block[] = [];

  const flushResults = () => {
    if (!pendingResults.length) return;
    out.push({ role: 'user', content: pendingResults });
    pendingResults = [];
  };

  for (const m of messages) {
    if (m.role === 'tool') {
      pendingResults.push({
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
        ...(m.isError ? { is_error: true } : {}),
      });
      continue;
    }

    flushResults();

    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      continue;
    }

    if (m.toolCalls?.length) {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      }
      out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({ role: 'assistant', content: m.content });
    }
  }

  flushResults();
  return out;
}

function toAnthropicTools(tools: LlmTool[] | undefined) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export function createAnthropicClient(opts: {
  apiKey: string;
  replyModel?: string;
  riskModel?: string;
}): LlmClient {
  const replyModel = opts.replyModel || ANTHROPIC_REPLY_MODEL;
  const riskModel = opts.riskModel || ANTHROPIC_RISK_MODEL;

  async function complete(
    request: Omit<LlmRequest, 'model'> & { model?: string },
  ): Promise<LlmResult> {
    const model = request.model || replyModel;
    const attempts = request.attempts ?? 3;
    let lastError: unknown;

    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxTokens ?? 1024,
      messages: toAnthropicMessages(request.messages),
    };
    if (request.system) body.system = request.system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    const tools = toAnthropicTools(request.tools);
    if (tools) body.tools = tools;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      let res: Response;
      try {
        res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': opts.apiKey,
            'anthropic-version': API_VERSION,
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
        const json = (await res.json()) as AnthropicResponse;
        const text = json.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('')
          .trim();

        // This provider does not stream yet, but the contract in llm.ts promises `onToken`
        // is called with the complete text exactly once regardless. Emitting it here means a
        // caller never has to ask which provider answered -- it just receives one large
        // fragment instead of many small ones.
        if (request.onToken && text) request.onToken(text);
        // Same contract for the tool signal: a caller that resets its display on this must
        // behave identically whichever provider answered. Fired after onToken because that
        // is the order a streaming provider produces them in.
        if (request.onToolCallStart && json.content.some((b) => b.type === 'tool_use')) {
          request.onToolCallStart();
        }

        return {
          text,
          toolCalls: json.content
            .filter(
              (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
                b.type === 'tool_use',
            )
            .map((b) => ({ id: b.id, name: b.name, input: b.input })),
          usage: { input: json.usage.input_tokens, output: json.usage.output_tokens },
          model: json.model ?? model,
        };
      }

      const text = await res.text();
      const retryable = RETRYABLE_STATUS.has(res.status);
      const error = new LlmError(
        `Anthropic ${res.status}: ${text.slice(0, 400)}`,
        res.status,
        retryable,
      );
      if (!retryable || attempt === attempts) throw error;
      lastError = error;
      await backoff(attempt);
    }

    throw lastError instanceof Error ? lastError : new Error('Anthropic call failed');
  }

  return { provider: 'anthropic', replyModel, riskModel, complete };
}
