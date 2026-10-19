/**
 * The vocabulary of the fault catalogue: what a fault is, what a target is,
 * and the outcome a fault must state in full.
 */
import type { PortError } from '@tutors-ai/core';
import type { ResilienceEvent } from '@tutors-ai/adapter-resilience';
import type { ScriptedResponse } from './transport.ts';

/** What a successful call returns, reduced to what a fault can change. */
export interface Answer {
  readonly depth: string;
  readonly text: string;
  readonly citations: readonly string[];
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
}

/** The properties of a target that decide what a fault should do to it. */
export interface TargetTraits {
  readonly name: string;
  /** Attempts the target makes at a retryable (unavailable) failure. */
  readonly attempts: number;
  /** The request timeout the target's calls carry, in milliseconds. */
  readonly timeoutMs: number;
}

export interface Target extends TargetTraits {
  /** Runs the call through a fresh adapter over `fetch`, recording resilience events. */
  call(fetch: typeof globalThis.fetch, events: ResilienceEvent['type'][]): Promise<Answer>;
}

export type Settlement =
  | { readonly resolves: Answer }
  | { readonly rejects: { readonly kind: PortError['kind']; readonly message: RegExp } };

export interface Outcome {
  readonly settlement: Settlement;
  /** HTTP requests the call sends, /api/tags and retries included. */
  readonly requests: number;
  /** Wall-clock time from call to settlement. */
  readonly elapsedMs: { readonly min: number; readonly max: number };
  /** Every resilience event, in order; `[]` for a target with no decorator or a call it let through untouched. */
  readonly events: readonly ResilienceEvent['type'][];
}

export interface FaultContext {
  readonly target: TargetTraits;
}

export interface Fault {
  /** Stable kebab-case id, used in test names and known-gaps.json. */
  readonly id: string;
  /** What the server or network does, in one line. */
  readonly title: string;
  /** The EARS requirement that says what should happen, e.g. `OLL-006`. */
  readonly spec: string;
  /** Targets the fault applies to. Default: all. */
  appliesTo?(target: TargetTraits): boolean;
  /** The responses the call is served, in order. */
  exchange(ctx: FaultContext): readonly ScriptedResponse[];
  /** What the adapter must do. */
  expected(ctx: FaultContext): Outcome;
}

/** An entry in known-gaps.json: a fault that exposes a bug not yet fixed. */
export interface KnownGap {
  readonly fault: string;
  readonly targets: readonly string[];
  readonly reason: string;
}
