import type { AssistanceResponse } from '../../domain/assistance.ts';
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

/** The deterministic judges; each passes or fails a case. */
export const DETERMINISTIC_JUDGES = ['bound', 'citation', 'memory', 'latency'] as const;
export type DeterministicJudge = (typeof DETERMINISTIC_JUDGES)[number];

/**
 * A judge that scores wording, usually with a model. Its score gates only
 * once it has been calibrated against lecturer ratings and given a threshold.
 */
export interface AnswerJudge {
  readonly id: string;
  readonly calibrated: boolean;
  /** The minimum passing score, used only when calibrated. */
  readonly threshold?: number;
  /** A score in [0, 1]. */
  score(goldenCase: GoldenCase, response: AssistanceResponse): Promise<number>;
}

export interface Failure {
  readonly judge: DeterministicJudge | `answer:${string}` | 'error';
  readonly message: string;
}

export interface CaseResult {
  readonly caseId: string;
  readonly passed: boolean;
  readonly outcome: AssistanceResponse['kind'] | 'error';
  readonly latencyMs: number;
  readonly failures: readonly Failure[];
  /** Scores from answer judges, gating or not. */
  readonly scores: readonly { readonly judge: string; readonly score: number; readonly gating: boolean }[];
}

export type CaseDrift = 'regressed' | 'fixed' | 'still-failing' | 'still-passing' | 'new' | 'removed';

export interface DriftReport {
  /** Which of model digest, prompt version, policy versions and golden set version changed. */
  readonly changed: readonly ('model' | 'prompt' | 'policy' | 'golden-set')[];
  readonly cases: readonly { readonly caseId: string; readonly drift: CaseDrift }[];
  readonly regressions: number;
}

export interface EvaluationReport {
  readonly goldenSet: { readonly id: string; readonly version: string };
  readonly model: { readonly name: string; readonly digest: string } | null;
  readonly promptVersion: string | null;
  readonly policyVersions: readonly string[];
  readonly startedAt: string;
  readonly passed: boolean;
  readonly results: readonly CaseResult[];
  /** Null when there is no previous accepted run to compare with. */
  readonly drift: DriftReport | null;
}

/** Driving port: run a golden set against the current model and policy. */
export interface EvaluateCapability {
  evaluate(set: GoldenSet, previous?: EvaluationReport): Promise<EvaluationReport>;
}
