import { FixedClock } from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import { SystemClock } from '../src/index.ts';

describe('Clock', () => {
  it('CLK-001 the system clock returns the current time as a new value on every call', () => {
    const clock = new SystemClock();
    const before = Date.now();
    const first = clock.now();
    const second = clock.now();
    expect(first.getTime()).toBeGreaterThanOrEqual(before);
    expect(first.getTime()).toBeLessThanOrEqual(Date.now());
    expect(second).not.toBe(first);
    first.setFullYear(2000);
    expect(clock.now().getFullYear()).not.toBe(2000);
  });

  it('CLK-002 the test clock changes only when the test advances it', () => {
    const clock = new FixedClock('2026-10-15T09:00:00Z');
    const first = clock.now();
    first.setFullYear(2000);
    expect(clock.now().toISOString()).toBe('2026-10-15T09:00:00.000Z');
    clock.advance(1_000);
    expect(clock.now().toISOString()).toBe('2026-10-15T09:00:01.000Z');
  });
});
