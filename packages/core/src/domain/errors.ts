const PORT_ERROR = Symbol.for('tutors-ai.PortError');

/** Raised by driven-port adapters; the core maps these to policy outcomes. */
export class PortError extends Error {
  readonly [PORT_ERROR] = true;

  /**
   * Brand check rather than instanceof, so an error raised by an adapter that
   * resolved its own copy of this package is still recognised.
   */
  static is(error: unknown): error is PortError {
    return (error as { [PORT_ERROR]?: unknown } | null | undefined)?.[PORT_ERROR] === true;
  }

  constructor(
    readonly port: string,
    readonly kind: 'unavailable' | 'timeout' | 'invalid-response' | 'rejected',
    message: string,
  ) {
    super(message);
    this.name = 'PortError';
  }
}

/** Raised by a use case when its input breaks a domain rule. */
export class DomainRuleViolation extends Error {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainRuleViolation';
  }
}
