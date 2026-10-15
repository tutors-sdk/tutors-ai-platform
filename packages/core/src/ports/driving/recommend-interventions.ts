import type { Insight } from './explain-lab-insights.ts';

export interface InterventionRecommendation {
  readonly id: string;
  readonly suggestion: string;
  readonly insight: Insight;
  /** The pedagogical rule linking the insight to the suggestion. */
  readonly rule: string;
}

/** Driving port: derive lecturer-facing recommendations from verified insights. Planned for phase 4. */
export interface RecommendInterventions {
  recommend(courseId: string, labId?: string): Promise<readonly InterventionRecommendation[]>;
}
