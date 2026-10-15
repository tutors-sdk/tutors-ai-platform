import type { CapabilityLevelId, MemoryScope } from './capability.ts';

/**
 * Who is asking and where they are. Built from the integration contract,
 * never from raw session data.
 */
export interface LearnerContext {
  readonly learnerId: string;
  readonly sessionId: string;
  readonly courseId: string;
  readonly programmeId?: string;
  readonly topicId?: string;
  readonly labId?: string;
  readonly level: CapabilityLevelId;
  /** The memory scope the monorepo has decided for this learner. */
  readonly memory: MemoryScope;
}
