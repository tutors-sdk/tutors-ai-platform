import type { GovernedMemory } from '../../domain/governance.ts';

/** Driving port (planned): a learner sees, corrects and deletes what their assistant remembers. */
export interface CurateMemory {
  list(learnerId: string, courseId: string): Promise<readonly GovernedMemory[]>;
  /** The corrected memory, or null when the learner owns no such memory. */
  correct(learnerId: string, memoryId: string, text: string): Promise<GovernedMemory | null>;
  /** Deletes the memory and withdraws any sharing candidate made from it. */
  forget(learnerId: string, memoryId: string): Promise<boolean>;
}
