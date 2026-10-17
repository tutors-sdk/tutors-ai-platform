export type AttributeValue = string | number | boolean;

export interface Span {
  setAttribute(key: string, value: AttributeValue): void;
  end(outcome: 'ok' | 'error'): void;
}

/** Driven port: tracing, model metrics and the evidence-trail log. */
export interface Telemetry {
  /**
   * Starts a span; with `parent`, a child of it in the same trace (TEL-004).
   * Use cases name their span after the driving port, and each driven-port
   * call after the port and operation, e.g. `LanguageModel.complete`.
   */
  startSpan(name: string, attributes?: Readonly<Record<string, AttributeValue>>, parent?: Span): Span;
}

/** A Telemetry that records nothing; the default when none is wired. */
export const NO_TELEMETRY: Telemetry = {
  startSpan: () => ({ setAttribute: () => undefined, end: () => undefined }),
};
