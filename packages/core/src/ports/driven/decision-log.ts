import type { DecisionQuery, GovernanceDecision, RecordedDecision } from '../../domain/governance.ts';

/** Driven port (planned): the append-only log of governance decisions. */
export interface DecisionLog {
  /** Appends and returns the stored decision with its assigned sequence. */
  append(decision: GovernanceDecision): Promise<RecordedDecision>;
  /** Matching decisions in ascending sequence order. */
  read(query: DecisionQuery): Promise<readonly RecordedDecision[]>;
}
