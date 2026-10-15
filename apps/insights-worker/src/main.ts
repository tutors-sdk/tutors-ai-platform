import { loadCourseExports } from '@tutors-ai/adapter-course-content';
import { migrate, PostgresEvidenceStore, PostgresInsightStore } from '@tutors-ai/adapter-postgres';
import { SystemClock } from '@tutors-ai/adapter-system';
import pg from 'pg';
import { readConfig } from './config.ts';
import { runInsights } from './run.ts';

const config = readConfig(process.env);
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));
const pool = new pg.Pool({ connectionString: config.pgUrl, max: 2 });
try {
  await migrate(pool, config.pgSchema);
  const courseIds = config.courseIds ?? (await loadCourseExports(config.courseExportDir)).map((c) => c.id);
  const clock = new SystemClock();
  const result = await runInsights(courseIds, {
    evidence: new PostgresEvidenceStore(pool, clock, config.pgSchema),
    store: new PostgresInsightStore(pool, config.pgSchema),
    clock,
    thresholds: config.thresholds,
    log,
  });
  log({ msg: 'insights run finished', ...result });
  process.exitCode = result.failed === 0 ? 0 : 1;
} finally {
  await pool.end();
}
