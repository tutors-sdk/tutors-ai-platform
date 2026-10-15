import type { InsightRun, InsightStore } from '@tutors-ai/core';
import { schemaName, type SqlClient } from './sql.ts';

interface RunRow {
  course_id: string;
  produced_at: Date;
  insights: InsightRun['insights'];
  recommendations: InsightRun['recommendations'];
}

/** InsightStore over PostgreSQL: each run is one row, its insights kept as JSON. */
export class PostgresInsightStore implements InsightStore {
  readonly #sql: SqlClient;
  readonly #table: string;

  constructor(sql: SqlClient, schema = 'public') {
    this.#sql = sql;
    this.#table = `${schemaName(schema)}.insight_runs`;
  }

  async save(run: InsightRun): Promise<void> {
    await this.#sql.query(`insert into ${this.#table} (course_id, produced_at, insights, recommendations) values ($1, $2, $3::jsonb, $4::jsonb)`, [
      run.courseId,
      run.producedAt,
      JSON.stringify(run.insights),
      JSON.stringify(run.recommendations),
    ]);
  }

  async latest(courseId: string): Promise<InsightRun | null> {
    const { rows } = await this.#sql.query<RunRow>(
      `select course_id, produced_at, insights, recommendations from ${this.#table}
       where course_id = $1 order by produced_at desc, id desc limit 1`,
      [courseId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return { courseId: row.course_id, producedAt: new Date(row.produced_at), insights: row.insights, recommendations: row.recommendations };
  }
}
