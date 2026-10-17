import { DEFAULT_INSIGHT_THRESHOLDS, type EvidenceStore } from '@tutors-ai/core';
import { anEvidence, FixedClock, InMemoryEvidenceStore, InMemoryInsightStore, RecordingTelemetry } from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import { ConfigError, readConfig } from '../src/config.ts';
import { runInsights } from '../src/run.ts';

describe('insights worker', () => {
  it('saves one run per course with its insights and recommendations, and keeps going past a failing course', async () => {
    const clock = new FixedClock('2026-10-16T02:00:00Z');
    const evidence = new InMemoryEvidenceStore(clock);
    for (let i = 0; i < 6; i++) await evidence.append(anEvidence({ learnerId: `l${i}`, type: 'assistance-requested' }));
    const flaky: EvidenceStore = {
      ...evidence,
      append: evidence.append.bind(evidence),
      expire: evidence.expire.bind(evidence),
      read: async (q) => {
        if (q.courseId === 'broken') throw new Error('db down');
        return evidence.read(q);
      },
    };
    const store = new InMemoryInsightStore();
    const log: Record<string, unknown>[] = [];
    const telemetry = new RecordingTelemetry();
    const result = await runInsights(['course-1', 'broken', 'empty'], { evidence: flaky, store, clock, thresholds: DEFAULT_INSIGHT_THRESHOLDS, log: (e) => log.push(e), telemetry });
    expect(result).toEqual({ ok: 2, failed: 1 });
    const run = await store.latest('course-1');
    expect(run?.producedAt.toISOString()).toBe('2026-10-16T02:00:00.000Z');
    expect(run?.insights.map((i) => i.type)).toEqual(['help-hotspot', 'low-completion']);
    expect(run?.recommendations.map((r) => r.rule.id)).toEqual(['PED-2', 'PED-3']);
    expect(await store.latest('empty')).toMatchObject({ insights: [], recommendations: [] });
    expect(await store.latest('broken')).toBeNull();
    expect(log).toEqual([
      { msg: 'insights saved', courseId: 'course-1', insights: 2, recommendations: 2 },
      { msg: 'insights failed', courseId: 'broken', error: 'db down' },
      { msg: 'insights saved', courseId: 'empty', insights: 0, recommendations: 0 },
    ]);
    const [root, ...rest] = telemetry.spans;
    expect(root).toMatchObject({ name: 'InsightsRun', outcome: 'error', attributes: { 'run.courses': 3, 'run.ok': 2, 'run.failed': 1 } });
    expect(rest.map((s) => [s.name, s.parent?.name, s.outcome])).toEqual([
      ['InsightsRun.course', 'InsightsRun', 'ok'],
      ['InsightStore.save', 'InsightsRun.course', 'ok'],
      ['InsightsRun.course', 'InsightsRun', 'error'],
      ['InsightsRun.course', 'InsightsRun', 'ok'],
      ['InsightStore.save', 'InsightsRun.course', 'ok'],
    ]);
    expect(rest[0]?.attributes).toEqual({ 'course.id': 'course-1', 'insights.count': 2, 'recommendations.count': 2 });
  });

  it('reads its configuration and refuses a cohort minimum that would identify learners', () => {
    expect(readConfig({ PG_URL: 'postgres://db/x', COURSE_EXPORT_DIR: '/c' })).toEqual({
      pgUrl: 'postgres://db/x',
      pgSchema: 'public',
      courseExportDir: '/c',
      courseIds: undefined,
      thresholds: DEFAULT_INSIGHT_THRESHOLDS,
      otelEndpoint: undefined,
    });
    expect(readConfig({ PG_URL: 'p', COURSE_EXPORT_DIR: '/c', OTEL_EXPORTER_OTLP_ENDPOINT: ' http://otel-collector:4318 ' }).otelEndpoint).toBe('http://otel-collector:4318');
    expect(readConfig({ PG_URL: 'p', COURSE_EXPORT_DIR: '/c', COURSE_IDS: 'a, b,,', INSIGHTS_MIN_COHORT: '8', INSIGHTS_HELP_SHARE: '0.7' })).toMatchObject({
      courseIds: ['a', 'b'],
      thresholds: { minCohort: 8, helpShare: 0.7 },
    });
    expect(() => readConfig({ COURSE_EXPORT_DIR: '/c' })).toThrow(new ConfigError('PG_URL is required'));
    expect(() => readConfig({ PG_URL: 'p' })).toThrow('COURSE_EXPORT_DIR is required');
    expect(() => readConfig({ PG_URL: 'p', COURSE_EXPORT_DIR: '/c', INSIGHTS_MIN_COHORT: '2' })).toThrow('at least 3');
    expect(() => readConfig({ PG_URL: 'p', COURSE_EXPORT_DIR: '/c', INSIGHTS_STALL_SHARE: '1.5' })).toThrow('INSIGHTS_STALL_SHARE');
  });
});
