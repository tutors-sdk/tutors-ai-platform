/**
 * A fault that asserts too little, on every count the gate checks. The
 * self-test fails if `catalogueProblems` accepts any part of it.
 */
import { CATALOGUE } from '../catalogue.ts';
import type { Fault, Outcome } from '../types.ts';

const copied = CATALOGUE.find((f) => f.id === 'chat-503-html')!;

export const WEAK_FAULT: Fault = {
  id: 'Weak_Fault',
  title: 'Something goes wrong',
  spec: 'LM-999',
  // Copies another fault's exchange, so it adds nothing.
  exchange: copied.exchange,
  expected: () =>
    ({
      settlement: { rejects: { kind: 'unavailable', message: /answered 503/ } },
      requests: 0,
      elapsedMs: { min: 0, max: 30_000 },
    }) as unknown as Outcome,
};

/** The problems the gate must report for it, one per check. */
export const WEAK_FAULT_PROBLEMS = [
  /id is not kebab-case/,
  /cites LM-999, which no EARS specification defines/,
  /serves the same exchange as "chat-503-html"/,
  /the error message pattern is not anchored/,
  /states no request count/,
  /elapsed-time window is wider than 1000ms/,
  /states no resilience events/,
];
