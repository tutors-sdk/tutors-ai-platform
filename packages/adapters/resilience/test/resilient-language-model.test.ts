import { PortError } from '@tutors-ai/core';
import { aCompletionRequest } from '@tutors-ai/testing';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RESILIENCE, ResilientLanguageModel, type ResilienceEvent, type ResilienceOptions } from '../src/index.ts';
import { COMPLETION, ControlledModel, invalid, ManualTimer, outcome, rejected, settle, timeout, unavailable } from './support.ts';

const OPTIONS: ResilienceOptions = {
  circuit: { failureThreshold: 3, resetAfterMs: 1_000 },
  retries: 2,
  backoff: { baseMs: 100, maxMs: 1_000 },
  bulkhead: { maxConcurrent: 2, maxQueued: 1 },
};

function subject(options: Partial<ResilienceOptions> = {}, random = () => 0.5) {
  const model = new ControlledModel();
  const timer = new ManualTimer();
  const events: ResilienceEvent[] = [];
  const resilient = new ResilientLanguageModel(model, { ...OPTIONS, ...options }, { timer, random, observe: (e) => events.push(e) });
  return { model, timer, events, resilient };
}

const request = (timeoutMs = 10_000) => aCompletionRequest({ timeoutMs });

async function expectPortError(promise: Promise<unknown>, kind: PortError['kind'], message: RegExp): Promise<void> {
  const { error } = await outcome(promise);
  expect(PortError.is(error)).toBe(true);
  expect((error as PortError).kind).toBe(kind);
  expect((error as PortError).port).toBe('LanguageModel');
  expect((error as PortError).message).toMatch(message);
}

/** Fails `n` new calls in a row as `error`, without retries, and waits for them to settle. */
async function failCalls(s: ReturnType<typeof subject>, n: number, error: () => unknown = unavailable) {
  for (let i = 0; i < n; i += 1) {
    const call = outcome(s.resilient.complete(request()));
    await settle();
    s.model.open.at(-1)?.reject(error());
    await call;
  }
}

