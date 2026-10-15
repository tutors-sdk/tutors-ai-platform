import type { AssistanceDepth, MemoryScopeKind } from './capability.ts';

/** Evidence types in the first release. */
export const EVIDENCE_TYPES = [
  'lab-opened',
  'step-reached',
  'assistance-requested',
  'assistance-given',
  'outcome-demonstrated',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** An observed, timestamped fact about learning, before it is stored. */
export interface NewEvidence {
  readonly type: EvidenceType;
  readonly learnerId: string;
  readonly sessionId: string;
  readonly courseId: string;
  readonly labId?: string;
  readonly stepId?: string;
  readonly observedAt: Date;
  /** Who observed it, e.g. "tutors-reader" or "inference-api". */
  readonly source: string;
  /** 0..1; how sure the source is that this happened. */
  readonly confidence: number;
  /** How long the evidence is kept, aligned with the learner's memory scope. */
  readonly retention: MemoryScopeKind;
  /** Present on assistance-given evidence. */
  readonly depth?: AssistanceDepth;
  readonly detail?: Readonly<Record<string, string>>;
}

/** Evidence once appended: the store assigns a monotonically increasing sequence. */
export interface RecordedEvidence extends NewEvidence {
  readonly sequence: number;
  readonly recordedAt: Date;
}

export interface EvidenceQuery {
  readonly courseId: string;
  readonly learnerId?: string;
  readonly labId?: string;
  readonly afterSequence?: number;
}
