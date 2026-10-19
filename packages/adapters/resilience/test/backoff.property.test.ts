import { assertProperty, expectCounterexample } from '@tutors-ai/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { backoffCeiling, backoffDelay, type BackoffOptions } from '../src/index.ts';

const options = fc.record({ baseMs: fc.integer({ min: 1, max: 10_000 }), maxMs: fc.integer({ min: 1, max: 60_000 }) });
const unit = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });

type Delay = (retry: number, options: BackoffOptions, random: () => number) => number;

function bounded(delay: Delay) {
  return fc.property(fc.integer({ min: 1, max: 64 }), options, unit, (retry, o, r) => {
    const value = delay(retry, o, () => r);
    const ceiling = backoffCeiling(retry, o);
    return Number.isInteger(value) && value >= 0 && value <= ceiling && ceiling <= o.maxMs && backoffCeiling(retry + 1, o) >= ceiling;
  });
}

describe('backoff', () => {
  it('RES-009 the first ceiling is the base, each later one doubles, capped at the maximum', () => {
    const o = { baseMs: 100, maxMs: 1_000 };
    expect([1, 2, 3, 4, 5].map((n) => backoffCeiling(n, o))).toEqual([100, 200, 400, 800, 1_000]);
    expect(backoffDelay(3, o, () => 0)).toBe(0);
    expect(backoffDelay(3, o, () => 0.999_999)).toBe(399);
    expect(backoffDelay(1, o, () => 0.5)).toBe(50);
  });

  it('RES-009 every delay is a whole number of milliseconds between zero and a capped, non-decreasing ceiling', async () => {
    await assertProperty(bounded(backoffDelay));
  });

  it('finds a counterexample against a backoff without a cap', async () => {
    await expectCounterexample(bounded((retry, o, random) => Math.floor(random() * o.baseMs * 2 ** retry) + 1));
  });
});
