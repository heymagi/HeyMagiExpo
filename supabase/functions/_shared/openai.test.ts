/**
 * Tests for the streamed-completion reader.
 *
 * Worth having because every conversational turn now goes through it, and the two failure
 * modes are both silent: a tool call whose arguments were assembled from fragments in the
 * wrong order becomes an empty object, and a chunk split across TCP reads becomes a dropped
 * sentence. Neither throws.
 *
 * Run: deno test --allow-env supabase/functions/_shared/openai.test.ts
 */
import assert from 'node:assert/strict';
import { createOpenAiClient } from './openai.ts';

/** Builds an SSE response, optionally chopping it into deliberately awkward pieces. */
function sseResponse(frames: unknown[], chunkSize?: number): Response {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream({
    start(controller) {
      if (!chunkSize) {
        controller.enqueue(bytes);
      } else {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.slice(i, i + chunkSize));
        }
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function withFetch(res: () => Response, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(res())) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const client = () => createOpenAiClient({ apiKey: 'test' });

const textFrames = [
  { model: 'gpt-5.6-terra', choices: [{ delta: { content: 'That' } }] },
  { choices: [{ delta: { content: "'s twice" } }] },
  { choices: [{ delta: { content: ' this week.' } }] },
  { choices: [], usage: { prompt_tokens: 120, completion_tokens: 9 } },
];

Deno.test('assembles streamed text and usage', async () => {
  await withFetch(
    () => sseResponse(textFrames),
    async () => {
      const seen: string[] = [];
      const res = await client().complete({
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
        onToken: (d) => seen.push(d),
      });
      assert.equal(res.text, "That's twice this week.");
      assert.deepEqual(seen, ['That', "'s twice", ' this week.']);
      assert.deepEqual(res.usage, { input: 120, output: 9 });
      assert.equal(res.model, 'gpt-5.6-terra');
    },
  );
});

Deno.test('survives frames split across reads', async () => {
  // Seven bytes at a time cuts through JSON, through "data:" and through the newlines.
  await withFetch(
    () => sseResponse(textFrames, 7),
    async () => {
      const res = await client().complete({
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });
      assert.equal(res.text, "That's twice this week.");
      assert.equal(res.usage.output, 9);
    },
  );
});

Deno.test('accumulates tool-call arguments across deltas, by index', async () => {
  const frames = [
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_a', function: { name: 'log_check_in', arguments: '{"over' } },
              { index: 1, id: 'call_b', function: { name: 'save_memory', arguments: '{"val' } },
            ],
          },
        },
      ],
    },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: 'ue":"cold water"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'all":"rough"}' } }] } }] },
  ];
  await withFetch(
    () => sseResponse(frames),
    async () => {
      const res = await client().complete({
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });
      assert.equal(res.toolCalls.length, 2);
      // Sorted by index, not by arrival order -- the second call finished first above.
      assert.deepEqual(res.toolCalls[0], {
        id: 'call_a',
        name: 'log_check_in',
        input: { overall: 'rough' },
      });
      assert.deepEqual(res.toolCalls[1], {
        id: 'call_b',
        name: 'save_memory',
        input: { value: 'cold water' },
      });
    },
  );
});

Deno.test('an error inside a 200 stream is raised, not silently truncated', async () => {
  const frames = [
    { choices: [{ delta: { content: 'I am here' } }] },
    { error: { message: 'upstream exploded' } },
  ];
  await withFetch(
    () => sseResponse(frames),
    async () => {
      await assert.rejects(
        () =>
          client().complete({
            messages: [{ role: 'user', content: 'hi' }],
            stream: true,
            attempts: 1,
          }),
        /upstream exploded/,
      );
    },
  );
});

Deno.test('a malformed frame is skipped rather than failing the turn', async () => {
  const body =
    'data: {"choices":[{"delta":{"content":"one "}}]}\n\n' +
    'data: {not json}\n\n' +
    'data: {"choices":[{"delta":{"content":"two"}}]}\n\n' +
    'data: [DONE]\n\n';
  await withFetch(
    () =>
      new Response(new TextEncoder().encode(body), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    async () => {
      const res = await client().complete({
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      });
      assert.equal(res.text, 'one two');
    },
  );
});
