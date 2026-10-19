import type { Timer } from './timer.ts';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. */
  readonly failureThreshold: number;
  /** How long the circuit stays open before it admits a probe. */
  readonly resetAfterMs: number;
}

type Phase =
  | { readonly state: 'closed' }
  | { readonly state: 'open'; readonly since: number }
  /** Half-open always has its one probe in flight (RES-004). */
  | { readonly state: 'half-open' };

/** Proof of admission: names the phase of the circuit that admitted the call. */
export interface Ticket {
  readonly phase: object;
}

/**
 * A circuit breaker for one dependency. A call asks to be admitted, then
 * reports whether the dependency answered. Every state change starts a new
 * phase, and an outcome reported against an older phase is ignored (RES-007),
 * so a slow call admitted before the circuit opened can neither close it nor
 * keep it open.
 */
export class CircuitBreaker {
  readonly #options: CircuitBreakerOptions;
  readonly #timer: Timer;
  readonly #onChange: (from: CircuitState, to: CircuitState) => void;
  #phase: Phase = { state: 'closed' };
  /** Consecutive failures in the current phase. */
  #failures = 0;

  constructor(options: CircuitBreakerOptions, timer: Timer, onChange: (from: CircuitState, to: CircuitState) => void = () => {}) {
    this.#options = options;
    this.#timer = timer;
    this.#onChange = onChange;
  }

  get state(): CircuitState {
    return this.#phase.state;
  }

  /** Whether a call would be admitted now. Changes nothing. */
  admits(): boolean {
    const phase = this.#phase;
    if (phase.state === 'open') return this.#timer.now() - phase.since >= this.#options.resetAfterMs;
    return phase.state === 'closed';
  }

  /** Admits a call, or returns undefined when the circuit refuses it. */
  admit(): Ticket | undefined {
    if (!this.admits()) return undefined;
    if (this.#phase.state === 'open') this.#move({ state: 'half-open' });
    return { phase: this.#phase };
  }

  /** The dependency answered. */
  succeeded(ticket: Ticket): void {
    const phase = this.#phase;
    if (ticket.phase !== phase) return;
    if (phase.state === 'closed') this.#failures = 0;
    else this.#move({ state: 'closed' });
  }

  /** The dependency could not be reached or did not answer in time. */
  failed(ticket: Ticket): void {
    const phase = this.#phase;
    if (ticket.phase !== phase) return;
    if (phase.state === 'closed') {
      this.#failures += 1;
      if (this.#failures < this.#options.failureThreshold) return;
    }
    this.#move({ state: 'open', since: this.#timer.now() });
  }

  #move(next: Phase): void {
    const from = this.#phase.state;
    this.#phase = next;
    this.#failures = 0;
    this.#onChange(from, next.state);
  }
}