describe('ResilientLanguageModel: circuit', () => {
  it('RES-001 passes calls through while closed, handing over the request and returning the completion', async () => {
    const s = subject();
    const call = s.resilient.complete(request(5_000));
    await settle();
    expect(s.model.calls).toHaveLength(1);
    expect(s.model.calls[0]?.request.question).toBe(request().question);
    expect(s.model.calls[0]?.request.timeoutMs).toBe(5_000);
    s.model.calls[0]?.resolve();
    expect(await call).toBe(COMPLETION);
    expect(s.resilient.circuit).toBe('closed');
    expect(s.events).toEqual([]);
  });

  it('RES-002 opens after the configured number of consecutive server failures, timeouts included', async () => {
    const s = subject({ retries: 0 });
    await failCalls(s, 1, unavailable);
    await failCalls(s, 1, timeout);
    expect(s.resilient.circuit).toBe('closed');
    await failCalls(s, 1, unavailable);
    expect(s.resilient.circuit).toBe('open');
    expect(s.events).toEqual([{ type: 'circuit', from: 'closed', to: 'open' }]);
  });

  it('RES-002 counts only consecutive failures: an answer in between starts the count again', async () => {
    const s = subject({ retries: 0 });
    await failCalls(s, 2);
    const ok = s.resilient.complete(request());
    await settle();
    s.model.open[0]?.resolve();
    await ok;
    await failCalls(s, 2);
    expect(s.resilient.circuit).toBe('closed');
    await failCalls(s, 1);
    expect(s.resilient.circuit).toBe('open');
  });

  it('RES-003 fails fast while open, without calling the model, and reports the shed call', async () => {
    const s = subject({ retries: 0 });
    await failCalls(s, 3);
    const calls = s.model.calls.length;
    s.events.length = 0;
    await expectPortError(s.resilient.complete(request()), 'unavailable', /^the circuit to the model is open; the call failed fast$/);
    expect(s.model.calls).toHaveLength(calls);
    expect(s.events).toEqual([{ type: 'shed', reason: 'circuit-open' }]);
    await s.timer.advance(999);
    await expectPortError(s.resilient.complete(request()), 'unavailable', /circuit to the model is open/);
    expect(s.model.calls).toHaveLength(calls);
  });

  it('RES-004 admits exactly one probe once the reset period has passed, and refuses the rest while it runs', async () => {
    const s = subject({ retries: 0 });
    await failCalls(s, 3);
    await s.timer.advance(1_000);
    expect(s.resilient.circuit).toBe('open');
    const probe = s.resilient.complete(request());
    await settle();
    expect(s.resilient.circuit).toBe('half-open');
    expect(s.model.open).toHaveLength(1);
    await expectPortError(s.resilient.complete(request()), 'unavailable', /circuit to the model is open/);
    expect(s.model.open).toHaveLength(1);
    s.model.open[0]?.resolve();
    await probe;
  });

  it('RES-005 closes when the probe gets an answer, and then passes calls through again', async () => {
    const s = subject({ retries: 0 });
    await failCalls(s, 3);
    await s.timer.advance(1_000);
    const probe = s.resilient.complete(request());
    await settle();
    s.model.open[0]?.resolve();
    expect(await probe).toBe(COMPLETION);
    expect(s.resilient.circuit).toBe('closed');
    expect(s.events.filter((e) => e.type === 'circuit')).toEqual([
      { type: 'circuit', from: 'closed', to: 'open' },
      { type: 'circuit', from: 'open', to: 'half-open' },
      { type: 'circuit', from: 'half-open', to: 'closed' },
    ]);
    // Closed again with a fresh count: it takes the full threshold to open.
    await failCalls(s, 2);
    expect(s.resilient.circuit).toBe('closed');
  });

  it('RES-006 opens again for another full reset period when the probe fails', async () => {
    const s = subject({ retries: 0 });
    await failCalls(s, 3);
    await s.timer.advance(1_500);
    await failCalls(s, 1, timeout);
    expect(s.resilient.circuit).toBe('open');
    await s.timer.advance(999);
    await expectPortError(s.resilient.complete(request()), 'unavailable', /circuit to the model is open/);
    await s.timer.advance(1);
    const probe = s.resilient.complete(request());
    await settle();
    expect(s.resilient.circuit).toBe('half-open');
    s.model.open[0]?.resolve();
    await probe;
  });

  it('RES-007 ignores the outcome of a call admitted before the circuit changed state', async () => {
    const s = subject({ retries: 0, bulkhead: { maxConcurrent: 10, maxQueued: 0 } });
    const slowSuccess = s.resilient.complete(request());
    const slowFailure = outcome(s.resilient.complete(request()));
    await settle();
    await failCalls(s, 3);
    expect(s.resilient.circuit).toBe('open');
    // A success admitted while closed cannot close an open circuit.
    s.model.calls[0]?.resolve();
    await slowSuccess;
    expect(s.resilient.circuit).toBe('open');
    await s.timer.advance(1_000);
    const probe = outcome(s.resilient.complete(request()));
    await settle();
    // A failure admitted while closed cannot reopen a half-open circuit.
    s.model.calls[1]?.reject(unavailable());
    await slowFailure;
    expect(s.resilient.circuit).toBe('half-open');
    s.model.open[0]?.reject(unavailable());
    await probe;
    expect(s.resilient.circuit).toBe('open');
  });

  it('RES-008 counts invalid and rejected responses as answers: they neither open the circuit nor fail a probe', async () => {
    const s = subject({ retries: 0 });
    await failCalls(s, 2);
    await failCalls(s, 1, invalid);
    await failCalls(s, 2);
    await failCalls(s, 1, rejected);
    await failCalls(s, 2);
    await failCalls(s, 1, () => new Error('a bug, not an outage'));
    expect(s.resilient.circuit).toBe('closed');
    await failCalls(s, 3);
    await s.timer.advance(1_000);
    await failCalls(s, 1, invalid);
    expect(s.resilient.circuit).toBe('closed');
  });
});

