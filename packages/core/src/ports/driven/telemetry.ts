export type AttributeValue = string | number | boolean;

export interface Span {
  setAttribute(key: string, value: AttributeValue): void;
  end(outcome: 'ok' | 'error'): void;
}

/** Driven port: tracing, model metrics and the evidence-trail log. */
export interface Telemetry {
  startSpan(name: string, attributes?: Readonly<Record<string, AttributeValue>>): Span;
}

/** A Telemetry that records nothing; the default when none is wired. */
export const NO_TELEMETRY: Telemetry = {
  startSpan: () => ({ setAttribute: () => undefined, end: () => undefined }),
};
