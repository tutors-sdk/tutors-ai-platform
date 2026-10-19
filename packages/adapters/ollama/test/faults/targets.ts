/**
 * The targets every fault is served to: the adapter's two calls, and the
 * completion as the inference API runs it, behind the resilience decorator.
 */
import { ResilientLanguageModel } from '@tutors-ai/adapter-resilience';
import type { Completion, LanguageModel } from '@tutors-ai/core';
import { aCompletionRequest } from '@tutors-ai/testing';
import { OllamaLanguageModel } from '../../src/index.ts';
import { STUB_DIGEST, STUB_MODEL } from '../stub-ollama.ts';
import type { Answer, Target } from './types.ts';

/** Short enough that a stalled fault costs little, long enough to dwarf scheduling noise. */
export const TIMEOUT_MS = 300;

/** The resilient target retries once, after a fixed 10 ms (base 20 ms, jitter pinned at one half). */
export const RETRY_DELAY_MS = 10;

const ollama = (fetch: typeof globalThis.fetch) =>
  new OllamaLanguageModel({ baseUrl: 'http://ollama.test:11434', model: STUB_MODEL, digest: STUB_DIGEST, fetch });

const answer = ({ depth, text, citations, usage }: Completion): Answer => ({ depth, text, citations, usage });

const request = () => aCompletionRequest({ timeoutMs: TIMEOUT_MS });

async function streamed(model: LanguageModel): Promise<Answer> {
  let deltas = '';
  let final: Completion | undefined;
  for await (const chunk of model.stream(request())) {
    if (chunk.kind === 'delta') {
      if (chunk.text === '') throw new Error('the stream yielded an empty delta');
      deltas += chunk.text;
    }
    else final = chunk.completion;
  }
  if (final === undefined) throw new Error('the stream ended without a completion');
  // LM-004: the deltas spell out the final text.
  if (deltas !== final.text) throw new Error(`the deltas spelled "${deltas}" but the completion says "${final.text}"`);
  return answer(final);
}

export const TARGETS: readonly Target[] = [
  {
    name: 'complete',
    attempts: 1,
    timeoutMs: TIMEOUT_MS,
    call: async (fetch) => answer(await ollama(fetch).complete(request())),
  },
  {
    name: 'stream',
    attempts: 1,
    timeoutMs: TIMEOUT_MS,
    call: (fetch) => streamed(ollama(fetch)),
  },
  {
    name: 'resilient complete',
    attempts: 2,
    timeoutMs: TIMEOUT_MS,
    call: async (fetch, events) => {
      const model = new ResilientLanguageModel(
        ollama(fetch),
        {
          circuit: { failureThreshold: 100, resetAfterMs: 60_000 },
          retries: 1,
          backoff: { baseMs: 2 * RETRY_DELAY_MS, maxMs: 2 * RETRY_DELAY_MS },
          bulkhead: { maxConcurrent: 1, maxQueued: 0 },
        },
        { random: () => 0.5, observe: (e) => events.push(e.type) },
      );
      return answer(await model.complete(request()));
    },
  },
];
