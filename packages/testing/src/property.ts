import fc from 'fast-check';
import { expect } from 'vitest';

export interface PropertySettings {
  readonly numRuns: number;
  readonly seed?: number;
  readonly path?: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * fast-check settings from FC_NUM_RUNS (default 100; the nightly sets 10,000),
 * FC_SEED and FC_PATH (to replay a printed counterexample). A malformed value
 * stops the run rather than falling back to a default, so a typo in a replay
 * command cannot pass by silently testing something else.
 */
export function propertySettings(env: Env = process.env): PropertySettings {
  const runs = env['FC_NUM_RUNS']?.trim();
  const seed = env['FC_SEED']?.trim();
  const path = env['FC_PATH']?.trim();
  const numRuns = runs === undefined || runs === '' ? 100 : Number(runs);
  if (!Number.isInteger(numRuns) || numRuns < 1) throw new Error(`FC_NUM_RUNS must be a positive integer, got "${runs}"`);
  const settings: { numRuns: number; seed?: number; path?: string } = { numRuns };
  if (seed !== undefined && seed !== '') {
    const value = Number(seed);
    if (!Number.isInteger(value)) throw new Error(`FC_SEED must be an integer, got "${seed}"`);
    settings.seed = value;
  }
  if (path !== undefined && path !== '') {
    if (!/^\d+(:\d+)*$/.test(path)) throw new Error(`FC_PATH must look like 12:0:3, got "${path}"`);
    settings.path = path;
  }
  return settings;
}

/** Asserts a property under the run's settings; a failure prints the seed and path to replay it. */
export async function assertProperty<T>(property: fc.IRawProperty<T>): Promise<void> {
  const details = await fc.check(property, propertySettings());
  expect(details.failed, fc.defaultReportMessage(details)).toBe(false);
}

/**
 * A property is only worth having if it can fail. Requires the property to
 * find a counterexample against a deliberately broken implementation, under
 * at least 200 runs whatever FC_NUM_RUNS says.
 */
export async function expectCounterexample<T>(property: fc.IRawProperty<T>): Promise<void> {
  const settings = propertySettings();
  const { seed: _seed, path: _path, ...rest } = settings;
  const details = await fc.check(property, { ...rest, numRuns: Math.max(rest.numRuns, 200) });
  expect(details.failed, `expected a counterexample against a known-bad implementation, but ${details.numRuns} runs passed`).toBe(true);
}
