import type { MemoryScope } from '../../domain/capability.ts';
import type { LearnerContext } from '../../domain/learner.ts';
import type { MemoryEntry } from '../../domain/memory.ts';
import type { RetentionBoundary } from '../../domain/retention.ts';

export interface MemoryWrite {
  readonly question: string;
  readonly answer: string;
  readonly recordedAt: Date;
}

/** Driven port: what a learner's assistant remembers, bounded by scope. */
export interface LearnerMemory {
  /**
   * Entries visible to this learner under `scope`, oldest first:
   * none → nothing; session → this session; course → this course;
   * programme → this programme. With cohort sharing, entries other learners
   * shared with the cohort in the same course are visible too.
   */
  recall(learner: LearnerContext, scope: MemoryScope, limit: number): Promise<readonly MemoryEntry[]>;
  /** Stores an entry under `scope`; a `none` scope stores nothing. */
  remember(learner: LearnerContext, scope: MemoryScope, entry: MemoryWrite): Promise<void>;
  /**
   * Removes entries whose retention ends at this boundary (see `endsAt`): a
   * learner boundary removes every entry the learner wrote. Returns the number removed.
   */
  expire(boundary: RetentionBoundary): Promise<number>;
}
