import { loadCourseExports } from '@tutors-ai/adapter-course-content';
import { startOtel } from '@tutors-ai/adapter-otel';
import { migrate, PostgresEvidenceStore, PostgresInsightStore } from '@tutors-ai/adapter-postgres';
import { SystemClock } from '@tutors-ai/adapter-system';
import pg from 'pg';
import { readConfig } from './config.ts';
import { runInsights } from './run.ts';

const config = readConfig(process.env);
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify(entry));
// Bounded connection wait, and an 'error' listener: an idle client that loses its server emits
// 'error', and an unheard 'error' crashes the process.
const pool = new pg.Pool({ connectionString: config.pgUrl, max: 2, connectionTimeoutMillis: 5_000 });
pool.on('error', (error) => log({ msg: 'idle PostgreSQL client failed', error: error.message }));
const otel = config.otelEndpoint === undefined ? undefined : startOtel({ endpoint: config.otelEndpoint, serviceName: 'tutors-ai-insights-worker' });
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
    ...(otel === undefined ? {} : { telemetry: otel.telemetry }),
  });
  log({ msg: 'insights run finished', ...result });
  process.exitCode = result.failed === 0 ? 0 : 1;
} finally {
  // A batch job exits when it is done, so flush telemetry before it does.
  await otel?.shutdown();
  await pool.end();
}
