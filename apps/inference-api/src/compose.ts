import { CourseExportContent, loadCourseExports } from '@tutors-ai/adapter-course-content';
import { OllamaLanguageModel } from '@tutors-ai/adapter-ollama';
import { ResilientLanguageModel, type ResilienceEvent } from '@tutors-ai/adapter-resilience';
import { startOtel } from '@tutors-ai/adapter-otel';
import { migrate, PostgresEvidenceStore, PostgresInsightStore, PostgresLearnerMemory } from '@tutors-ai/adapter-postgres';
import { SystemClock } from '@tutors-ai/adapter-system';
import { ContractPolicyProvider } from '@tutors-ai/contract';
import { ApplyRetentionService, AssistStudentService, NO_TELEMETRY, RecordEvidenceService } from '@tutors-ai/core';
import pg from 'pg';
import type { Config } from './config.ts';
import type { Services } from './http.ts';

export interface Composed {
  readonly services: Services;
  close(): Promise<void>;
}

/** One JSON line per resilience event, so the circuit's state shows in the pod log. */
export function logResilience(event: ResilienceEvent, log: (line: string) => void = console.log): void {
  log(JSON.stringify({ msg: 'model resilience', ...event }));
}

/**
 * A pool that cannot hang the request path or take the process down: bounded
 * waits for a connection and for each statement, and an error listener, since
 * an idle client that loses its server emits 'error' and an unheard 'error'
 * crashes Node.
 */
export function createPool(config: Pick<Config, 'pgUrl' | 'pgConnectTimeoutMs' | 'pgStatementTimeoutMs'>, max: number): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.pgUrl,
    max,
    connectionTimeoutMillis: config.pgConnectTimeoutMs,
    statement_timeout: config.pgStatementTimeoutMs,
    query_timeout: config.pgStatementTimeoutMs + 1_000,
  });
  pool.on('error', (error) => console.error(JSON.stringify({ msg: 'idle PostgreSQL client failed', error: error.message })));
  return pool;
}

/** The composition root: the only place that knows which adapter serves which port. */
export async function compose(config: Config): Promise<Composed> {
  const pool = createPool(config, 10);
  try {
    await migrate(pool, config.pgSchema);
    const otel = config.otelEndpoint === undefined ? undefined : startOtel({ endpoint: config.otelEndpoint, serviceName: 'tutors-ai-inference-api' });
    const clock = new SystemClock();
    const evidence = new PostgresEvidenceStore(pool, clock, config.pgSchema);
    const memory = new PostgresLearnerMemory(pool, config.pgSchema);
    const assist = new AssistStudentService({
      policies: new ContractPolicyProvider(),
      content: new CourseExportContent(await loadCourseExports(config.courseExportDir)),
      model: new ResilientLanguageModel(new OllamaLanguageModel(config.ollama), config.modelResilience, { observe: (e) => logResilience(e) }),
      memory,
      evidence,
      clock,
      telemetry: otel?.telemetry ?? NO_TELEMETRY,
      config: { source: config.evidenceSource, modelTimeoutMs: config.modelTimeoutMs, memoryRecallLimit: config.memoryRecallLimit },
    });
    return {
      services: {
        assist,
        evidence: new RecordEvidenceService({ evidence, clock, maxClockSkewMs: config.maxClockSkewMs }),
        retention: new ApplyRetentionService({ evidence, memory }),
        insights: new PostgresInsightStore(pool, config.pgSchema),
        ready: async () => {
          await pool.query('select 1');
          return true;
        },
      },
      close: async () => {
        await otel?.shutdown();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
