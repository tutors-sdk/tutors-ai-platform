import type { GovernedMemory, NewGovernedMemory, SharingTarget } from '../../domain/governance.ts';
import type { LearnerContext } from '../../domain/learner.ts';
import type { MemoryScope } from '../../domain/capability.ts';
import type { RetentionBoundary } from '../../domain/retention.ts';

/**
 * Driven port (planned): scoped, versioned memory with provenance, searched by
 * meaning. MemoryHub over MCP is the intended adapter (docs/adr/0006); course
 * material is never stored here, it stays behind CourseContent.
 */
export interface GovernedMemoryStore {
  /** Stores a memory and returns it with its id and version 1. */
  write(memory: NewGovernedMemory): Promise<GovernedMemory>;
  /**
   * Active memories visible to this learner under `scope` that best match
   * `text`, most relevant first; the visibility rules of LearnerMemory apply,
   * and promoted memories are visible only within their sharing target.
   */
  search(reader: LearnerContext & { readonly cohortId?: string }, scope: MemoryScope, text: string, limit: number): Promise<readonly GovernedMemory[]>;
  /** Every memory, active or candidate, the owner wrote in this course, latest versions only. */
  ownedBy(ownerId: string, courseId: string): Promise<readonly GovernedMemory[]>;
  /** A new version of the owner's memory with corrected text, or null when the owner has no such memory. */
  revise(ownerId: string, memoryId: string, text: string, at: Date): Promise<GovernedMemory | null>;
  /** Removes every version of the owner's memory; false when there was none. */
  remove(ownerId: string, memoryId: string): Promise<boolean>;
  /** Writes an approved candidate's text as a new active memory shared with `target` only. */
  promote(memory: NewGovernedMemory & { readonly target: SharingTarget }): Promise<GovernedMemory>;
  /** Removes memories whose retention ends at this boundary. Returns the number removed. */
  expire(boundary: RetentionBoundary): Promise<number>;
}
