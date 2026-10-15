import type {
  AssistanceDepth,
  Clock,
  EvidenceQuery,
  EvidenceStore,
  EvidenceType,
  NewEvidence,
  RecordedEvidence,
  RetentionBoundary,
} from '@tutors-ai/core';
import { schemaName, type SqlClient } from './sql.ts';

interface EvidenceRow {
  sequence: string;
  type: EvidenceType;
  learner_id: string;
  session_id: string;
  course_id: string;
  lab_id: string | null;
  step_id: string | null;
  observed_at: Date;
  recorded_at: Date;
  source: string;
  confidence: number;
  retention: RecordedEvidence['retention'];
  depth: AssistanceDepth | null;
  detail: Record<string, string> | null;
}

const COLUMNS =
  'sequence, type, learner_id, session_id, course_id, lab_id, step_id, observed_at, recorded_at, source, confidence, retention, depth, detail';

/** EvidenceStore over PostgreSQL. Append-only is enforced by a trigger as well as by the API. */
export class PostgresEvidenceStore implements EvidenceStore {
  readonly #sql: SqlClient;
  readonly #clock: Clock;
  readonly #table: string;

  constructor(sql: SqlClient, clock: Clock, schema = 'public') {
    this.#sql = sql;
    this.#clock = clock;
    this.#table = `${schemaName(schema)}.evidence`;
  }

  async append(e: NewEvidence): Promise<RecordedEvidence> {
    const { rows } = await this.#sql.query<EvidenceRow>(
      `insert into ${this.#table}
         (type, learner_id, session_id, course_id, lab_id, step_id, observed_at, recorded_at, source, confidence, retention, depth, detail)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning ${COLUMNS}`,
      [
        e.type,
        e.learnerId,
        e.sessionId,
        e.courseId,
        e.labId ?? null,
        e.stepId ?? null,
        e.observedAt,
        this.#clock.now(),
        e.source,
        e.confidence,
        e.retention,
        e.depth ?? null,
        e.detail === undefined ? null : JSON.stringify(e.detail),
      ],
    );
    return toRecord(only(rows));
  }

  async read(query: EvidenceQuery): Promise<readonly RecordedEvidence[]> {
    const { rows } = await this.#sql.query<EvidenceRow>(
      `select ${COLUMNS} from ${this.#table}
       where course_id = $1
         and ($2::text is null or learner_id = $2)
         and ($3::text is null or lab_id = $3)
         and ($4::bigint is null or sequence > $4)
       order by sequence`,
      [query.courseId, query.learnerId ?? null, query.labId ?? null, query.afterSequence ?? null],
    );
    return rows.map(toRecord);
  }

  async expire(boundary: RetentionBoundary): Promise<number> {
    const [where, value] =
      boundary.kind === 'session'
        ? [`retention = 'session' and session_id = $1`, boundary.sessionId]
        : boundary.kind === 'course'
          ? [`retention in ('session', 'course') and course_id = $1`, boundary.courseId]
          : [`learner_id = $1`, boundary.learnerId];
    const { rows } = await this.#sql.query(`delete from ${this.#table} where ${where} returning sequence`, [value]);
    return rows.length;
  }
}

function only<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (row === undefined) throw new Error('insert returned no row');
  return row;
}

function toRecord(r: EvidenceRow): RecordedEvidence {
  return {
    sequence: Number(r.sequence),
    type: r.type,
    learnerId: r.learner_id,
    sessionId: r.session_id,
    courseId: r.course_id,
    ...(r.lab_id === null ? {} : { labId: r.lab_id }),
    ...(r.step_id === null ? {} : { stepId: r.step_id }),
    observedAt: new Date(r.observed_at),
    recordedAt: new Date(r.recorded_at),
    source: r.source,
    confidence: Number(r.confidence),
    retention: r.retention,
    ...(r.depth === null ? {} : { depth: r.depth }),
    ...(r.detail === null ? {} : { detail: r.detail }),
  };
}
