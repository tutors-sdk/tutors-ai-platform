import { describe, expect, it } from 'vitest';
import { depthRank, depthWithin, narrowestScope } from '../src/index.ts';

describe('capability vocabulary', () => {
  it('orders depth from redirect to explanation', () => {
    expect([depthRank('redirect'), depthRank('hint'), depthRank('explanation')]).toEqual([0, 1, 2]);
    expect(depthWithin('hint', 'hint')).toBe(true);
    expect(depthWithin('redirect', 'hint')).toBe(true);
    expect(depthWithin('explanation', 'hint')).toBe(false);
  });

  it('narrows memory scope by kind and sharing independently', () => {
    expect(narrowestScope({ kind: 'course', sharing: 'cohort' }, { kind: 'session', sharing: 'cohort' })).toEqual({
      kind: 'session',
      sharing: 'cohort',
    });
    expect(narrowestScope({ kind: 'session', sharing: 'cohort' }, { kind: 'programme', sharing: 'private' })).toEqual({
      kind: 'session',
      sharing: 'private',
    });
    expect(narrowestScope({ kind: 'none', sharing: 'private' }, { kind: 'course', sharing: 'cohort' })).toEqual({
      kind: 'none',
      sharing: 'private',
    });
    expect(narrowestScope({ kind: 'programme', sharing: 'cohort' }, { kind: 'course', sharing: 'private' }).kind).toBe('course');
  });
});

describe('PortError', () => {
  it('is recognised by brand, so duplicated package copies still match', async () => {
    const { PortError } = await import('../src/index.ts');
    expect(PortError.is(new PortError('LanguageModel', 'timeout', 'slow'))).toBe(true);
    expect(PortError.is(new Error('plain'))).toBe(false);
    expect(PortError.is(null)).toBe(false);
    expect(PortError.is('PortError')).toBe(false);
    const copy = Object.assign(new Error('copy'), { [Symbol.for('tutors-ai.PortError')]: true });
    expect(PortError.is(copy)).toBe(true);
    expect(new PortError('X', 'rejected', 'm')).toMatchObject({ name: 'PortError', port: 'X', kind: 'rejected', message: 'm' });
  });
});
