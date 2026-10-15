import { metrics, trace } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OtelTelemetry } from './telemetry.ts';

export interface OtelOptions {
  /** OTLP/HTTP collector base URL, e.g. http://otel-collector:4318. */
  readonly endpoint: string;
  readonly serviceName: string;
  readonly serviceVersion?: string;
}

export interface StartedOtel {
  readonly telemetry: OtelTelemetry;
  shutdown(): Promise<void>;
}

/**
 * Wires the OpenTelemetry SDK to an OTLP collector. Spans are batched and
 * metrics exported periodically, so an unreachable collector costs dropped
 * data, never request latency (TEL-003).
 */
export function startOtel(options: OtelOptions): StartedOtel {
  const base = options.endpoint.replace(/\/+$/, '');
  const resource = resourceFromAttributes({
    'service.name': options.serviceName,
    ...(options.serviceVersion === undefined ? {} : { 'service.version': options.serviceVersion }),
  });
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces`, timeoutMillis: 2_000 }))],
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics`, timeoutMillis: 2_000 }),
        exportIntervalMillis: 15_000,
      }),
    ],
  });
  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);
  const telemetry = new OtelTelemetry(tracerProvider.getTracer(options.serviceName), meterProvider.getMeter(options.serviceName));
  return {
    telemetry,
    shutdown: async () => {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
    },
  };
}
