import type { EvidenceType } from '../../domain/evidence.ts';

/**
 * The evidence an insight rests on, as aggregates. Sequences let an
 * auditor trace each insight back to the stored records; no learner id
 * appears (ELI-005).
 */
export interface EvidenceSummary {
  readonly sequences: readonly number[];
  /** Distinct learners the evidence covers. */
  readonly learners: number;
  readonly byType: Readonly<Partial<Record<EvidenceType, number>>>;
}

/** A claim about engagement or attainment, explainable by construction. */
export interface Insight {
  /** Stable for the same type and place, so runs can be compared. */
  readonly id: string;
  /** The rule id, or the model insight type. */
  readonly type: string;
  readonly courseId: string;
  readonly labId?: string;
  readonly stepId?: string;
  readonly claim: string;
  readonly producedBy: 'rule' | 'model';
  readonly evidence: EvidenceSummary;
  readonly reasoning: string;
}

export interface InsightQuery {
  readonly courseId: string;
  readonly labId?: string;
  readonly granularity: 'cohort' | 'lab' | 'student';
}

/** What a model sees: per-lab aggregates, never individual records. */
export interface LabAggregate {
  readonly labId: string;
  readonly learners: number;
  readonly byType: Readonly<Partial<Record<EvidenceType, number>>>;
  /** Learners whose furthest step reached is this step. */
  readonly furthestStep: Readonly<Record<string, number>>;
}

/** A model's proposed insight, before the use case checks and labels it. */
export interface ModelInsightCandidate {
  readonly type: string;
  readonly labId?: string;
  readonly stepId?: string;
  readonly claim: string;
  readonly reasoning: string;
  readonly evidenceSequences: readonly number[];
}

/** An optional source of model-produced insights. */
export interface ModelInsightSource {
  propose(courseId: string, labs: readonly LabAggregate[]): Promise<readonly ModelInsightCandidate[]>;
}

/** Driving port: produce explainable insights for a lab or cohort. */
export interface ExplainLabInsights {
  explain(query: InsightQuery): Promise<readonly Insight[]>;
}
