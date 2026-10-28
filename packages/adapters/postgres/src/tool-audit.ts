import type { RecordedToolCall, ToolAudit, ToolCallQuery, ToolCallRecord } from '@tutors-ai/core';
import { schemaName, type SqlClient } from './sql.ts';

interface ToolCallRow {
  sequence: string;
  learner_id: string;
  session_id: string;
  course_id: string;
  policy_id: string;
  policy_version: string;
  server: string;
  tool: string;
  digest: string | null;
  outcome: ToolCallRecord['outcome'];
  reason: NonNullable<ToolCallRecord['reason']> | null;
  is_error: boolean | null;
  argument_chars: number;
  result_chars: number;
  elapsed_ms: number;
  called_at: Date;
  source: string;
}

const COLUMNS =
  'sequence, learner_id, session_id, course_id, policy_id, policy_version, server, tool, digest, outcome, reason, is_error, argument_chars, result_chars, elapsed_ms, called_at, source';

/**
 * ToolAudit over PostgreSQL (docs/adr/0008). Only the record's own fields
 * have columns, so nothing else handed to append can be stored (TA-005);
 * append-only is enforced by a trigger as well as by the API.
 */
export class PostgresToolAudit implements ToolAudit {
  readonly #sql: SqlClient;
  readonly #table: string;

  constructor(sql: SqlClient, schema = 'public') {
    this.#sql = sql;
    this.#table = `${schemaName(schema)}.tool_calls`;
  }

  async append(r: ToolCallRecord): Promise<RecordedToolCall> {
    const { rows } = await this.#sql.query<ToolCallRow>(
      `insert into ${this.#table}
         (learner_id, session_id, course_id, policy_id, policy_version, server, tool, digest, outcome, reason, is_error,
          argument_chars, result_chars, elapsed_ms, called_at, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       returning ${COLUMNS}`,
      [
        r.learnerId,
        r.sessionId,
        r.courseId,
        r.policyId,
        r.policyVersion,
        r.server,
        r.tool,
        r.digest ?? null,
        r.outcome,
        r.reason ?? null,
        r.isError ?? null,
        r.argumentChars,
        r.resultChars,
        Math.round(r.elapsedMs),
        r.calledAt,
        r.source,
      ],
    );
    const [row] = rows;
    if (row === undefined) throw new Error('insert returned no row');
    return toRecord(row);
  }

  async read(query: ToolCallQuery): Promise<readonly RecordedToolCall[]> {
    const { rows } = await this.#sql.query<ToolCallRow>(
      `select ${COLUMNS} from ${this.#table}
       where course_id = $1
         and ($2::text is null or learner_id = $2)
         and ($3::bigint is null or sequence > $3)
       order by sequence`,
      [query.courseId, query.learnerId ?? null, query.afterSequence ?? null],
    );
    return rows.map(toRecord);
  }
}

function toRecord(r: ToolCallRow): RecordedToolCall {
  return {
    sequence: Number(r.sequence),
    learnerId: r.learner_id,
    sessionId: r.session_id,
    courseId: r.course_id,
    policyId: r.policy_id,
    policyVersion: r.policy_version,
    server: r.server,
    tool: r.tool,
    ...(r.digest === null ? {} : { digest: r.digest }),
    outcome: r.outcome,
    ...(r.reason === null ? {} : { reason: r.reason }),
    ...(r.is_error === null ? {} : { isError: r.is_error }),
    argumentChars: r.argument_chars,
    resultChars: r.result_chars,
    elapsedMs: r.elapsed_ms,
    calledAt: new Date(r.called_at),
    source: r.source,
  };
}
