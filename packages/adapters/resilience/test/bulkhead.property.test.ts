import { assertProperty, expectCounterexample } from '@tutors-ai/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Bulkhead, type BulkheadOptions, type Entry } from '../src/index.ts';

const OPTIONS: BulkheadOptions = { maxConcurrent: 2, maxQueued: 2 };

interface Subject {
  enter(): Entry | undefined;
}

/** A naive bulkhead with a configurable flaw, for the property to catch. */
class FlawedBulkhead implements Subject {
  #active = 0;
  #queue: { wake: () => void; cancelled: boolean }[] = [];
  constructor(private readonly flaw: 'lifo' | 'unbounded-queue' | 'abandoned-place-lost') {}
  enter(): Entry | undefined {
    if (this.#active < OPTIONS.maxConcurrent) {
      this.#active += 1;
      return { admitted: Promise.resolve(), cancel: () => this.#release() };
    }
    if (this.flaw !== 'unbounded-queue' && this.#queue.length >= OPTIONS.maxQueued) return undefined;
    let wake!: () => void;
    const admitted = new Promise<void>((r) => (wake = r));
    const item = { wake, cancelled: false, admitted: false };
    item.wake = () => {
      item.admitted = true;
      wake();
    };
    if (this.flaw === 'lifo') this.#queue.unshift(item);
    else this.#queue.push(item);
    return {
      admitted,
      cancel: () => {
        if (item.admitted) return this.#release();
        if (this.flaw === 'abandoned-place-lost') item.cancelled = true;
        else this.#queue.splice(this.#queue.indexOf(item), 1);
      },
    };
  }
  #release(): void {
    const next = this.#queue.shift();
    if (next === undefined) this.#active -= 1;
    else if (!next.cancelled) next.wake();
  }
}

type Command = { op: 'enter' } | { op: 'leave'; pick: number };

const commands = fc.array(
  fc.oneof(fc.constant<Command>({ op: 'enter' }), fc.record({ op: fc.constant('leave' as const), pick: fc.nat() })),
  { maxLength: 60, size: 'max' },
);

const flush = async () => {
  for (let i = 0; i < 3; i += 1) await Promise.resolve();
};

/**
 * Against a model of the policy: an entry is admitted iff a place is free,
 * queued iff the queue has room, refused otherwise; queued entries are
 * admitted first come, first served; leaving frees exactly one place.
 */
function followsThePolicy(make: () => Subject) {
  return fc.asyncProperty(commands, async (script) => {
    const subject = make();
    let active = 0;
    const queue: number[] = [];
    const held = new Map<number, { entry: Entry; admitted: boolean }>();
    const admittedOrder: number[] = [];
    const expectedOrder: number[] = [];
    let next = 0;
    for (const c of script) {
      if (c.op === 'enter') {
        const id = next++;
        const entry = subject.enter();
        const expected = active < OPTIONS.maxConcurrent ? 'admitted' : queue.length < OPTIONS.maxQueued ? 'queued' : 'refused';
        if ((entry === undefined) !== (expected === 'refused')) return false;
        if (expected === 'admitted') {
          active += 1;
          expectedOrder.push(id);
        }
        if (expected === 'queued') queue.push(id);
        if (entry !== undefined) {
          const record = { entry, admitted: false };
          held.set(id, record);
          void entry.admitted.then(() => {
            record.admitted = true;
            admittedOrder.push(id);
          });
        }
      } else if (held.size > 0) {
        const ids = [...held.keys()];
        const id = ids[c.pick % ids.length]!;
        const record = held.get(id)!;
        held.delete(id);
        record.entry.cancel();
        const queuedAt = queue.indexOf(id);
        if (queuedAt >= 0) queue.splice(queuedAt, 1);
        else {
          const woken = queue.shift();
          if (woken === undefined) active -= 1;
          else expectedOrder.push(woken);
        }
      }
      await flush();
      if (admittedOrder.join() !== expectedOrder.join()) return false;
    }
    return true;
  });
}

describe('Bulkhead model', () => {
  it('RES-012 RES-013 RES-014 admits, queues and refuses as the policy says, first come first served, for any arrivals and departures', async () => {
    await assertProperty(followsThePolicy(() => new Bulkhead(OPTIONS)));
  });

  for (const flaw of ['lifo', 'unbounded-queue', 'abandoned-place-lost'] as const) {
    it(`finds a counterexample against a bulkhead with the flaw "${flaw}"`, async () => {
      await expectCounterexample(followsThePolicy(() => new FlawedBulkhead(flaw)));
    });
  }

  it('reports how many calls are in flight and queued', async () => {
    const bulkhead = new Bulkhead({ maxConcurrent: 1, maxQueued: 1 });
    const first = bulkhead.enter()!;
    const second = bulkhead.enter()!;
    expect([bulkhead.active, bulkhead.queued]).toEqual([1, 1]);
    first.cancel();
    first.cancel();
    await second.admitted;
    expect([bulkhead.active, bulkhead.queued]).toEqual([1, 0]);
    second.cancel();
    expect([bulkhead.active, bulkhead.queued]).toEqual([0, 0]);
  });
});