describe('ResilientLanguageModel: retry', () => {
  it('RES-009 retries an unavailable call after a jittered delay below the doubling ceiling, then answers', async () => {
    const s = subject({}, () => 0.5);
    const call = s.resilient.complete(request());
    await settle();
    s.model.open[0]?.reject(unavailable());
    await settle();
    expect(s.events).toEqual([{ type: 'retry', retry: 1, delayMs: 50, cause: 'connection refused' }]);
    await s.timer.advance(49);
    expect(s.model.calls).toHaveLength(1);
    await s.timer.advance(1);
    expect(s.model.calls).toHaveLength(2);
    s.model.open[0]?.reject(unavailable());
    await settle();
    expect(s.events[1]).toEqual({ type: 'retry', retry: 2, delayMs: 100, cause: 'connection refused' });
    await s.timer.advance(100);
    expect(s.model.calls).toHaveLength(3);
    s.model.open[0]?.resolve();
    expect(await call).toBe(COMPLETION);
  });

  it('RES-009 gives up after the configured retries with the last error', async () => {
    const s = subject({ retries: 1 }, () => 0);
    const call = outcome(s.resilient.complete(request()));
    await settle();
    s.model.open[0]?.reject(unavailable());
    await s.timer.advance(0);
    const last = new PortError('LanguageModel', 'unavailable', 'still refused');
    s.model.open[0]?.reject(last);
    expect((await call).error).toBe(last);
    expect(s.model.calls).toHaveLength(2);
  });

  it('RES-009 retries count against the circuit, and stop when it opens', async () => {
    const s = subject({ retries: 5, circuit: { failureThreshold: 2, resetAfterMs: 1_000 } }, () => 0);
    const call = s.resilient.complete(request());
    await settle();
    s.model.open[0]?.reject(unavailable());
    await s.timer.advance(0);
    s.model.open[0]?.reject(unavailable());
    // The circuit opened on the second failure: the call ends with that failure, without waiting.
    await expectPortError(call, 'unavailable', /^connection refused$/);
    expect(s.model.calls).toHaveLength(2);
    expect(s.events.map((e) => e.type)).toEqual(['retry', 'circuit']);
  });

  it('RES-010 does not retry a timeout, an invalid response, a rejection or an error that is not a port error', async () => {
    for (const error of [timeout(), invalid(), rejected(), new TypeError('bug')]) {
      const s = subject();
      const call = outcome(s.resilient.complete(request()));
      await settle();
      s.model.open[0]?.reject(error);
      expect((await call).error).toBe(error);
      await s.timer.advance(10_000);
      expect(s.model.calls).toHaveLength(1);
      expect(s.events).toEqual([]);
    }
  });

  it('RES-011 gives each attempt only the time that remains and never starts a retry it cannot finish', async () => {
    const s = subject({ retries: 3, backoff: { baseMs: 400, maxMs: 400 } }, () => 0.5);
    const call = outcome(s.resilient.complete(request(1_000)));
    await settle();
    await s.timer.advance(300);
    s.model.open[0]?.reject(unavailable());
    await settle();
    await s.timer.advance(200);
    expect(s.model.calls[1]?.request.timeoutMs).toBe(500);
    await s.timer.advance(299);
    s.model.open[0]?.reject(unavailable());
    // Now at 799ms: a 200ms delay would end at 999ms, so the retry starts with 1ms left.
    await s.timer.advance(200);
    expect(s.model.calls[2]?.request.timeoutMs).toBe(1);
    s.model.open[0]?.reject(unavailable());
    // At 999ms another 200ms delay would pass the deadline: the call fails now.
    const { error } = await call;
    expect((error as PortError).message).toBe('connection refused');
    expect(s.model.calls).toHaveLength(3);
    expect(s.events.filter((e) => e.type === 'retry')).toHaveLength(2);
  });

  it('RES-011 does not retry when the delay would end exactly at the deadline', async () => {
    const s = subject({ retries: 3, backoff: { baseMs: 200, maxMs: 200 } }, () => 0.5);
    const call = outcome(s.resilient.complete(request(1_000)));
    await settle();
    await s.timer.advance(900);
    s.model.open[0]?.reject(unavailable());
    expect(PortError.is((await call).error)).toBe(true);
    expect(s.model.calls).toHaveLength(1);
  });
});

