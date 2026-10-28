import type { RecordedToolCall, ToolAudit, ToolCallQuery, ToolCallRecord } from '@tutors-ai/core';

/** The fields of a ToolCallRecord; anything else handed to append is dropped (TA-005). */
const FIELDS: readonly (keyof ToolCallRecord)[] = [
  'learnerId',
  'sessionId',
  'courseId',
  'policyId',
  'policyVersion',
  'server',
  'tool',
  'digest',
  'outcome',
  'reason',
  'isError',
  'argumentChars',
  'resultChars',
  'elapsedMs',
  'calledAt',
  'source',
];

export class InMemoryToolAudit implements ToolAudit {
  readonly #records: RecordedToolCall[] = [];
  /** Set to make every append fail, for fail-closed tests. */
  failAppends = false;

  get all(): readonly RecordedToolCall[] {
    return this.#records;
  }

  async append(record: ToolCallRecord): Promise<RecordedToolCall> {
    if (this.failAppends) throw new Error('tool audit unavailable');
    const kept = Object.fromEntries(FIELDS.filter((f) => record[f] !== undefined).map((f) => [f, record[f]]));
    const recorded = Object.freeze({ ...kept, sequence: this.#records.length + 1 }) as RecordedToolCall;
    this.#records.push(recorded);
    return recorded;
  }

  async read(query: ToolCallQuery): Promise<readonly RecordedToolCall[]> {
    return this.#records.filter(
      (r) =>
        r.courseId === query.courseId &&
        (query.learnerId === undefined || r.learnerId === query.learnerId) &&
        (query.afterSequence === undefined || r.sequence > query.afterSequence),
    );
  }
}
