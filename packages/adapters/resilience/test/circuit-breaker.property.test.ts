import { assertProperty, expectCounterexample } from '@tutors-ai/testing';
import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CircuitBreaker, type CircuitState } from '../src/index.ts';

const THRESHOLD = 3;
const RESET_MS = 1_000;

interface Clock {
  now: number;
}

// Tickets are opaque to the property: it only hands each back to the breaker that issued it.
type Ticket = { readonly generation: number };

interface Breaker {
  readonly state: CircuitState;
  admits(): boolean;
  admit(): object | undefined;
  succeeded(ticket: never): void;
  failed(ticket: never): void;
}

/** The specification as a model: RES-002 to RES-007, written for reading, not speed. */
class ReferenceBreaker implements Breaker {
  state: CircuitState = 'closed';
  protected generation = 0;
  protected failures = 0;
  protected openedAt = 0;
  protected probing = false;
  constructor(protected readonly clock: Clock) {}

  admits(): boolean {
    if (this.state === 'open') return this.clock.now - this.openedAt >= RESET_MS;
    return this.state === 'closed' || !this.probing;
  }
  admit(): Ticket | undefined {
    if (!this.admits()) return undefined;
    if (this.state === 'open') this.move('half-open');
    if (this.state === 'half-open') this.probing = true;
    return { generation: this.generation };
  }
  succeeded(ticket: Ticket): void {
    if (ticket.generation !== this.generation) return;
    this.failures = 0;
    if (this.state === 'half-open') this.move('closed');
  }
  failed(ticket: Ticket): void {
    if (ticket.generation !== this.generation) return;
    this.failures += 1;
    if (this.state === 'half-open' || this.failures >= THRESHOLD) this.move('open');
  }
  protected move(to: CircuitState): void {
    this.state = to;
    this.generation += 1;
    this.failures = 0;
    this.probing = false;
    if (to === 'open') this.openedAt = this.clock.now;
  }
}

/** Broken breakers the property must catch. */
const KNOWN_BAD: Record<string, new (clock: Clock) => Breaker> = {
  'counts every failure, not consecutive ones': class extends ReferenceBreaker {
    override succeeded(ticket: Ticket): void {
      if (ticket.generation === this.generation && this.state === 'half-open') this.move('closed');
    }
  },
  'lets every call through while half-open': class extends ReferenceBreaker {
    override admits(): boolean {
      return this.state === 'open' ? this.clock.now - this.openedAt >= RESET_MS : true;
    }
  },
  'acts on outcomes of calls admitted before the last change': class extends ReferenceBreaker {
    override failed(): void {
      this.failures += 1;
      if (this.state === 'half-open' || this.failures >= THRESHOLD) this.move('open');
    }
  },
  'never half-opens': class extends ReferenceBreaker {
    override admits(): boolean {
      return this.state === 'closed';
    }
  },
};

type Command = { op: 'admit' } | { op: 'succeed' | 'fail'; pick: number } | { op: 'advance'; ms: number };

const command: fc.Arbitrary<Command> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<Command>({ op: 'admit' }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('succeed' as const), pick: fc.nat() }) },
  { weight: 4, arbitrary: fc.record({ op: fc.constant('fail' as const), pick: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ op: fc.constant('advance' as const), ms: fc.integer({ min: 0, max: 1_500 }) }) },
);

/** Drives subject and reference with the same commands; they must agree on every admission and state. */
function agreesWithReference(makeSubject: (clock: Clock) => Breaker) {
  return fc.property(fc.array(command, { maxLength: 80, size: 'max' }), (commands) => {
    const clock: Clock = { now: 0 };
    const subject = makeSubject(clock);
    const reference = new ReferenceBreaker(clock);
    const outstanding: { subject: object; reference: Ticket }[] = [];
    for (const c of commands) {
      if (c.op === 'advance') clock.now += c.ms;
      else if (c.op === 'admit') {
        if (subject.admits() !== reference.admits()) return false;
        const s = subject.admit();
        const r = reference.admit();
        if ((s === undefined) !== (r === undefined)) return false;
        if (s !== undefined && r !== undefined) outstanding.push({ subject: s, reference: r });
      } else if (outstanding.length > 0) {
        const [t] = outstanding.splice(c.pick % outstanding.length, 1);
        if (c.op === 'succeed') {
          subject.succeeded(t!.subject as never);
          reference.succeeded(t!.reference);
        } else {
          subject.failed(t!.subject as never);
          reference.failed(t!.reference);
        }
      }
      if (subject.state !== reference.state) return false;
    }
    return true;
  });
}

const real = (clock: Clock): Breaker => new CircuitBreaker({ failureThreshold: THRESHOLD, resetAfterMs: RESET_MS }, { now: () => clock.now, delay: () => ({ elapsed: Promise.resolve(), cancel: () => {} }) });

describe('CircuitBreaker model', () => {
  it('RES-002 RES-003 RES-004 RES-005 RES-006 RES-007 matches the reference model under any sequence of overlapping calls', async () => {
    await assertProperty(agreesWithReference(real));
  });

  for (const [flaw, Bad] of Object.entries(KNOWN_BAD)) {
    it(`finds a counterexample against a breaker that ${flaw}`, async () => {
      await expectCounterexample(agreesWithReference((clock) => new Bad(clock)));
    });
  }
});