describe('ResilientLanguageModel: bulkhead', () => {
  it('RES-012 queues calls beyond the concurrency limit and admits them in arrival order', async () => {
    const s = subject({ bulkhead: { maxConcurrent: 1, maxQueued: 2 } });
    const first = s.resilient.complete(aCompletionRequest({ question: 'first', timeoutMs: 10_000 }));
    const second = s.resilient.complete(aCompletionRequest({ question: 'second', timeoutMs: 10_000 }));
    const third = s.resilient.complete(aCompletionRequest({ question: 'third', timeoutMs: 10_000 }));
    await settle();
    expect(s.model.calls.map((c) => c.request.question)).toEqual(['first']);
    s.model.open[0]?.resolve();
    await first;
    await settle();
    expect(s.model.calls.map((c) => c.request.question)).toEqual(['first', 'second']);
    s.model.open[0]?.reject(invalid());
    await outcome(second);
    await settle();
    expect(s.model.calls.map((c) => c.request.question)).toEqual(['first', 'second', 'third']);
    s.model.open[0]?.resolve();
    await third;
    expect(s.timer.pending).toBe(0);
  });

  it('RES-012 counts queueing against the timeout the model is given', async () => {
    const s = subject({ bulkhead: { maxConcurrent: 1, maxQueued: 1 } });
    const first = s.resilient.complete(request());
    const second = s.resilient.complete(request(1_000));
    await settle();
    await s.timer.advance(400);
    s.model.open[0]?.resolve();
    await first;
    await settle();
    expect(s.model.calls[1]?.request.timeoutMs).toBe(600);
    s.model.open[0]?.resolve();
    await second;
  });

  it('RES-013 sheds a call at once when the queue is full', async () => {
    const s = subject({ bulkhead: { maxConcurrent: 1, maxQueued: 1 } });
    const first = s.resilient.complete(request());
    const second = s.resilient.complete(request());
    await settle();
    await expectPortError(s.resilient.complete(request()), 'unavailable', /^the model is saturated; the call was shed$/);
    expect(s.events).toEqual([{ type: 'shed', reason: 'queue-full' }]);
    expect(s.model.calls).toHaveLength(1);
    s.model.open[0]?.resolve();
    await first;
    await settle();
    s.model.open[0]?.resolve();
    await second;
  });

  it('RES-013 with no queue, sheds the call that finds every place taken', async () => {
    const s = subject({ bulkhead: { maxConcurrent: 1, maxQueued: 0 } });
    const first = s.resilient.complete(request());
    await expectPortError(s.resilient.complete(request()), 'unavailable', /saturated/);
    await settle();
    s.model.open[0]?.resolve();
    await first;
  });

  it('RES-014 fails a call that is still queued at its timeout, and gives its place to no one', async () => {
    const s = subject({ bulkhead: { maxConcurrent: 1, maxQueued: 2 } });
    const first = s.resilient.complete(request());
    const late = outcome(s.resilient.complete(request(500)));
    const third = s.resilient.complete(request());
    await settle();
    await s.timer.advance(499);
    expect(s.events).toEqual([]);
    await s.timer.advance(1);
    await expectPortError(late.then(({ error }) => Promise.reject(error)), 'timeout', /^the model was busy until the request timed out$/);
    expect(s.events).toEqual([{ type: 'shed', reason: 'queue-timeout' }]);
    s.model.open[0]?.resolve();
    await first;
    await settle();
    // The timed-out call never reaches the model; the next in line does.
    expect(s.model.calls).toHaveLength(2);
    s.model.open[0]?.resolve();
    await third;
    // Every place is free again.
    const a = s.resilient.complete(request());
    await settle();
    expect(s.model.open).toHaveLength(1);
    s.model.open[0]?.resolve();
    await a;
    expect(s.timer.pending).toBe(0);
  });

  it('RES-003 does not queue behind calls in flight while the circuit is open', async () => {
    const s = subject({ retries: 0, bulkhead: { maxConcurrent: 1, maxQueued: 5 } });
    await failCalls(s, 3);
    s.events.length = 0;
    await expectPortError(s.resilient.complete(request()), 'unavailable', /circuit to the model is open/);
    expect(s.events).toEqual([{ type: 'shed', reason: 'circuit-open' }]);
  });

  it('RES-004 a call queued behind the probe is refused when its turn comes', async () => {
    const s = subject({ retries: 0, bulkhead: { maxConcurrent: 1, maxQueued: 5 } });
    await failCalls(s, 3);
    await s.timer.advance(1_000);
    const probe = s.resilient.complete(request());
    await settle();
    expect(s.resilient.circuit).toBe('half-open');
    // The circuit refuses this call before it queues.
    await expectPortError(s.resilient.complete(request()), 'unavailable', /circuit to the model is open/);
    s.model.open[0]?.resolve();
    await probe;
  });
});

