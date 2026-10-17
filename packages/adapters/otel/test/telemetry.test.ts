import { SpanStatusCode, type Tracer } from '@opentelemetry/api';
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { exportable, OtelTelemetry, startOtel } from '../src/index.ts';

function setup() {
  const spans = new InMemorySpanExporter();
  const tracer = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spans)] }).getTracer('test');
  const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });
  const meter = new MeterProvider({ readers: [reader] }).getMeter('test');
  const metricsNamed = async (name: string) => {
    await reader.forceFlush();
    const latest = metricExporter.getMetrics().at(-1);
    return (latest?.scopeMetrics ?? [])
      .flatMap((sm) => sm.metrics)
      .filter((m) => m.descriptor.name === name)
      .flatMap((m) => (m.dataPoints as readonly { attributes: Record<string, unknown>; value: unknown }[]).map((p) => p));
  };
  return { spans, telemetry: new OtelTelemetry(tracer, meter), metricsNamed };
}

describe('OtelTelemetry', () => {
  it('TEL-001 exports a span with its attributes and outcome once it ends', () => {
    const s = setup();
    const span = s.telemetry.startSpan('AssistStudent', { 'learner.level': 'beginner', 'course.id': 'c1' });
    span.setAttribute('assist.outcome', 'answered');
    expect(s.spans.getFinishedSpans()).toHaveLength(0);
    span.end('ok');
    const failed = s.telemetry.startSpan('AssistStudent');
    failed.end('error');
    const [ok, error] = s.spans.getFinishedSpans();
    expect(ok?.name).toBe('AssistStudent');
    expect(ok?.attributes).toEqual({ 'learner.level': 'beginner', 'course.id': 'c1', 'assist.outcome': 'answered' });
    expect(ok?.status.code).toBe(SpanStatusCode.OK);
    expect(error?.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('TEL-002 aggregates model metrics per capability level and never per learner', async () => {
    const s = setup();
    for (const [learner, level] of [
      ['l1', 'beginner'],
      ['l2', 'beginner'],
      ['l3', 'advanced'],
    ] as const) {
      const span = s.telemetry.startSpan('AssistStudent', { 'learner.level': level, 'learner.id': learner, 'session.id': `s-${learner}` });
      span.setAttribute('learnerId', learner);
      span.setAttribute('model.tokens.in', 100);
      span.setAttribute('model.tokens.out', 10);
      span.setAttribute('assist.outcome', 'answered');
      span.end('ok');
    }
    for (const exported of s.spans.getFinishedSpans()) {
      expect(Object.keys(exported.attributes)).not.toContain('learner.id');
      expect(Object.keys(exported.attributes)).not.toContain('session.id');
      expect(Object.keys(exported.attributes)).not.toContain('learnerId');
    }
    const tokens = await s.metricsNamed('tutors_ai.model.tokens');
    expect(tokens.map((p) => [p.attributes['learner.level'], p.attributes['direction'], p.value]).sort()).toEqual([
      ['advanced', 'in', 100],
      ['advanced', 'out', 10],
      ['beginner', 'in', 200],
      ['beginner', 'out', 20],
    ]);
    const durations = await s.metricsNamed('tutors_ai.span.duration');
    expect(durations).toHaveLength(2);
    for (const p of [...tokens, ...durations]) {
      expect(Object.keys(p.attributes).filter((k) => !exportable(k))).toEqual([]);
    }
  });

  it('TEL-002 classifies per-learner attribute keys', () => {
    for (const key of ['learner.id', 'learner.programme', 'session.id', 'programme.id', 'learnerId', 'sessionId', 'evidence.learner_id']) {
      expect(exportable(key), key).toBe(false);
    }
    for (const key of ['learner.level', 'course.id', 'assist.outcome', 'model.digest', 'policy.version']) {
      expect(exportable(key), key).toBe(true);
    }
  });

  it('TEL-004 exports a span started with a parent as its child in the same trace', () => {
    const s = setup();
    const root = s.telemetry.startSpan('AssistStudent');
    const child = s.telemetry.startSpan('LanguageModel.complete', {}, root);
    child.end('ok');
    root.end('ok');
    const unrelated = s.telemetry.startSpan('AssistStudent');
    unrelated.end('ok');
    const [exportedChild, exportedRoot, exportedUnrelated] = s.spans.getFinishedSpans();
    expect(exportedChild?.spanContext().traceId).toBe(exportedRoot?.spanContext().traceId);
    expect(exportedChild?.parentSpanContext?.spanId).toBe(exportedRoot?.spanContext().spanId);
    expect(exportedUnrelated?.spanContext().traceId).not.toBe(exportedRoot?.spanContext().traceId);
    expect(exportedUnrelated?.parentSpanContext).toBeUndefined();
  });

  it('TEL-003 drops data rather than fail when the tracer misbehaves', () => {
    const broken = {
      startSpan: () => {
        throw new Error('backend down');
      },
    } as unknown as Tracer;
    const telemetry = new OtelTelemetry(broken, new MeterProvider().getMeter('t'));
    const span = telemetry.startSpan('AssistStudent', { 'learner.level': 'beginner' });
    expect(() => span.setAttribute('a', 1)).not.toThrow();
    expect(() => span.end('ok')).not.toThrow();

    const throwingSpan = {
      startSpan: () => ({
        setAttribute: () => {
          throw new Error('x');
        },
        setStatus: () => {
          throw new Error('x');
        },
        end: () => undefined,
      }),
    } as unknown as Tracer;
    const half = new OtelTelemetry(throwingSpan, new MeterProvider().getMeter('t')).startSpan('x');
    expect(() => half.setAttribute('a', 1)).not.toThrow();
    expect(() => half.end('error')).not.toThrow();
  });

  it('TEL-003 drops data without delaying the request when the collector is unreachable', async () => {
    const otel = startOtel({ endpoint: 'http://127.0.0.1:9', serviceName: 'test' });
    const started = performance.now();
    for (let i = 0; i < 50; i++) otel.telemetry.startSpan('AssistStudent', { 'learner.level': 'beginner' }).end('ok');
    expect(performance.now() - started).toBeLessThan(250);
    await otel.shutdown();
  });
});
