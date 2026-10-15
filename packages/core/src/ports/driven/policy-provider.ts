import type { CapabilityLevelId } from '../../domain/capability.ts';
import type { PedagogicalPolicy } from '../../domain/policy.ts';

/** Driven port: versioned pedagogical policy lookup. */
export interface PolicyProvider {
  /** The policy for this course and level, or null when none is defined. */
  policyFor(courseId: string, level: CapabilityLevelId): Promise<PedagogicalPolicy | null>;
}
