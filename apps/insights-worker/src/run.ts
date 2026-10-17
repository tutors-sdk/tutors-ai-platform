import {
  ExplainLabInsightsService,
  NO_TELEMETRY,
  RecommendInterventionsService,
  traced,
  type Clock,
  type EvidenceStore,
  type InsightStore,
  type InsightThresholds,
  type Telemetry,
} from '@tutors-ai/core';

export interface RunDeps {
  readonly evidence: EvidenceStore;
  readonly store: InsightStore;
  readonly clock: Clock;
  readonly thresholds: InsightThresholds;
  readonly log: (entry: Record<string, unknown>) => void;
  readonly telemetry?: Telemetry;
}

/**
 * One batch run: for each course, the cohort view and the recommendations
 * that follow from it, saved as one run. A failing course is logged and the
 * rest still run; the result says how many failed. The run is one trace: an
 * `InsightsRun` span with an `InsightsRun.course` child per course and the
 * save traced under it (docs/observability.md).
 */
export async function runInsights(courseIds: readonly string[], deps: RunDeps): Promise<{ readonly ok: number; readonly failed: number }> {
  const insights = new ExplainLabInsightsService({ evidence: deps.evidence, thresholds: deps.thresholds });
  const recommend = new RecommendInterventionsService({ insights });
  const telemetry = deps.telemetry ?? NO_TELEMETRY;
  const run = telemetry.startSpan('InsightsRun', { 'run.courses': courseIds.length });
  let ok = 0;
  let failed = 0;
  for (const courseId of courseIds) {
    const span = telemetry.startSpan('InsightsRun.course', { 'course.id': courseId }, run);
    try {
      const found = await insights.explain({ courseId, granularity: 'cohort' });
      const recommendations = await recommend.recommend(courseId);
      await traced(telemetry, span, 'InsightStore.save', () =>
        deps.store.save({ courseId, producedAt: deps.clock.now(), insights: found, recommendations }),
      );
      span.setAttribute('insights.count', found.length);
      span.setAttribute('recommendations.count', recommendations.length);
      span.end('ok');
      deps.log({ msg: 'insights saved', courseId, insights: found.length, recommendations: recommendations.length });
      ok++;
    } catch (error) {
      span.end('error');
      deps.log({ msg: 'insights failed', courseId, error: error instanceof Error ? error.message : String(error) });
      failed++;
    }
  }
  run.setAttribute('run.ok', ok);
  run.setAttribute('run.failed', failed);
  run.end(failed === 0 ? 'ok' : 'error');
  return { ok, failed };
}
