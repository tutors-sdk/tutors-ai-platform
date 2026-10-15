import type { Insight } from './explain-lab-insights.ts';

export interface InterventionRecommendation {
  readonly id: string;
  readonly suggestion: string;
  /** The insight, carrying its evidence and reasoning. */
  readonly insight: Insight;
  /** The pedagogical rule linking the insight to the suggestion. */
  readonly rule: { readonly id: string; readonly statement: string };
}

/** Driving port: derive lecturer-facing recommendations from verified insights. */
export interface RecommendInterventions {
  recommend(courseId: string, labId?: string): Promise<readonly InterventionRecommendation[]>;
}
