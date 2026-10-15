import type { RetentionBoundary } from '../../domain/retention.ts';

export interface RetentionResult {
  readonly evidence: number;
  readonly memory: number;
}

/** Driving port: end retained evidence and memory at a session or course boundary, or erase a learner. */
export interface ApplyRetention {
  apply(boundary: RetentionBoundary): Promise<RetentionResult>;
}
