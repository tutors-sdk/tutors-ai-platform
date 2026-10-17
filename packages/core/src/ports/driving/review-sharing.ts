import type { GovernedMemory, SharingCandidate } from '../../domain/governance.ts';
import type { Principal } from '../driven/identity.ts';

export type ReviewDecision =
  | { readonly decision: 'approve'; readonly editedText?: string }
  | { readonly decision: 'reject' };

export type ReviewOutcome =
  | { readonly kind: 'promoted'; readonly candidate: SharingCandidate; readonly memory: GovernedMemory }
  | { readonly kind: 'rejected'; readonly candidate: SharingCandidate }
  | { readonly kind: 'refused'; readonly reason: 'not-a-lecturer' | 'not-found' | 'already-settled' | 'memory-changed' };

/** Driving port (planned): a lecturer approves, edits or rejects memories proposed for sharing. */
export interface ReviewSharing {
  pending(reviewer: Principal, courseId: string): Promise<readonly SharingCandidate[]>;
  review(reviewer: Principal, candidateId: string, decision: ReviewDecision): Promise<ReviewOutcome>;
}
