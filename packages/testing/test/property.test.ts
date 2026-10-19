import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertProperty, expectCounterexample, propertySettings } from '../src/property.ts';

describe('propertySettings', () => {
  it('defaults to 100 runs with fast-check choosing the seed', () => {
    expect(propertySettings({})).toEqual({ numRuns: 100 });
    expect(propertySettings({ FC_NUM_RUNS: ' ', FC_SEED: '', FC_PATH: '' })).toEqual({ numRuns: 100 });
  });

  it('reads the run count, the seed and the replay path', () => {
    expect(propertySettings({ FC_NUM_RUNS: '10000', FC_SEED: '-42', FC_PATH: '3:0:12' })).toEqual({ numRuns: 10_000, seed: -42, path: '3:0:12' });
  });

  it('fails closed on a malformed value instead of falling back to the default', () => {
    expect(() => propertySettings({ FC_NUM_RUNS: '0' })).toThrow('FC_NUM_RUNS must be a positive integer, got "0"');
    expect(() => propertySettings({ FC_NUM_RUNS: '1e3x' })).toThrow('FC_NUM_RUNS');
    expect(() => propertySettings({ FC_NUM_RUNS: '2.5' })).toThrow('FC_NUM_RUNS');
    expect(() => propertySettings({ FC_SEED: 'abc' })).toThrow('FC_SEED must be an integer, got "abc"');
    expect(() => propertySettings({ FC_PATH: '3;0' })).toThrow('FC_PATH must look like 12:0:3, got "3;0"');
    expect(() => propertySettings({ FC_PATH: 'x3:0' })).toThrow('FC_PATH');
    expect(() => propertySettings({ FC_PATH: '3:0x' })).toThrow('FC_PATH');
  });
});

describe('assertProperty', () => {
  it('fails with fast-check\'s report, seed and path included, when the property does not hold', async () => {
    await expect(assertProperty(fc.property(fc.integer(), (n) => n < 1_000))).rejects.toThrow(/Property failed after \d+ tests\n\{ seed: -?\d+, path: "[\d:]+"/);
  });
});

describe('expectCounterexample', () => {
  it('passes when the property finds a counterexample', async () => {
    await expectCounterexample(fc.property(fc.integer(), (n) => n < 1_000));
  });

  it('fails when every run passes, so a known-bad fixture that is not bad is caught', async () => {
    await expect(expectCounterexample(fc.property(fc.integer(), () => true))).rejects.toThrow(
      /^expected a counterexample against a known-bad implementation, but \d+ runs passed/,
    );
  });
});
