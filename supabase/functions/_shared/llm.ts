/**
 * Provider-neutral language model interface.
 *
 * MAGI was written against Anthropic, and is now running on OpenAI because that is the key
 * with credit on it. Rather than rewrite the orchestrator for the second provider and then
 * again for the third, the two shapes meet behind this interface: one env var swaps them, and
 * the prompt, tools, risk protocol and tool executor never know which is answering.
 *
 * The neutral message shape is closer to OpenAI's (a flat list with tool messages) than to
 * Anthropic's (content blocks), because a flat list is the easier of the two to translate
 * *into* — grouping flat tool results into one Anthropic user message is mechanical, whereas
 * splitting content blocks back out is lossy.
 */

export type ProviderName = 'openai' | 'anthropic';

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  /** Provider-issued id, echoed back with the result so the model can pair them up. */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface LlmRequest {
  model: string;
  system?: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxTokens?: number;
  /**
   * Left undefined on purpose by callers that do not care. Several recent models reject any
   * value other than the default, so the providers below only send it when it is set, and
   * drop it and retry if the API objects.
   */
  temperature?: number;
  /** Ask for a bare JSON object. Used by the risk assessor. */
  jsonObject?: boolean;
  /** Total attempts including the first. */
  attempts?: number;
  /**
   * Stream the completion instead of waiting for the whole thing.
   *
   * The result shape is identical either way -- text, tool calls and usage all arrive
   * assembled -- so a caller can turn this on without changing how it reads the answer. What
   * it buys is `onToken`, and bytes on the wire while a long generation is still running,
   * which is what keeps an edge function from looking idle to the platform.
   *
   * Not for the risk assessor. That call wants one small JSON object; streaming it would add
   * partial-JSON handling to the one code path where a parse failure matters most.
   */
  stream?: boolean;
  /**
   * Called with each text fragment as it arrives, in order.
   *
   * Guaranteed to be called with the complete text exactly once even by a provider that
   * cannot stream, so a caller never has to branch on which provider is answering. Tool-call
   * arguments are NOT streamed through here: half a JSON object is not useful to anyone.
   */
  onToken?: (delta: string) => void;
  /**
   * Called once per completion, the first time a tool-call fragment appears.
   *
   * The signal a caller needs is not the tool's name or arguments -- those arrive assembled
   * in the result -- but simply that anything streamed through `onToken` so far is now
   * provisional, because the model is about to act rather than answer.
   */
  onToolCallStart?: () => void;
}

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
  usage: { input: number; output: number };
  model: string;
}

export interface LlmClient {
  readonly provider: ProviderName;
  readonly replyModel: string;
  readonly riskModel: string;
  complete(request: Omit<LlmRequest, 'model'> & { model?: string }): Promise<LlmResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** Exponential backoff with jitter: ~300ms, ~900ms. */
export async function backoff(attempt: number): Promise<void> {
  const base = 300 * Math.pow(3, attempt - 1);
  await new Promise((r) => setTimeout(r, base + Math.random() * 200));
}

/**
 * Extracts a JSON object from a model response that may or may not have obeyed an
 * instruction to return bare JSON. Used by the risk assessor, where a fenced code block or a
 * stray sentence must not cause the safety assessment to be discarded.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : raw).match(/\{[\s\S]*\}/);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate[0]);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
