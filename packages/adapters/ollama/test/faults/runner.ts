/**
 * Serves a fault to a target through the scripted transport, observes what
 * happens, and lists every invariant of the expected outcome it breaks.
 */
import { isDeepStrictEqual } from 'node:util';
import { PortError } from '@tutors-ai/core';
import type { ResilienceEvent } from '@tutors-ai/adapter-resilience';
import { scriptedTransport } from './transport.ts';
import type { Answer, Fault, Outcome, Target } from './types.ts';

export interface Observation {
  readonly result: { readonly answer: Answer } | { readonly error: unknown };
  readonly requests: number;
  readonly elapsedMs: number;
  readonly events: readonly ResilienceEvent['type'][];
}

export async function observe(fault: Fault, target: Target): Promise<Observation> {
  const transport = scriptedTransport(fault.exchange({ target }));
  const events: ResilienceEvent['type'][] = [];
  const started = performance.now();
  const result = await target.call(transport.fetch, events).then(
    (answer) => ({ answer }),
    (error: unknown) => ({ error }),
  );
  return { result, requests: transport.requests.length, elapsedMs: performance.now() - started, events };
}

const describeError = (error: unknown) =>
  PortError.is(error) ? `PortError(${error.kind}) "${error.message}"` : error instanceof Error ? `${error.name} "${error.message}"` : String(error);

/** Every way the observation differs from the outcome; empty when it matches. */
const TIMER_GRANULARITY_MS = 1;

export function brokenInvariants(expected: Outcome, seen: Observation): string[] {
  const broken: string[] = [];
  const { settlement } = expected;
  if ('resolves' in settlement) {
    if ('error' in seen.result) broken.push(`settlement: expected the call to resolve, it rejected with ${describeError(seen.result.error)}`);
    else if (!isDeepStrictEqual(seen.result.answer, settlement.resolves)) {
      broken.push(`answer: expected ${JSON.stringify(settlement.resolves)}, got ${JSON.stringify(seen.result.answer)}`);
    }
  } else if ('answer' in seen.result) {
    broken.push(`settlement: expected a ${settlement.rejects.kind} port error, the call resolved with ${JSON.stringify(seen.result.answer)}`);
  } else {
    const error = seen.result.error;
    if (!PortError.is(error)) broken.push(`error: expected a PortError, got ${describeError(error)}`);
    else {
      if (error.kind !== settlement.rejects.kind) broken.push(`kind: expected ${settlement.rejects.kind}, got ${error.kind} ("${error.message}")`);
      if (error.port !== 'LanguageModel') broken.push(`port: expected LanguageModel, got ${error.port}`);
      if (!settlement.rejects.message.test(error.message)) broken.push(`message: expected ${settlement.rejects.message}, got "${error.message}"`);
    }
  }
  if (seen.requests !== expected.requests) broken.push(`requests: expected ${expected.requests}, sent ${seen.requests}`);
  // Node timers count whole milliseconds, so a 10 ms delay can measure as 9.6 ms here.
  if (seen.elapsedMs < expected.elapsedMs.min - TIMER_GRANULARITY_MS || seen.elapsedMs > expected.elapsedMs.max) {
    broken.push(`elapsed: expected ${expected.elapsedMs.min}-${expected.elapsedMs.max}ms, took ${seen.elapsedMs.toFixed(1)}ms`);
  }
  if (!isDeepStrictEqual(seen.events, expected.events)) broken.push(`events: expected [${expected.events.join(', ')}], got [${seen.events.join(', ')}]`);
  return broken;
}

/** The failure message: the fault, the target, each broken invariant, the requirement and how to rerun it. */
export function report(fault: Fault, target: Target, broken: readonly string[]): string {
  return [
    `Fault "${fault.id}" (${fault.title}) on target "${target.name}" broke ${broken.length} invariant(s) of ${fault.spec}:`,
    ...broken.map((b) => `  - ${b}`),
    `Reproduce: pnpm vitest run packages/adapters/ollama/test/faults -t "${fault.id} on ${target.name}"`,
  ].join('\n');
}
