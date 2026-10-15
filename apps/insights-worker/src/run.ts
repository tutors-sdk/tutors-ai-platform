import {
  ExplainLabInsightsService,
  RecommendInterventionsService,
  type Clock,
  type EvidenceStore,
  type InsightStore,
  type InsightThresholds,
} from '@tutors-ai/core';

export interface RunDeps {
  readonly evidence: EvidenceStore;
  readonly store: InsightStore;
  readonly clock: Clock;
  readonly thresholds: InsightThresholds;
  readonly log: (entry: Record<string, unknown>) => void;
}

/**
 * One batch run: for each course, the cohort view and the recommendations
 * that follow from it, saved as one run. A failing course is logged and the
 * rest still run; the result says how many failed.
 */
export async function runInsights(courseIds: readonly string[], deps: RunDeps): Promise<{ readonly ok: number; readonly failed: number }> {
  const insights = new ExplainLabInsightsService({ evidence: deps.evidence, thresholds: deps.thresholds });
  const recommend = new RecommendInterventionsService({ insights });
  let ok = 0;
  let failed = 0;
  for (const courseId of courseIds) {
    try {
      const found = await insights.explain({ courseId, granularity: 'cohort' });
      const recommendations = await recommend.recommend(courseId);
      await deps.store.save({ courseId, producedAt: deps.clock.now(), insights: found, recommendations });
      deps.log({ msg: 'insights saved', courseId, insights: found.length, recommendations: recommendations.length });
      ok++;
    } catch (error) {
      deps.log({ msg: 'insights failed', courseId, error: error instanceof Error ? error.message : String(error) });
      failed++;
    }
  }
  return { ok, failed };
}
