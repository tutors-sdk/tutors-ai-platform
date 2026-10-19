export interface BackoffOptions {
  /** Ceiling of the first retry's delay; each later retry doubles it. */
  readonly baseMs: number;
  /** No retry waits longer than this. */
  readonly maxMs: number;
}

/** The highest delay retry `retry` (1 for the first) may wait. */
export function backoffCeiling(retry: number, { baseMs, maxMs }: BackoffOptions): number {
  return Math.min(maxMs, baseMs * 2 ** (retry - 1));
}

/**
 * Full jitter: uniform between zero and the ceiling, so callers that failed
 * together do not retry together. `random` returns a value in [0, 1).
 */
export function backoffDelay(retry: number, options: BackoffOptions, random: () => number): number {
  return Math.floor(random() * backoffCeiling(retry, options));
}
