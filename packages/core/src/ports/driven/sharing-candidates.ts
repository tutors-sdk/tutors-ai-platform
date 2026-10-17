import type { SharingCandidate, SharingTarget } from '../../domain/governance.ts';

export type CandidateReview =
  | { readonly decision: 'approve'; readonly reviewerId: string; readonly at: Date; readonly editedText?: string }
  | { readonly decision: 'reject'; readonly reviewerId: string; readonly at: Date };

/** Driven port (planned): memories proposed for sharing, waiting on a lecturer. */
export interface SharingCandidates {
  /** Records a pending candidate and returns it with its id. */
  propose(candidate: { readonly memoryId: string; readonly memoryVersion: number; readonly target: SharingTarget; readonly proposedText: string; readonly proposedAt: Date }): Promise<SharingCandidate>;
  /** Pending candidates for a course, oldest first. */
  pending(courseId: string): Promise<readonly SharingCandidate[]>;
  get(candidateId: string): Promise<SharingCandidate | null>;
  /** Settles a pending candidate; null when it does not exist or is already settled. */
  settle(candidateId: string, review: CandidateReview): Promise<SharingCandidate | null>;
  /** Removes every candidate made from this memory, e.g. when its owner deletes it. Returns the number removed. */
  withdraw(memoryId: string): Promise<number>;
}
