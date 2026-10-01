/**
 * Embeddings for scenario retrieval.
 *
 * Anthropic does not serve an embeddings endpoint, so this is pluggable. The default is
 * OpenAI text-embedding-3-small at 1536 dimensions, matching the `vector(1536)` column —
 * chosen because the previous build already had an OPENAI_API_KEY configured, so this adds
 * no new vendor relationship, and because at 80 stored vectors the cost is rounding error.
 *
 * Changing provider means changing the column dimension, hence the explicit guard below:
 * a silent dimension mismatch would produce plausible-looking nonsense matches rather than
 * an error, which is the worst possible failure mode for a component that steers tone in a
 * mental health product.
 */

export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_MODEL = 'text-embedding-3-small';

export class EmbeddingError extends Error {}

export async function embed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    throw new EmbeddingError(`embedding failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  const vector = json.data?.[0]?.embedding;

  if (!vector) throw new EmbeddingError('embedding response contained no vector');
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      `embedding dimension mismatch: got ${vector.length}, column expects ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return vector;
}

/** pgvector literal form. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
