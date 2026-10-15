import type { AttributeValue, Span, Telemetry } from '@tutors-ai/core';

export interface RecordedSpan {
  readonly name: string;
  readonly attributes: Record<string, AttributeValue>;
  outcome: 'ok' | 'error' | 'open';
}

export class RecordingTelemetry implements Telemetry {
  readonly spans: RecordedSpan[] = [];

  startSpan(name: string, attributes: Readonly<Record<string, AttributeValue>> = {}): Span {
    const span: RecordedSpan = { name, attributes: { ...attributes }, outcome: 'open' };
    this.spans.push(span);
    return {
      setAttribute: (key, value) => {
        span.attributes[key] = value;
      },
      end: (outcome) => {
        span.outcome = outcome;
      },
    };
  }
}
