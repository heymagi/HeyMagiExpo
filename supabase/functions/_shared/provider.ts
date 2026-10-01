/**
 * Picks the language model provider from the environment.
 *
 * Default is OpenAI, because that is the account with credit. Setting
 * `MAGI_LLM_PROVIDER=anthropic` switches everything — replies, risk assessment and summary
 * drafting — with no other change, since all three go through the same interface.
 *
 * Embeddings are a separate concern and always OpenAI: Anthropic serves no embeddings
 * endpoint, and the `vector(1536)` column is pinned to text-embedding-3-small.
 */

import { createOpenAiClient } from './openai.ts';
import { createAnthropicClient } from './anthropic.ts';
import type { LlmClient, ProviderName } from './llm.ts';

export interface ProviderEnv {
  MAGI_LLM_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  MAGI_MODEL?: string;
  MAGI_RISK_MODEL?: string;
}

export class ProviderConfigError extends Error {}

export function resolveLlm(env: ProviderEnv): LlmClient {
  const requested = (env.MAGI_LLM_PROVIDER ?? 'openai').toLowerCase() as ProviderName;

  if (requested === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) {
      throw new ProviderConfigError(
        'MAGI_LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.',
      );
    }
    return createAnthropicClient({
      apiKey: env.ANTHROPIC_API_KEY,
      replyModel: env.MAGI_MODEL,
      riskModel: env.MAGI_RISK_MODEL,
    });
  }

  if (requested !== 'openai') {
    throw new ProviderConfigError(
      `Unknown MAGI_LLM_PROVIDER "${requested}". Use "openai" or "anthropic".`,
    );
  }

  if (!env.OPENAI_API_KEY) {
    throw new ProviderConfigError('OPENAI_API_KEY is not set.');
  }

  return createOpenAiClient({
    apiKey: env.OPENAI_API_KEY,
    replyModel: env.MAGI_MODEL,
    riskModel: env.MAGI_RISK_MODEL,
  });
}
