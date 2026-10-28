import { PortError, type Completion, type CompletionChunk, type CompletionRequest, type LanguageModel } from '@tutors-ai/core';
import { backoffDelay, type BackoffOptions } from './backoff.ts';
import type { BulkheadOptions } from './bulkhead.ts';
import type { CircuitBreakerOptions, CircuitState } from './circuit-breaker.ts';
import { Guard, type GuardEvent } from './guard.ts';
import { systemTimer, type Timer } from './timer.ts';

export type { ShedReason } from './guard.ts';

export interface ResilienceOptions {
  readonly circuit: CircuitBreakerOptions;
  /** Further attempts after a call fails as unavailable. */
  readonly retries: number;
  readonly backoff: BackoffOptions;
  readonly bulkhead: BulkheadOptions;
}

export const DEFAULT_RESILIENCE: ResilienceOptions = {
  circuit: { failureThreshold: 5, resetAfterMs: 30_000 },
  retries: 1,
  backoff: { baseMs: 250, maxMs: 2_000 },
  bulkhead: { maxConcurrent: 4, maxQueued: 32 },
};

export type ResilienceEvent = GuardEvent | { readonly type: 'retry'; readonly retry: number; readonly delayMs: number; readonly cause: string };

export interface ResilienceDeps {
  readonly timer?: Timer;
  /** Returns a value in [0, 1); drives the backoff jitter. */
  readonly random?: () => number;
  /** Told about every state change, retry and shed call (RES-016). */
  readonly observe?: (event: ResilienceEvent) => void;
}

/** Circuit breaker, bounded retry and bulkhead around any LanguageModel (ADR 0007). */
export class ResilientLanguageModel implements LanguageModel {
  readonly #inner: LanguageModel;
  readonly #options: ResilienceOptions;
  readonly #timer: Timer;
  readonly #random: () => number;
  readonly #observe: (event: ResilienceEvent) => void;
  readonly #guard: Guard;

  constructor(inner: LanguageModel, options: ResilienceOptions = DEFAULT_RESILIENCE, deps: ResilienceDeps = {}) {
    this.#inner = inner;
    this.#options = options;
    this.#timer = deps.timer ?? systemTimer;
    this.#random = deps.random ?? Math.random;
    this.#observe = deps.observe ?? (() => {});
    this.#guard = new Guard('LanguageModel', 'the model', options, this.#timer, this.#observe);
  }

  get circuit(): CircuitState {
    return this.#guard.circuit;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const deadline = this.#timer.now() + request.timeoutMs;
    // RES-012, RES-013, RES-014
    const entry = await this.#guard.enter(deadline);
    try {
      for (let retry = 1; ; retry += 1) {
        const ticket = this.#guard.admit();
        try {
          const completion = await this.#inner.complete({ ...request, timeoutMs: this.#guard.remaining(deadline) });
          this.#guard.succeeded(ticket);
          return completion;
        } catch (error) {
          this.#guard.record(ticket, error);
          // RES-009, RES-010; a retry the circuit would refuse is not worth waiting for.
          if (!PortError.is(error) || error.kind !== 'unavailable' || retry > this.#options.retries || !this.#guard.admits()) throw error;
          const delayMs = backoffDelay(retry, this.#options.backoff, this.#random);
          // RES-011: a retry that could not start before the deadline is not worth waiting for.
          if (this.#timer.now() + delayMs >= deadline) throw error;
          this.#observe({ type: 'retry', retry, delayMs, cause: error.message });
          await this.#timer.delay(delayMs).elapsed;
        }
      }
    } finally {
      entry.cancel();
    }
  }

  async *stream(request: CompletionRequest): AsyncGenerator<CompletionChunk> {
    const deadline = this.#timer.now() + request.timeoutMs;
    const entry = await this.#guard.enter(deadline);
    const ticket = this.#guard.admitOrRelease(entry);
    let settled = false;
    try {
      yield* this.#inner.stream({ ...request, timeoutMs: this.#guard.remaining(deadline) });
    } catch (error) {
      settled = true;
      this.#guard.record(ticket, error);
      throw error;
    } finally {
      // A consumer that stops reading early was still being answered.
      if (!settled) this.#guard.succeeded(ticket);
      entry.cancel();
    }
  }
}
