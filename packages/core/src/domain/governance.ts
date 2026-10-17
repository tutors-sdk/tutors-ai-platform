/**
 * Governed memory: the vocabulary for policy decisions about what a learner's
 * assistant may read, say, keep and share (docs/adr/0006).
 *
 * Status: planned. These types are the seams the governed-memory work builds
 * on; no use case applies them yet. Change them spec first: edit the EARS
 * files under spec/ in the same pull request.
 */
import type { AssistanceDepth, MemoryScope } from './capability.ts';
import type { LearnerContext } from './learner.ts';
import type { Role } from '../ports/driven/identity.ts';

/** What the learner is doing when the decision is taken. */
export type ActivityType = 'lecture' | 'lab' | 'assessment';

/** Whether an assessment covering this activity is open; `none` when no assessment applies. */
export type AssessmentStatus = 'none' | 'open' | 'closed';

/** Where a memory came from. `extracted` memories start as candidates, never as facts. */
export type MemoryOrigin = 'exchange' | 'reflection' | 'tutors-event' | 'extracted';

/** What the learner has agreed to. Absent consent is refusal. */
export interface Consent {
  readonly retain: boolean;
  readonly share: boolean;
  /** Opt-in conversation extraction (the stretch goal). */
  readonly extract: boolean;
}

/**
 * Everything a governance decision may depend on. Every field arrives from a
 * trusted source (the contract, the identity port, policy data, or the core
 * itself); none is derived from what the learner typed, so wording cannot
 * widen assistance, reading or sharing.
 */
export interface GovernanceInputs {
  readonly role: Role;
  readonly learner: LearnerContext;
  /** The cohort within the course, when the course has more than one. */
  readonly cohortId?: string;
  readonly activity: ActivityType;
  readonly assessment: AssessmentStatus;
  readonly origin: MemoryOrigin;
  readonly consent: Consent;
  readonly policyId: string;
  readonly policyVersion: string;
}

/** The three decision points, in the order an exchange meets them. */
export type DecisionPoint = 'read' | 'assist' | 'retain';

/** The assistance tier, from refusal to a full answer. */
export type AssistanceTier = 'refuse' | AssistanceDepth;

export type GovernanceOutcome =
  /** Which memory may be read for this exchange. Never wider than the bound scope. */
  | { readonly point: 'read'; readonly scope: MemoryScope }
  /** The deepest assistance the model may give. Never deeper than the policy's maximum. */
  | { readonly point: 'assist'; readonly tier: AssistanceTier }
  /** Whether to keep the memory privately, and whether to propose it for sharing. */
  | { readonly point: 'retain'; readonly retain: boolean; readonly proposeForSharing: boolean };

/**
 * One decision as the decision log keeps it: enough to reconstruct why, and
 * no question, answer or memory text.
 */
export interface GovernanceDecision {
  readonly outcome: GovernanceOutcome;
  readonly inputs: Omit<GovernanceInputs, 'learner'> & {
    readonly learnerId: string;
    readonly sessionId: string;
    readonly courseId: string;
  };
  /** Ids of the policy rules that produced the outcome, most specific first. */
  readonly rules: readonly string[];
  readonly decidedAt: Date;
}

/** A decision once appended: the log assigns a monotonically increasing sequence. */
export interface RecordedDecision extends GovernanceDecision {
  readonly sequence: number;
}

export interface DecisionQuery {
  readonly courseId: string;
  readonly learnerId?: string;
  readonly point?: DecisionPoint;
  readonly afterSequence?: number;
}

/** Where a governed memory came from and which decision let it be kept. */
export interface Provenance {
  readonly origin: MemoryOrigin;
  /** Who observed or wrote it, e.g. "inference-api" or "tutors-reader". */
  readonly source: string;
  /** The retain decision that allowed it. */
  readonly decisionSequence: number;
  /** The evidence it was derived from, for `tutors-event` memories. */
  readonly evidenceSequence?: number;
  /** For a promoted memory, the private memory and candidate it came from. */
  readonly promotedFrom?: { readonly memoryId: string; readonly candidateId: string };
}

/** `candidate` memories are reviewable, never recalled as learner facts. */
export type GovernedMemoryStatus = 'active' | 'candidate';

export interface NewGovernedMemory {
  /** The author: the learner, or the lecturer for a promoted memory. */
  readonly ownerId: string;
  readonly sessionId: string;
  readonly courseId: string;
  readonly programmeId?: string;
  readonly cohortId?: string;
  readonly scope: MemoryScope;
  readonly status: GovernedMemoryStatus;
  readonly text: string;
  readonly provenance: Provenance;
  readonly recordedAt: Date;
}

/** A stored memory. A correction is a new version with the same id. */
export interface GovernedMemory extends NewGovernedMemory {
  readonly id: string;
  readonly version: number;
}

/** Where an approved candidate is promoted to. */
export interface SharingTarget {
  readonly courseId: string;
  /** Absent: the whole course. */
  readonly cohortId?: string;
}

export type CandidateState = 'pending' | 'approved' | 'rejected';

export interface SharingCandidate {
  readonly id: string;
  readonly memoryId: string;
  readonly memoryVersion: number;
  readonly target: SharingTarget;
  /** The text proposed for sharing; what learners would see, before any lecturer edit. */
  readonly proposedText: string;
  readonly proposedAt: Date;
  readonly state: CandidateState;
  readonly review?: {
    readonly reviewerId: string;
    readonly decidedAt: Date;
    /** Present when the lecturer edited before approving. */
    readonly editedText?: string;
  };
}
