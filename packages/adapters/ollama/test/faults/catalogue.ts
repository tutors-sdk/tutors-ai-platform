/**
 * The fault catalogue: what Ollama, or the network in front of it, can do to
 * a call, each with the requirement that says what the adapter must do and
 * the whole outcome: how it settles (error kind and anchored message, or the
 * answer), how many requests it sends, how long it takes and every
 * resilience event. `catalogue.selftest.test.ts` rejects a fault that leaves
 * any of that open or cites a requirement that does not exist.
 */
import { STUB_DIGEST, STUB_MODEL } from '../stub-ollama.ts';
import { RETRY_DELAY_MS } from './targets.ts';
import type { ScriptedResponse } from './transport.ts';
import type { Answer, Fault, FaultContext, Outcome, TargetTraits } from './types.ts';

// ── The good exchange ─────────────────────────────────────────────────

export const GOOD_ANSWER: Answer = {
  depth: 'hint',
  text: 'Look again at the loop condition: what makes it false? é',
  citations: ['m1'],
  usage: { inputTokens: 120, outputTokens: 30 },
};

const MODEL_OUTPUT = JSON.stringify({ depth: GOOD_ANSWER.depth, citations: GOOD_ANSWER.citations, text: GOOD_ANSWER.text });

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const contentLine = (content: string, extra: object = {}) => line({ model: STUB_MODEL, message: { role: 'assistant', content }, done: false, ...extra });
const DONE_LINE = line({ model: STUB_MODEL, message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 120, eval_count: 30 });

/** The model output in fragments, as Ollama streams it. */
const fragments = (output = MODEL_OUTPUT) => Array.from({ length: Math.ceil(output.length / 16) }, (_, i) => output.slice(i * 16, i * 16 + 16));

const TAGS: ScriptedResponse = {
  contentType: 'application/json',
  chunks: [JSON.stringify({ models: [{ name: STUB_MODEL, model: STUB_MODEL, digest: STUB_DIGEST }] })],
};

const chat = (chunks: readonly (string | Uint8Array)[], extra: Partial<ScriptedResponse> = {}): ScriptedResponse => ({ chunks, ...extra });

const GOOD_CHAT = chat([...fragments().map((f) => contentLine(f)), DONE_LINE]);

export const GOOD_EXCHANGE: readonly ScriptedResponse[] = [TAGS, GOOD_CHAT];

// ── Helpers ────────────────────────────────────────────────────────────

const repeat = <T>(item: T, times: number): T[] => Array.from({ length: times }, () => item);

/** Nothing waits on a timer: the call settles as fast as the transport answers. */
const INSTANT = { min: 0, max: 500 } as const;

/** A timeout fault settles when the target's timeout fires (timers may fire a few ms early). */
const atTimeout = (t: TargetTraits) => ({ min: t.timeoutMs - 10, max: t.timeoutMs + 500 });

const isResilient = (t: TargetTraits) => t.attempts > 1;

/** The retry events a retryable failure produces on this target. */
const retries = (t: TargetTraits) => repeat('retry' as const, t.attempts - 1);

/** A retryable failure: every attempt fails the same way, after the delays between them. */
const retriedFailure = (t: TargetTraits, message: RegExp, requestsPerAttempt: number, before = 0): Outcome => ({
  settlement: { rejects: { kind: 'unavailable', message } },
  requests: before + requestsPerAttempt * t.attempts,
  elapsedMs: { min: (t.attempts - 1) * RETRY_DELAY_MS, max: 500 },
  events: retries(t),
});

/** A failure that is never retried. */
const finalFailure = (kind: 'rejected' | 'invalid-response', message: RegExp, requests: number): Outcome => ({
  settlement: { rejects: { kind, message } },
  requests,
  elapsedMs: INSTANT,
  events: [],
});

const resolvesGood = (requests = 2): Outcome => ({ settlement: { resolves: GOOD_ANSWER }, requests, elapsedMs: INSTANT, events: [] });

