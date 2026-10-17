import type { AttributeValue, Span, Telemetry } from '@tutors-ai/core';

export interface RecordedSpan {
  readonly name: string;
  readonly attributes: Record<string, AttributeValue>;
  readonly parent?: RecordedSpan;
  outcome: 'ok' | 'error' | 'open';
}

export class RecordingTelemetry implements Telemetry {
  readonly spans: RecordedSpan[] = [];
  readonly #recorded = new WeakMap<Span, RecordedSpan>();

  /** Spans with no parent: one per driving-port call. */
  get roots(): readonly RecordedSpan[] {
    return this.spans.filter((s) => s.parent === undefined);
  }

  startSpan(name: string, attributes: Readonly<Record<string, AttributeValue>> = {}, parent?: Span): Span {
    const parentSpan = parent === undefined ? undefined : this.#recorded.get(parent);
    const span: RecordedSpan = { name, attributes: { ...attributes }, ...(parentSpan === undefined ? {} : { parent: parentSpan }), outcome: 'open' };
    this.spans.push(span);
    const handle: Span = {
      setAttribute: (key, value) => {
        span.attributes[key] = value;
      },
      end: (outcome) => {
        span.outcome = outcome;
      },
    };
    this.#recorded.set(handle, span);
    return handle;
  }
}
