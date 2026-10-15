import type { LearnerContext, LearnerMemory, MemoryEntry, MemoryScope, MemoryWrite, RetentionBoundary } from '@tutors-ai/core';
import { schemaName, type SqlClient } from './sql.ts';

interface MemoryRow {
  learner_id: string;
  session_id: string;
  course_id: string;
  programme_id: string | null;
  sharing: MemoryEntry['sharing'];
  retention: MemoryEntry['retention'];
  recorded_at: Date;
  question: string;
  answer: string;
}

/**
 * LearnerMemory over PostgreSQL. The visibility rule (docs/adr/0004) is a
 * single WHERE clause, so no entry outside the scope ever leaves the database.
 */
export class PostgresLearnerMemory implements LearnerMemory {
  readonly #sql: SqlClient;
  readonly #table: string;

  constructor(sql: SqlClient, schema = 'public') {
    this.#sql = sql;
    this.#table = `${schemaName(schema)}.learner_memory`;
  }

  async recall(learner: LearnerContext, scope: MemoryScope, limit: number): Promise<readonly MemoryEntry[]> {
    if (scope.kind === 'none' || limit <= 0) return [];
    // $1 learner, $2 session, $3 course, $4 programme, $5 scope kind, $6 reader shares with cohort, $7 limit
    const { rows } = await this.#sql.query<MemoryRow>(
      `select learner_id, session_id, course_id, programme_id, sharing, retention, recorded_at, question, answer
       from (
         select * from ${this.#table}
         where (
             learner_id = $1 and (
                  ($5::text = 'session' and session_id = $2)
               or ($5::text = 'course' and course_id = $3)
               or ($5::text = 'programme' and $4::text is null and course_id = $3)
               or ($5::text = 'programme' and programme_id = $4)
             )
           )
           or ($6::boolean and learner_id <> $1 and sharing = 'cohort' and course_id = $3)
         order by id desc
         limit $7::int
       ) recent
       order by id`,
      [
        learner.learnerId,
        learner.sessionId,
        learner.courseId,
        learner.programmeId ?? null,
        scope.kind,
        scope.sharing === 'cohort',
        limit,
      ],
    );
    return rows.map((r) => ({
      learnerId: r.learner_id,
      sessionId: r.session_id,
      courseId: r.course_id,
      ...(r.programme_id === null ? {} : { programmeId: r.programme_id }),
      sharing: r.sharing,
      retention: r.retention,
      recordedAt: new Date(r.recorded_at),
      question: r.question,
      answer: r.answer,
    }));
  }

  async remember(learner: LearnerContext, scope: MemoryScope, entry: MemoryWrite): Promise<void> {
    if (scope.kind === 'none') return;
    await this.#sql.query(
      `insert into ${this.#table} (learner_id, session_id, course_id, programme_id, sharing, retention, recorded_at, question, answer)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        learner.learnerId,
        learner.sessionId,
        learner.courseId,
        learner.programmeId ?? null,
        scope.sharing,
        scope.kind,
        entry.recordedAt,
        entry.question,
        entry.answer,
      ],
    );
  }

  async expire(boundary: RetentionBoundary): Promise<number> {
    const [where, id] =
      boundary.kind === 'session'
        ? [`retention = 'session' and session_id = $1`, boundary.sessionId]
        : boundary.kind === 'course'
          ? [`retention in ('session', 'course') and course_id = $1`, boundary.courseId]
          : [`learner_id = $1`, boundary.learnerId];
    const { rows } = await this.#sql.query(`delete from ${this.#table} where ${where} returning id`, [id]);
    return rows.length;
  }
}
