import type { EvidenceQuery, NewEvidence, RecordedEvidence } from '../../domain/evidence.ts';
import type { RetentionBoundary } from '../../domain/retention.ts';

export type { RetentionBoundary };

/** Driven port: append-only learning evidence. */
export interface EvidenceStore {
  /** Appends and returns the stored record with its assigned sequence. */
  append(evidence: NewEvidence): Promise<RecordedEvidence>;
  /** Matching evidence in ascending sequence order. */
  read(query: EvidenceQuery): Promise<readonly RecordedEvidence[]>;
  /**
   * Removes evidence whose retention ends at this boundary: a session boundary
   * removes `session` retention for that session, a course boundary removes
   * `session` and `course` retention for that course, and a learner boundary
   * (an erasure request) removes everything for that learner.
   * Returns the number of records removed.
   */
  expire(boundary: RetentionBoundary): Promise<number>;
}
