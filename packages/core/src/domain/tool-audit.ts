import type { ToolCallOutcome, ToolRefusalReason } from './tools.ts';

/**
 * One tool call attempt as the audit keeps it: who, which tool and
 * definition, under which policy, and what happened. Never the arguments or
 * the result, which may carry learner text or third-party content.
 */
export interface ToolCallRecord {
  readonly learnerId: string;
  readonly sessionId: string;
  readonly courseId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly server: string;
  readonly tool: string;
  /** The pinned digest of the tool called; absent when the tool was not granted. */
  readonly digest?: string;
  readonly outcome: ToolCallOutcome['kind'];
  /** The refusal reason, or the port error kind of a failure. */
  readonly reason?: ToolRefusalReason | 'unavailable' | 'timeout' | 'invalid-response' | 'rejected';
  /** Whether a tool that answered reported an error. */
  readonly isError?: boolean;
  readonly argumentChars: number;
  readonly resultChars: number;
  readonly elapsedMs: number;
  readonly calledAt: Date;
  /** The component that made the call, e.g. "inference-api". */
  readonly source: string;
}

export interface RecordedToolCall extends ToolCallRecord {
  readonly sequence: number;
}

export interface ToolCallQuery {
  readonly courseId: string;
  readonly learnerId?: string;
  readonly afterSequence?: number;
}
