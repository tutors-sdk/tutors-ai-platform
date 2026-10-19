import { describe, expect, it } from 'vitest';
import { floorsMayOnlyRise, gapsMayOnlyShrink, sitesMayOnlyShrink } from '../check-ratchets.ts';

describe('ratchets', () => {
  it('lets a mutation floor rise or a package gain one, and fails one that falls or is removed', () => {
    const base = { packages: { 'packages/core': 100, 'packages/adapters/ollama': 80 } };
    expect(floorsMayOnlyRise({ packages: { 'packages/core': 100, 'packages/adapters/ollama': 85, 'packages/contract': 70 } }, base)).toEqual([]);
    expect(floorsMayOnlyRise({ packages: { 'packages/core': 99 } }, base)).toEqual([
      'packages/core: mutation floor lowered from 100% to 99%',
      'packages/adapters/ollama: its mutation floor (80%) was removed',
    ]);
  });

  it('lets determinism sites shrink, and fails one that grows or appears', () => {
    const base = { sites: { 'a.ts': { setTimeout: 2 } } };
    expect(sitesMayOnlyShrink({ sites: { 'a.ts': { setTimeout: 1 } } }, base)).toEqual([]);
    expect(sitesMayOnlyShrink({ sites: { 'a.ts': { setTimeout: 3 }, 'b.ts': { 'Date.now()': 1 } } }, base)).toEqual([
      'a.ts: baseline for setTimeout raised from 2 to 3',
      'b.ts: baseline for Date.now() raised from 0 to 1',
    ]);
  });

  it('lets known gaps shrink, and fails one that is added or widened', () => {
    const base = [{ fault: 'f', targets: ['complete'], reason: 'r' }];
    expect(gapsMayOnlyShrink([], base)).toEqual([]);
    expect(gapsMayOnlyShrink([{ fault: 'f', targets: ['complete', 'stream'] }, { fault: 'g', targets: ['complete'] }], base)).toEqual([
      'known gap added: f on stream',
      'known gap added: g on complete',
    ]);
  });
});
