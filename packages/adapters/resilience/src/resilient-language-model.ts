import { PortError, type Completion, type CompletionChunk, type CompletionRequest, type LanguageModel } from '@tutors-ai/core';
import { backoffDelay, type BackoffOptions } from './backoff.ts';
import { Bulkhead, type BulkheadOptions, type Entry } from './bulkhead.ts';
import { CircuitBreaker, type CircuitBreakerOptions, type CircuitState, type Ticket } from './circuit-breaker.ts';
import { systemTimer, type Timer } from './timer.ts';

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

export type ShedReason = 'circuit-open' | 'queue-full' | 'queue-timeout';

export type ResilienceEvent =
  | { readonly type: 'circuit'; readonly from: CircuitState; readonly to: CircuitState }
  | { readonly type: 'retry'; readonly retry: number; readonly delayMs: number; readonly cause: string }
  | { readonly type: 'shed'; readonly reason: ShedReason };

export interface ResilienceDeps {
  readonly timer?: Timer;
  /** Returns a value in [0, 1); drives the backoff jitter. */
  readonly random?: () => number;
  /** Told about every state change, retry and shed call (RES-016). */
  readonly observe?: (event: ResilienceEvent) => void;
}

const PORT = 'LanguageModel';

const SHED: Readonly<Record<ShedReason, readonly [PortError['kind'], string]>> = {
  'circuit-open': ['unavailable', 'the circuit to the model is open; the call failed fast'],
  'queue-full': ['unavailable', 'the model is saturated; the call was shed'],
  'queue-timeout': ['timeout', 'the model was busy until the request timed out'],
};

/** The server failed to answer: the only outcomes that count against the circuit (RES-008). */
const serverFailed = (error: unknown) => PortError.is(error) && (error.kind === 'unavailable' || error.kind === 'timeout');

/** Circuit breaker, bounded retry and bulkhead around any LanguageModel (ADR 0007). */
export class ResilientLanguageModel implements LanguageModel {
  readonly #inner: LanguageModel;
  readonly #options: ResilienceOptions;
  readonly #timer: Timer;
  readonly #random: () => number;
  readonly #observe: (event: ResilienceEvent) => void;
  readonly #breaker: CircuitBreaker;
  readonly #bulkhead: Bulkhead;

  constructor(inner: LanguageModel, options: ResilienceOptions = DEFAULT_RESILIENCE, deps: ResilienceDeps = {}) {
    this.#inner = inner;
    this.#options = options;
    this.#timer = deps.timer ?? systemTimer;
    this.#random = deps.random ?? Math.random;
    this.#observe = deps.observe ?? (() => {});
    this.#breaker = new CircuitBreaker(options.circuit, this.#timer, (from, to) => this.#observe({ type: 'circuit', from, to }));
    this.#bulkhead = new Bulkhead(options.bulkhead);
  }

  get circuit(): CircuitState {
    return this.#breaker.state;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    const deadline = this.#timer.now() + request.timeoutMs;
    const entry = await this.#enter(deadline);
    try {
      for (let retry = 1; ; retry += 1) {
        const ticket = this.#admit();
        try {
          const completion = await this.#inner.complete({ ...request, timeoutMs: this.#remaining(deadline) });
          this.#breaker.succeeded(ticket);
          return completion;
        } catch (error) {
          this.#record(ticket, error);
          // RES-009, RES-010; a retry the circuit would refuse is not worth waiting for.
          if (!PortError.is(error) || error.kind !== 'unavailable' || retry > this.#options.retries || !this.#breaker.admits()) throw error;
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
    const entry = await this.#enter(deadline);
    const ticket = this.#admitOrRelease(entry);
    let settled = false;
    try {
      yield* this.#inner.stream({ ...request, timeoutMs: this.#remaining(deadline) });
    } catch (error) {
      settled = true;
      this.#record(ticket, error);
      throw error;
    } finally {
      // A consumer that stops reading early was still being answered.
      if (!settled) this.#breaker.succeeded(ticket);
      entry.cancel();
    }
  }

  #admitOrRelease(entry: Entry): Ticket {
    try {
      return this.#admit();
    } catch (error) {
      entry.cancel();
      throw error;
    }
  }

  /** RES-012, RES-013, RES-014: a place in the bulkhead before the deadline, or a fast failure. */
  async #enter(deadline: number): Promise<Entry> {
    // RES-003: while the circuit refuses calls, do not queue behind the calls still in flight.
    if (!this.#breaker.admits()) throw this.#shed('circuit-open');
    const entry = this.#bulkhead.enter();
    if (entry === undefined) throw this.#shed('queue-full');
    const wait = this.#timer.delay(this.#remaining(deadline));
    const result = await Promise.race([entry.admitted, wait.elapsed.then(() => 'late' as const)]);
    wait.cancel();
    if (result !== 'late') return entry;
    entry.cancel();
    throw this.#shed('queue-timeout');
  }

  #admit(): Ticket {
    const ticket = this.#breaker.admit();
    if (ticket === undefined) throw this.#shed('circuit-open');
    return ticket;
  }

  #record(ticket: Ticket, error: unknown): void {
    if (serverFailed(error)) this.#breaker.failed(ticket);
    else this.#breaker.succeeded(ticket);
  }

  #remaining(deadline: number): number {
    return Math.max(0, deadline - this.#timer.now());
  }

  #shed(reason: ShedReason): PortError {
    this.#observe({ type: 'shed', reason });
    const [kind, message] = SHED[reason];
    return new PortError(PORT, kind, message);
  }
}
