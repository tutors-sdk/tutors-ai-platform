import { type Attributes, context, type Meter, type Span as OtelSpan, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api';
import type { AttributeValue, Span, Telemetry } from '@tutors-ai/core';

/**
 * Attribute keys that would identify a learner. They never leave the process:
 * telemetry is aggregated per capability level, never per learner (TEL-002).
 */
const PER_LEARNER = /^(learner\.(?!level$)|session\.|programme\.id$)|(^|\.)(learner|session)_?id$/i;

/** Whether an attribute key may be exported. */
export function exportable(key: string): boolean {
  return !PER_LEARNER.test(key);
}

function scrub(attributes: Readonly<Record<string, AttributeValue>>): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) if (exportable(key)) out[key] = value;
  return out;
}

const DROPPED: Span = { setAttribute: () => undefined, end: () => undefined };

/** Model metrics are labelled with these attributes only, so series stay per level and per outcome. */
const METRIC_LABELS = ['learner.level', 'assist.outcome', 'assist.depth', 'assist.refusal', 'model.digest'] as const;

/**
 * Telemetry over the OpenTelemetry API. Exporting is the SDK's job, batched
 * off the request path; this adapter only shapes data and never throws into
 * the caller (TEL-003).
 */
export class OtelTelemetry implements Telemetry {
  readonly #tracer: Tracer;
  readonly #duration;
  readonly #tokens;
  /** The OpenTelemetry span behind each span handed out, so a child can name its parent (TEL-004). */
  readonly #spans = new WeakMap<Span, OtelSpan>();

  constructor(tracer: Tracer, meter: Meter) {
    this.#tracer = tracer;
    this.#duration = meter.createHistogram('tutors_ai.span.duration', { unit: 'ms', description: 'Span duration by name, level and outcome' });
    this.#tokens = meter.createCounter('tutors_ai.model.tokens', { description: 'Model tokens by direction and level' });
  }

  startSpan(name: string, attributes: Readonly<Record<string, AttributeValue>> = {}, parent?: Span): Span {
    try {
      const parentSpan = parent === undefined ? undefined : this.#spans.get(parent);
      const ctx = parentSpan === undefined ? context.active() : trace.setSpan(context.active(), parentSpan);
      const span = this.#tracer.startSpan(name, { attributes: scrub(attributes) }, ctx);
      const started = performance.now();
      const labels: Attributes = { name };
      const note = (key: string, value: AttributeValue) => {
        if ((METRIC_LABELS as readonly string[]).includes(key)) labels[key] = value;
      };
      for (const [key, value] of Object.entries(attributes)) note(key, value);
      const tokens: { in?: number; out?: number } = {};
      const handle: Span = {
        setAttribute: (key, value) => {
          try {
            if (!exportable(key)) return;
            span.setAttribute(key, value);
            note(key, value);
            if (key === 'model.tokens.in' && typeof value === 'number') tokens.in = value;
            if (key === 'model.tokens.out' && typeof value === 'number') tokens.out = value;
          } catch {
            // TEL-003: drop.
          }
        },
        end: (outcome) => {
          try {
            span.setStatus({ code: outcome === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR });
            span.end();
            const level = labels['learner.level'];
            const base: Attributes = level === undefined ? { name } : { name, 'learner.level': level };
            this.#duration.record(performance.now() - started, { ...labels, outcome });
            if (tokens.in !== undefined) this.#tokens.add(tokens.in, { ...base, direction: 'in' });
            if (tokens.out !== undefined) this.#tokens.add(tokens.out, { ...base, direction: 'out' });
          } catch {
            // TEL-003: drop.
          }
        },
      };
      this.#spans.set(handle, span);
      return handle;
    } catch {
      return DROPPED;
    }
  }
}
