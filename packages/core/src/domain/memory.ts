import type { MemorySharing } from './capability.ts';

/** One remembered exchange. */
export interface MemoryEntry {
  readonly learnerId: string;
  readonly sessionId: string;
  readonly courseId: string;
  readonly programmeId?: string;
  readonly sharing: MemorySharing;
  readonly recordedAt: Date;
  readonly question: string;
  readonly answer: string;
}
