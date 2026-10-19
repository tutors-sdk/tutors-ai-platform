import { describe, expect, it } from 'vitest';
import { leakVerdict, type Sample } from './soak.ts';

const series = (slope: number, noise: (i: number) => number = () => 0): Sample[] =>
  Array.from({ length: 20 }, (_, i) => ({ requests: (i + 1) * 1_000, heapBytes: 50e6 + slope * (i + 1) * 1_000 + noise(i) }));

describe('leakVerdict', () => {
  it('finds no leak in a flat heap, nor in noise around one', () => {
    expect(leakVerdict(series(0), 1e6)).toEqual({ slopeBytesPerRequest: 0, projectedGrowthBytes: 0, leaking: false });
    expect(leakVerdict(series(0, (i) => (i % 2 === 0 ? 300_000 : -300_000)), 1e6).leaking).toBe(false);
  });

  it('flags steady growth that projects past the threshold', () => {
    const verdict = leakVerdict(series(100), 1e6);
    expect(verdict.slopeBytesPerRequest).toBeCloseTo(100, 6);
    expect(verdict.projectedGrowthBytes).toBeCloseTo(100 * 19_000, 0);
    expect(verdict.leaking).toBe(true);
  });

  it('ignores warm-up growth in the first half', () => {
    const warmUp = series(0).map((s, i) => (i < 10 ? { ...s, heapBytes: s.heapBytes - (10 - i) * 1e6 } : s));
    expect(leakVerdict(warmUp, 1e6).leaking).toBe(false);
  });

  it('needs enough samples to fit a line', () => {
    expect(() => leakVerdict(series(0).slice(0, 3), 1e6)).toThrow('a verdict needs at least 4 samples, got 3');
  });
});