const HTML = '<html><head><title>503 Service Unavailable</title></head><body>upstream connect error</body></html>';

// ── The catalogue ──────────────────────────────────────────────────────

export const CATALOGUE: readonly Fault[] = [
  // Connections
  {
    id: 'tags-connection-refused',
    title: 'The connection to Ollama is refused before the model list',
    spec: 'LM-005',
    exchange: ({ target }) => repeat({ kind: 'refuse' }, target.attempts),
    expected: ({ target }) => retriedFailure(target, /^Ollama could not be reached: fetch failed$/, 1),
  },
  {
    id: 'chat-connection-refused',
    title: 'The model list answers, then the chat connection is refused',
    spec: 'LM-005',
    exchange: ({ target }) => [TAGS, ...repeat<ScriptedResponse>({ kind: 'refuse' }, target.attempts)],
    expected: ({ target }) => retriedFailure(target, /^Ollama could not be reached: fetch failed$/, 1, 1),
  },
  {
    id: 'chat-reset-mid-body',
    title: 'The connection resets part way through the chat body',
    spec: 'LM-005',
    exchange: ({ target }) => [TAGS, ...repeat(chat(fragments().slice(0, 2).map((f) => contentLine(f)), { then: 'reset' }), target.attempts)],
    expected: ({ target }) => retriedFailure(target, /^Ollama could not be reached: terminated$/, 1, 1),
  },
  {
    id: 'chat-stalls-after-headers',
    title: 'The chat body stalls after its first line and never finishes',
    spec: 'LM-006',
    exchange: () => [TAGS, chat([contentLine('{"depth":')], { then: 'stall' })],
    expected: ({ target }) => ({
      settlement: { rejects: { kind: 'timeout', message: new RegExp(`^Ollama did not answer within ${target.timeoutMs}ms$`) } },
      requests: 2,
      elapsedMs: atTimeout(target),
      events: [],
    }),
  },
  {
    id: 'chat-headers-never-arrive',
    title: 'The chat response headers arrive only after the timeout',
    spec: 'LM-006',
    exchange: ({ target }) => [TAGS, { ...GOOD_CHAT, headersAfterMs: target.timeoutMs + 2_000 }],
    expected: ({ target }) => ({
      settlement: { rejects: { kind: 'timeout', message: new RegExp(`^Ollama did not answer within ${target.timeoutMs}ms$`) } },
      requests: 2,
      elapsedMs: atTimeout(target),
      events: [],
    }),
  },

  // Statuses
  {
    id: 'tags-503-html',
    title: 'The model list answers 503 with an HTML page from a proxy',
    spec: 'OLL-001',
    exchange: ({ target }) => repeat<ScriptedResponse>({ status: 503, contentType: 'text/html', chunks: [HTML] }, target.attempts),
    expected: ({ target }) => retriedFailure(target, /^Ollama \/api\/tags answered 503$/, 1),
  },
  {
    id: 'chat-503-html',
    title: 'The chat answers 503 with an HTML page from a proxy',
    spec: 'OLL-001',
    exchange: ({ target }) => [TAGS, ...repeat<ScriptedResponse>({ status: 503, contentType: 'text/html', chunks: [HTML] }, target.attempts)],
    expected: ({ target }) => retriedFailure(target, /^Ollama answered 503 <html><head><title>503 Service Unavailable<\/title>/, 1, 1),
  },
  {
    id: 'chat-500-error-json',
    title: 'The chat answers 500 with Ollama\'s error JSON',
    spec: 'OLL-001',
    exchange: ({ target }) => [TAGS, ...repeat<ScriptedResponse>({ status: 500, contentType: 'application/json', chunks: ['{"error":"llama runner process has terminated"}'] }, target.attempts)],
    expected: ({ target }) => retriedFailure(target, /^Ollama answered 500 \{"error":"llama runner process has terminated"\}$/, 1, 1),
  },
  {
    id: 'chat-429-busy',
    title: 'The chat answers 429 while Ollama\'s queue is full',
    spec: 'OLL-001',
    exchange: ({ target }) => [TAGS, ...repeat<ScriptedResponse>({ status: 429, contentType: 'application/json', chunks: ['{"error":"server busy, please try again"}'] }, target.attempts)],
    expected: ({ target }) => retriedFailure(target, /^Ollama answered 429 \{"error":"server busy, please try again"\}$/, 1, 1),
  },
  {
    id: 'chat-400-bad-request',
    title: 'The chat answers 400: Ollama will never accept this request',
    spec: 'OLL-002',
    exchange: () => [TAGS, { status: 400, contentType: 'application/json', chunks: ['{"error":"invalid format schema"}'] }],
    expected: () => finalFailure('rejected', /^Ollama answered 400 \{"error":"invalid format schema"\}$/, 2),
  },
  {
    id: 'tags-404',
    title: 'The model list answers 404: the URL points at something that is not Ollama',
    spec: 'OLL-002',
    exchange: () => [{ status: 404, contentType: 'text/plain', chunks: ['404 page not found'] }],
    expected: () => finalFailure('rejected', /^Ollama \/api\/tags answered 404$/, 1),
  },
  {
    id: 'chat-recovers-after-503',
    title: 'The chat answers 503 once, then answers properly',
    spec: 'RES-009',
    appliesTo: isResilient,
    exchange: () => [TAGS, { status: 503, contentType: 'text/html', chunks: [HTML] }, GOOD_CHAT],
    expected: () => ({ settlement: { resolves: GOOD_ANSWER }, requests: 3, elapsedMs: { min: RETRY_DELAY_MS, max: 500 }, events: ['retry'] }),
  },

  // Bodies
  {
    id: 'tags-html-on-200',
    title: 'The model list answers 200 with an HTML page',
    spec: 'OLL-003',
    exchange: () => [{ status: 200, contentType: 'text/html', chunks: [HTML] }],
    expected: () => finalFailure('invalid-response', /^Ollama \/api\/tags sent a body that is not JSON$/, 1),
  },
  {
    id: 'chat-html-on-200',
    title: 'The chat answers 200 with an HTML page',
    spec: 'OLL-004',
    exchange: () => [TAGS, chat([HTML], { contentType: 'text/html' })],
    expected: () => finalFailure('invalid-response', /^Ollama sent a line that is not JSON$/, 2),
  },
  {
    id: 'chat-truncated-line',
    title: 'A chat line is cut off inside its JSON and the body ends',
    spec: 'OLL-004',
    exchange: () => [TAGS, chat([contentLine(fragments()[0]!), contentLine(fragments()[1]!).slice(0, 20)])],
    expected: () => finalFailure('invalid-response', /^Ollama sent a line that is not JSON$/, 2),
  },
  {
    id: 'chat-error-line',
    title: 'The chat streams some text, then an error line',
    spec: 'OLL-005',
    exchange: ({ target }) => [TAGS, ...repeat(chat([contentLine(fragments()[0]!), line({ error: 'CUDA error: out of memory' })]), target.attempts)],
    expected: ({ target }) => retriedFailure(target, /^Ollama error: CUDA error: out of memory$/, 1, 1),
  },
  {
    id: 'chat-ends-before-final-line',
    title: 'The chat body ends cleanly after whole lines, but before the final one',
    spec: 'OLL-006',
    exchange: ({ target }) => [TAGS, ...repeat(chat(fragments().map((f) => contentLine(f))), target.attempts)],
    expected: ({ target }) => retriedFailure(target, /^Ollama closed the response before its final line$/, 1, 1),
  },
  {
    id: 'chat-empty-body',
    title: 'The chat answers 200 with an empty body',
    spec: 'OLL-006',
    exchange: ({ target }) => [TAGS, ...repeat(chat([]), target.attempts)],
    expected: ({ target }) => retriedFailure(target, /^Ollama closed the response before its final line$/, 1, 1),
  },

  // Models
  {
    id: 'digest-mismatch',
    title: 'Ollama serves different weights under the pinned name',
    spec: 'OLL-007',
    exchange: () => [{ ...TAGS, chunks: [JSON.stringify({ models: [{ name: STUB_MODEL, digest: 'f'.repeat(64) }] })] }],
    expected: () => finalFailure('rejected', new RegExp(`^model ${STUB_MODEL.replace('.', '\\.')} has digest f{64}, expected sha256:${STUB_DIGEST}$`), 1),
  },
  {
    id: 'model-not-loaded',
    title: 'The model list does not include the pinned model',
    spec: 'OLL-008',
    exchange: ({ target }) => repeat<ScriptedResponse>({ ...TAGS, chunks: ['{"models":[]}'] }, target.attempts),
    expected: ({ target }) => retriedFailure(target, new RegExp(`^model ${STUB_MODEL.replace('.', '\\.')} is not loaded$`), 1),
  },
  {
    id: 'model-list-without-models',
    title: 'The model list is JSON without a models field',
    spec: 'OLL-008',
    exchange: ({ target }) => repeat<ScriptedResponse>({ ...TAGS, chunks: ['{}'] }, target.attempts),
    expected: ({ target }) => retriedFailure(target, new RegExp(`^model ${STUB_MODEL.replace('.', '\\.')} is not loaded$`), 1),
  },
  {
    id: 'output-not-json',
    title: 'The model writes prose instead of the JSON it was asked for',
    spec: 'OLL-009',
    exchange: () => [TAGS, chat([contentLine('Sure! The loop never ends because'), DONE_LINE])],
    expected: () => finalFailure('invalid-response', /^model output is not valid JSON$/, 2),
  },
  {
    id: 'output-outside-schema',
    title: 'The model answers JSON at a depth that does not exist',
    spec: 'OLL-009',
    exchange: () => [TAGS, chat([...fragments(JSON.stringify({ depth: 'essay', citations: ['m1'], text: 'x' })).map((f) => contentLine(f)), DONE_LINE])],
    expected: () => finalFailure('invalid-response', /^model output does not match the response schema$/, 2),
  },

  // Things that must not matter
  {
    id: 'character-split-across-chunks',
    title: 'A two-byte character arrives split across two chunks',
    spec: 'OLL-010',
    exchange: () => {
      const bytes = new TextEncoder().encode([...fragments().map((f) => contentLine(f)), DONE_LINE].join(''));
      const at = bytes.indexOf(0xc3) + 1;
      return [TAGS, chat([bytes.slice(0, at), bytes.slice(at)])];
    },
    expected: () => resolvesGood(),
  },
  {
    id: 'unknown-fields',
    title: 'Every chat line carries fields this adapter has never seen',
    spec: 'OLL-011',
    exchange: () => [TAGS, chat([...fragments().map((f) => contentLine(f, { x_future: { rev: 2 } })), DONE_LINE.replace('{', '{"x_future":true,')])],
    expected: () => resolvesGood(),
  },
  {
    id: 'wrong-content-type',
    title: 'Both answers are labelled text/plain',
    spec: 'OLL-012',
    exchange: () => [{ ...TAGS, contentType: 'text/plain' }, { ...GOOD_CHAT, contentType: 'text/plain' }],
    expected: () => resolvesGood(),
  },
  {
    id: 'final-line-without-newline',
    title: 'The whole chat body arrives in one chunk, its final line without a newline',
    spec: 'OLL-013',
    exchange: () => [TAGS, chat([[...fragments().map((f) => contentLine(f)), DONE_LINE.trimEnd()].join('')])],
    expected: () => resolvesGood(),
  },
];

export type { FaultContext };
