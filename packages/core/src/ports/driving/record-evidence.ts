import type { NewEvidence, RecordedEvidence } from '../../domain/evidence.ts';

/** Driving port: append learning evidence. */
export interface RecordEvidence {
  record(evidence: NewEvidence): Promise<RecordedEvidence>;
}
