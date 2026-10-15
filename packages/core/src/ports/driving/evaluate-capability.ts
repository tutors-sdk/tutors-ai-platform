import type { AssistanceDepth } from '../../domain/capability.ts';
import type { LearnerContext } from '../../domain/learner.ts';

/** One golden case: what a lecturer expects for a question at a level. */
export interface GoldenCase {
  readonly id: string;
  readonly learner: LearnerContext;
  readonly question: string;
  readonly expected:
    | { readonly kind: 'answered'; readonly maxDepth: AssistanceDepth; readonly citations: readonly string[] }
    | { readonly kind: 'refused' };
}

export interface GoldenSet {
  readonly id: string;
  readonly version: string;
  readonly cases: readonly GoldenCase[];
}

export interface EvaluationReport {
  readonly goldenSet: { readonly id: string; readonly version: string };
  readonly model: { readonly name: string; readonly digest: string } | null;
  readonly promptVersion: string | null;
  readonly policyVersions: readonly string[];
  readonly results: readonly { readonly caseId: string; readonly passed: boolean; readonly failures: readonly string[] }[];
}

/** Driving port: run a golden set against the current model and policy. Planned for phase 3. */
export interface EvaluateCapability {
  evaluate(set: GoldenSet): Promise<EvaluationReport>;
}
