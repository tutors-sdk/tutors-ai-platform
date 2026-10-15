import type { MemorySharing } from './capability.ts';
import type { RetentionKind } from './retention.ts';

/** One remembered exchange. */
export interface MemoryEntry {
  readonly learnerId: string;
  readonly sessionId: string;
  readonly courseId: string;
  readonly programmeId?: string;
  readonly sharing: MemorySharing;
  /** The scope kind the entry was written under; it ends at that scope's boundary. */
  readonly retention: RetentionKind;
  readonly recordedAt: Date;
  readonly question: string;
  readonly answer: string;
}
