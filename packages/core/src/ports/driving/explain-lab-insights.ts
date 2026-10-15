import type { RecordedEvidence } from '../../domain/evidence.ts';

/** A claim about engagement or attainment, explainable by construction. */
export interface Insight {
  readonly id: string;
  readonly courseId: string;
  readonly labId?: string;
  readonly learnerId?: string;
  readonly claim: string;
  readonly producedBy: 'rule' | 'model';
  readonly evidence: readonly RecordedEvidence[];
  readonly reasoning: string;
}

export interface InsightQuery {
  readonly courseId: string;
  readonly labId?: string;
  readonly granularity: 'cohort' | 'lab' | 'student';
}

/** Driving port: produce explainable insights for a lab or cohort. Planned for phase 4. */
export interface ExplainLabInsights {
  explain(query: InsightQuery): Promise<readonly Insight[]>;
}
