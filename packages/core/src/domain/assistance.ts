import type { AssistanceDepth } from './capability.ts';
import type { LearnerContext } from './learner.ts';
import type { AssistanceBound } from './policy.ts';

export interface AssistanceRequest {
  readonly learner: LearnerContext;
  readonly question: string;
}

/** Everything needed to reproduce or audit one exchange. */
export interface AssistanceTrace {
  readonly bound: AssistanceBound | null;
  readonly materialIds: readonly string[];
  readonly model: { readonly name: string; readonly digest: string } | null;
  readonly promptVersion: string | null;
}

export const REFUSAL_REASONS = [
  'empty-question',
  'no-policy',
  'no-material',
  'depth-exceeded',
  'citation-outside-material',
  'no-citation',
  'model-unavailable',
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export type AssistanceResponse =
  | {
      readonly kind: 'answered';
      readonly depth: AssistanceDepth;
      readonly text: string;
      readonly citations: readonly string[];
      readonly truncated: boolean;
      readonly trace: AssistanceTrace;
    }
  | {
      readonly kind: 'refused';
      readonly reason: RefusalReason;
      readonly trace: AssistanceTrace;
    };
