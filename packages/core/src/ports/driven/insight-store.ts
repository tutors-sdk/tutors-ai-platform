import type { Insight } from '../driving/explain-lab-insights.ts';
import type { InterventionRecommendation } from '../driving/recommend-interventions.ts';

/** One run of the insights worker over a course. */
export interface InsightRun {
  readonly courseId: string;
  readonly producedAt: Date;
  readonly insights: readonly Insight[];
  readonly recommendations: readonly InterventionRecommendation[];
}

/** Driven port: where insight runs are kept for lecturers to read. */
export interface InsightStore {
  save(run: InsightRun): Promise<void>;
  /** The most recent run for a course, or null if there is none. */
  latest(courseId: string): Promise<InsightRun | null>;
}
