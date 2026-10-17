import type { ActivityType, AssessmentStatus, Consent, GovernedMemory } from '../../domain/governance.ts';
import type { LearnerContext } from '../../domain/learner.ts';

export interface ReflectionRequest {
  readonly learner: LearnerContext;
  readonly cohortId?: string;
  readonly activity: ActivityType;
  readonly assessment: AssessmentStatus;
  readonly consent: Consent;
  readonly text: string;
}

export type ReflectionOutcome =
  | { readonly kind: 'kept'; readonly memory: GovernedMemory; readonly proposedForSharing: boolean; readonly decisionSequence: number }
  | { readonly kind: 'not-kept'; readonly reason: 'empty' | 'no-policy' | 'no-consent' | 'policy' | 'memory-unavailable'; readonly decisionSequence: number | null };

/** Driving port (planned): a learner writes a reflection for their assistant to remember. */
export interface RecordReflection {
  reflect(request: ReflectionRequest): Promise<ReflectionOutcome>;
}
