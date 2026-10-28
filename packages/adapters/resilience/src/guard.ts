import { PortError } from '@tutors-ai/core';
import { Bulkhead, type BulkheadOptions, type Entry } from './bulkhead.ts';
import { CircuitBreaker, type CircuitBreakerOptions, type CircuitState, type Ticket } from './circuit-breaker.ts';
import type { Timer } from './timer.ts';

export type ShedReason = 'circuit-open' | 'queue-full' | 'queue-timeout';

export type GuardEvent =
  | { readonly type: 'circuit'; readonly from: CircuitState; readonly to: CircuitState }
  | { readonly type: 'shed'; readonly reason: ShedReason };

export interface GuardOptions {
  readonly circuit: CircuitBreakerOptions;
  readonly bulkhead: BulkheadOptions;
}

/** The server failed to answer: the only outcomes that count against the circuit (RES-008, RTH-005). */
const serverFailed = (error: unknown) => PortError.is(error) && (error.kind === 'unavailable' || error.kind === 'timeout');

/**
 * A circuit breaker and a bulkhead for one dependency, sharing a deadline.
 * The decorators build their call policies from it; it raises the port
 * errors a shed call fails with.
 */
export class Guard {
  readonly #port: string;
  /** How the dependency is named in error messages, e.g. "the model". */
  readonly #dependency: string;
  readonly #timer: Timer;
  readonly #observe: (event: GuardEvent) => void;
  readonly #breaker: CircuitBreaker;
  readonly #bulkhead: Bulkhead;

  constructor(port: string, dependency: string, options: GuardOptions, timer: Timer, observe: (event: GuardEvent) => void) {
    this.#port = port;
    this.#dependency = dependency;
    this.#timer = timer;
    this.#observe = observe;
    this.#breaker = new CircuitBreaker(options.circuit, timer, (from, to) => observe({ type: 'circuit', from, to }));
    this.#bulkhead = new Bulkhead(options.bulkhead);
  }

  get circuit(): CircuitState {
    return this.#breaker.state;
  }

  /** Whether the circuit would admit a call now. */
  admits(): boolean {
    return this.#breaker.admits();
  }

  /** A place in the bulkhead before the deadline, or a fast failure. */
  async enter(deadline: number): Promise<Entry> {
    // While the circuit refuses calls, do not queue behind the calls still in flight.
    if (!this.#breaker.admits()) throw this.#shed('circuit-open');
    const entry = this.#bulkhead.enter();
    if (entry === undefined) throw this.#shed('queue-full');
    const wait = this.#timer.delay(this.remaining(deadline));
    const result = await Promise.race([entry.admitted, wait.elapsed.then(() => 'late' as const)]);
    wait.cancel();
    if (result !== 'late') return entry;
    entry.cancel();
    throw this.#shed('queue-timeout');
  }

  /** Admission through the circuit for one attempt, or a fast failure. */
  admit(): Ticket {
    const ticket = this.#breaker.admit();
    if (ticket === undefined) throw this.#shed('circuit-open');
    return ticket;
  }

  /** As admit, giving up the bulkhead place if the circuit refuses. */
  admitOrRelease(entry: Entry): Ticket {
    try {
      return this.admit();
    } catch (error) {
      entry.cancel();
      throw error;
    }
  }

  succeeded(ticket: Ticket): void {
    this.#breaker.succeeded(ticket);
  }

  /** Counts a failure against the circuit only when the server failed to answer. */
  record(ticket: Ticket, error: unknown): void {
    if (serverFailed(error)) this.#breaker.failed(ticket);
    else this.#breaker.succeeded(ticket);
  }

  remaining(deadline: number): number {
    return Math.max(0, Math.ceil(deadline - this.#timer.now()));
  }

  #shed(reason: ShedReason): PortError {
    this.#observe({ type: 'shed', reason });
    const d = this.#dependency;
    const [kind, message]: readonly [PortError['kind'], string] =
      reason === 'circuit-open'
        ? ['unavailable', `the circuit to ${d} is open; the call failed fast`]
        : reason === 'queue-full'
          ? ['unavailable', `${d} is saturated; the call was shed`]
          : ['timeout', `${d} was busy until the request timed out`];
    return new PortError(this.#port, kind, message);
  }
}