describe('ResilientLanguageModel: stream', () => {
  async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const chunk of iterable) out.push(chunk);
    return out;
  }

  it('RES-015 streams through the wrapped model with the remaining time', async () => {
    const s = subject();
    const chunks = drain(s.resilient.stream(request(2_000)));
    await settle();
    expect(s.model.calls[0]?.request.timeoutMs).toBe(2_000);
    s.model.open[0]?.resolve();
    expect(await chunks).toEqual([
      { kind: 'delta', text: 'Look' },
      { kind: 'delta', text: 'at' },
      { kind: 'delta', text: 'the' },
      { kind: 'delta', text: 'loop' },
      { kind: 'delta', text: 'condition.' },
      { kind: 'done', completion: COMPLETION },
    ]);
  });

  it('RES-015 does not retry a stream, and its failures count against the circuit', async () => {
    const s = subject({ circuit: { failureThreshold: 1, resetAfterMs: 1_000 } });
    const chunks = outcome(drain(s.resilient.stream(request())));
    await settle();
    const error = unavailable();
    s.model.open[0]?.reject(error);
    expect((await chunks).error).toBe(error);
    await s.timer.advance(10_000);
    expect(s.model.calls).toHaveLength(1);
    expect(s.resilient.circuit).toBe('open');
  });

  it('RES-015 a failed stream is not also counted as an answer', async () => {
    const s = subject({ circuit: { failureThreshold: 2, resetAfterMs: 1_000 } });
    for (let i = 0; i < 2; i += 1) {
      const chunks = outcome(drain(s.resilient.stream(request())));
      await settle();
      s.model.open[0]?.reject(unavailable());
      await chunks;
    }
    expect(s.resilient.circuit).toBe('open');
  });

  it('RES-015 refuses a stream while the circuit is open, and when the bulkhead is full', async () => {
    const s = subject({ retries: 0, bulkhead: { maxConcurrent: 1, maxQueued: 0 } });
    await failCalls(s, 3);
    await expectPortError(drain(s.resilient.stream(request())), 'unavailable', /circuit to the model is open/);
    await s.timer.advance(1_000);
    const probe = s.resilient.complete(request());
    await settle();
    await expectPortError(drain(s.resilient.stream(request())), 'unavailable', /circuit to the model is open|saturated/);
    s.model.open[0]?.resolve();
    await probe;
    const busy = s.resilient.complete(request());
    await settle();
    await expectPortError(drain(s.resilient.stream(request())), 'unavailable', /saturated/);
    s.model.open[0]?.resolve();
    await busy;
  });

  it('RES-015 a stream that passes the circuit check but loses the probe race gives its bulkhead place back', async () => {
    const s = subject({ retries: 0, bulkhead: { maxConcurrent: 2, maxQueued: 0 } });
    await failCalls(s, 3);
    await s.timer.advance(1_000);
    // Both calls see a circuit ready to probe; only the first gets the probe.
    const probe = s.resilient.complete(request());
    const stream = drain(s.resilient.stream(request()));
    await expectPortError(stream, 'unavailable', /circuit to the model is open/);
    await settle();
    s.model.open[0]?.resolve();
    await probe;
    // Two places are free: two calls run at once.
    const a = s.resilient.complete(request());
    const b = s.resilient.complete(request());
    await settle();
    expect(s.model.open).toHaveLength(2);
    s.model.open.forEach((c) => c.resolve());
    await Promise.all([a, b]);
  });

  it('RES-015 a probe stream the consumer stops reading early still closes the circuit and frees its place', async () => {
    const s = subject({ retries: 0, bulkhead: { maxConcurrent: 1, maxQueued: 0 } });
    await failCalls(s, 3);
    await s.timer.advance(1_000);
    const iterator = s.resilient.stream(request())[Symbol.asyncIterator]();
    const first = iterator.next();
    await settle();
    s.model.open[0]?.resolve();
    expect(await first).toEqual({ done: false, value: { kind: 'delta', text: 'Look' } });
    await iterator.return?.(undefined);
    expect(s.resilient.circuit).toBe('closed');
    const next = s.resilient.complete(request());
    await settle();
    expect(s.model.open).toHaveLength(1);
    s.model.open[0]?.resolve();
    await next;
  });
});

