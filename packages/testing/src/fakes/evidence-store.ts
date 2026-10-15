import { endsAt, type EvidenceQuery, type EvidenceStore, type NewEvidence, type RecordedEvidence, type RetentionBoundary } from '@tutors-ai/core';
import type { Clock } from '@tutors-ai/core';

export class InMemoryEvidenceStore implements EvidenceStore {
  #records: RecordedEvidence[] = [];
  #sequence = 0;
  readonly #clock: Clock;
  /** Set to make every append fail, for fail-closed tests. */
  failAppends = false;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  get all(): readonly RecordedEvidence[] {
    return this.#records;
  }

  async append(evidence: NewEvidence): Promise<RecordedEvidence> {
    if (this.failAppends) throw new Error('evidence store unavailable');
    this.#sequence += 1;
    const record: RecordedEvidence = Object.freeze({ ...evidence, sequence: this.#sequence, recordedAt: this.#clock.now() });
    this.#records.push(record);
    return record;
  }

  async read(query: EvidenceQuery): Promise<readonly RecordedEvidence[]> {
    return this.#records.filter(
      (r) =>
        r.courseId === query.courseId &&
        (query.learnerId === undefined || r.learnerId === query.learnerId) &&
        (query.labId === undefined || r.labId === query.labId) &&
        (query.afterSequence === undefined || r.sequence > query.afterSequence),
    );
  }

  async expire(boundary: RetentionBoundary): Promise<number> {
    const before = this.#records.length;
    this.#records = this.#records.filter((r) => !endsAt(boundary, r));
    return before - this.#records.length;
  }
}

