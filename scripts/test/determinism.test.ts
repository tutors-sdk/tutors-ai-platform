import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, CONSTRUCTS, count, lowered, productionFiles, sites } from '../check-determinism.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/determinism/${name}`, import.meta.url), 'utf8');

describe('determinism lint', () => {
  it('finds each restricted construct on its fixture line', () => {
    const found = sites('packages/x/src/violations.ts', fixture('violations.fixture.ts'));
    expect(found.map((s) => [s.line, s.construct]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [2, 'Date.now()'],
      [3, 'new Date()'],
      [4, 'Math.random()'],
      [5, 'performance.now()'],
      [6, 'process.hrtime'],
      [7, 'setTimeout'],
      [8, 'setInterval'],
      [9, 'setImmediate'],
      [10, 'AbortSignal.timeout()'],
    ]);
    expect(found).toHaveLength(Object.keys(CONSTRUCTS).length);
  });

  it('allows parsing dates, the words in comments and strings, and the clock modules themselves', () => {
    expect(sites('packages/x/src/clean.ts', fixture('clean.fixture.ts'))).toEqual([]);
    expect(sites('packages/adapters/system/src/index.ts', fixture('violations.fixture.ts'))).toEqual([]);
    expect(sites('packages/adapters/resilience/src/timer.ts', fixture('violations.fixture.ts'))).toEqual([]);
    expect(sites('packages/adapters/resilience/src/backoff.ts', fixture('violations.fixture.ts'))).not.toEqual([]);
  });

  it('fails a new site, fails a shrunk entry until it is lowered, and passes the baseline exactly', () => {
    const found = sites('a/src/x.ts', 'Date.now(); Date.now();');
    const counts = count(found);
    expect(counts).toEqual({ 'a/src/x.ts': { 'Date.now()': 2 } });
    expect(compare(counts, { 'a/src/x.ts': { 'Date.now()': 2 } }, found)).toEqual([]);
    expect(compare(counts, { 'a/src/x.ts': { 'Date.now()': 1 } }, found)).toEqual([
      'a/src/x.ts:1,1 uses Date.now() 2 time(s), baseline 1: take time or randomness from an injected Clock, Timer or random instead',
    ]);
    expect(compare(counts, {}, found)[0]).toMatch(/baseline 0/);
    expect(compare(counts, { 'a/src/x.ts': { 'Date.now()': 3 }, 'b/src/y.ts': { setTimeout: 1 } }, found)).toEqual([
      'a/src/x.ts uses Date.now() 2 time(s) but the baseline allows 3: lower it with --update',
      'b/src/y.ts uses setTimeout 0 time(s) but the baseline allows 1: lower it with --update',
    ]);
  });

  it('only ever lowers the baseline', () => {
    expect(lowered({ 'a.ts': { setTimeout: 1, 'Date.now()': 5 } }, { 'a.ts': { setTimeout: 2, 'Date.now()': 3 }, 'gone.ts': { setInterval: 1 } })).toEqual({
      'a.ts': { setTimeout: 1, 'Date.now()': 3 },
    });
  });

  it('scans production source in packages and apps, but not test tooling or tests', () => {
    const files = productionFiles();
    expect(files.some((f) => f.endsWith('packages/core/src/usecases/assist-student.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('apps/inference-api/src/main.ts'))).toBe(true);
    expect(files.some((f) => f.includes('/packages/testing/') || f.includes('/test/'))).toBe(false);
  });
});