describe('ResilientLanguageModel: observer and defaults', () => {
  it('RES-016 reports each state change, retry and shed call, in order', async () => {
    const s = subject({ retries: 1, circuit: { failureThreshold: 2, resetAfterMs: 1_000 }, bulkhead: { maxConcurrent: 1, maxQueued: 0 } }, () => 0.9);
    const call = outcome(s.resilient.complete(request()));
    await settle();
    s.model.open[0]?.reject(unavailable());
    await s.timer.advance(90);
    const busy = outcome(s.resilient.complete(request()));
    s.model.open[0]?.reject(new PortError('LanguageModel', 'unavailable', 'refused again'));
    await call;
    await busy;
    await outcome(s.resilient.complete(request()));
    expect(s.events).toEqual([
      { type: 'retry', retry: 1, delayMs: 90, cause: 'connection refused' },
      { type: 'shed', reason: 'queue-full' },
      { type: 'circuit', from: 'closed', to: 'open' },
      { type: 'shed', reason: 'circuit-open' },
    ]);
  });

  it('defaults to five failures, a 30s reset, one retry within 250ms to 2s, and four calls with 32 queued', () => {
    expect(DEFAULT_RESILIENCE).toEqual({
      circuit: { failureThreshold: 5, resetAfterMs: 30_000 },
      retries: 1,
      backoff: { baseMs: 250, maxMs: 2_000 },
      bulkhead: { maxConcurrent: 4, maxQueued: 32 },
    });
  });

  it('runs on the default policy, the system timer and Math.random when given no options', async () => {
    const model = new ControlledModel();
    const resilient = new ResilientLanguageModel(model);
    const call = resilient.complete(request(5_000));
    await settle();
    model.open[0]?.reject(unavailable());
    await vi.waitFor(() => expect(model.calls).toHaveLength(2), { timeout: 1_000 });
    model.open[0]?.resolve();
    expect(await call).toBe(COMPLETION);
    expect(resilient.circuit).toBe('closed');
  });
});
