import { PortError, type Completion, type CompletionRequest, type LanguageModel } from '@tutors-ai/core';
import { aCompletionRequest, assertProperty, expectCounterexample } from '@tutors-ai/testing';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { ResilientLanguageModel, type ResilienceOptions } from '../src/index.ts';
import { COMPLETION, ManualTimer } from './support.ts';

interface Attempt {
  readonly latencyMs: number;
  readonly result: 'ok' | 'unavailable' | 'invalid-response';
}

/** A model that honours the timeout it is given, answering each attempt as scripted. */
class ScriptedModel implements LanguageModel {
  readonly attempts: { timeoutMs: number; result: Attempt['result'] | 'timeout' }[] = [];
  constructor(
    private readonly timer: ManualTimer,
    private readonly script: readonly Attempt[],
  ) {}
  async complete(request: CompletionRequest): Promise<Completion> {
    const step = this.script[this.attempts.length % this.script.length]!;
    const timedOut = step.latencyMs > request.timeoutMs;
    this.attempts.push({ timeoutMs: request.timeoutMs, result: timedOut ? 'timeout' : step.result });
    await this.timer.delay(timedOut ? request.timeoutMs : step.latencyMs).elapsed;
    if (timedOut) throw new PortError('LanguageModel', 'timeout', 'scripted timeout');
    if (step.result === 'ok') return COMPLETION;
    throw new PortError('LanguageModel', step.result, `scripted ${step.result}`);
  }
  stream(): never {
    throw new Error('not used');
  }
}

/** A decorator that retries with the full timeout every time: what RES-011 forbids. */
class NaiveRetry implements LanguageModel {
  constructor(
    private readonly inner: LanguageModel,
    private readonly retries: number,
  ) {}
  async complete(request: CompletionRequest): Promise<Completion> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.inner.complete(request);
      } catch (error) {
        if (attempt >= this.retries) throw error;
      }
    }
  }
  stream(): never {
    throw new Error('not used');
  }
}

const scenario = fc.record({
  timeoutMs: fc.integer({ min: 1, max: 5_000 }),
  retries: fc.integer({ min: 0, max: 4 }),
  baseMs: fc.integer({ min: 1, max: 1_000 }),
  extraMs: fc.integer({ min: 0, max: 2_000 }),
  random: fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
  script: fc.array(
    fc.record({
      latencyMs: fc.integer({ min: 0, max: 6_000 }),
      result: fc.constantFrom<Attempt['result']>('ok', 'unavailable', 'unavailable', 'invalid-response'),
    }),
    { minLength: 1, maxLength: 6 },
  ),
});

type Wrap = (inner: LanguageModel, options: ResilienceOptions, timer: ManualTimer, random: () => number) => LanguageModel;

function staysWithinItsTimeout(wrap: Wrap) {
  return fc.asyncProperty(scenario, async (s) => {
    const timer = new ManualTimer();
    const model = new ScriptedModel(timer, s.script);
    const options: ResilienceOptions = {
      circuit: { failureThreshold: 100, resetAfterMs: 1_000 },
      retries: s.retries,
      backoff: { baseMs: s.baseMs, maxMs: s.baseMs + s.extraMs },
      bulkhead: { maxConcurrent: 1, maxQueued: 0 },
    };
    const resilient = wrap(model, options, timer, () => s.random);
    let settledAt: number | undefined;
    void resilient.complete(aCompletionRequest({ timeoutMs: s.timeoutMs })).then(
      () => (settledAt = timer.now()),
      () => (settledAt = timer.now()),
    );
    for (let i = 0; i < 400 && settledAt === undefined; i += 1) await timer.advance(50);
    if (settledAt === undefined || settledAt > s.timeoutMs) return false;
    if (model.attempts.length > s.retries + 1) return false;
    // Only an unavailable attempt may be followed by another.
    return model.attempts.slice(0, -1).every((a) => a.result === 'unavailable');
  });
}

describe('ResilientLanguageModel deadline', () => {
  it('RES-009 RES-010 RES-011 settles within the request timeout and retries only unavailable attempts, for any latencies and outcomes', async () => {
    await assertProperty(staysWithinItsTimeout((inner, options, timer, random) => new ResilientLanguageModel(inner, options, { timer, random })));
  });

  it('finds a counterexample against a retry that gives every attempt the full timeout', async () => {
    await expectCounterexample(staysWithinItsTimeout((inner, options) => new NaiveRetry(inner, Math.max(1, options.retries))));
  });
});
