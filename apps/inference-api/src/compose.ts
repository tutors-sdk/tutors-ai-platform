import { CourseExportContent, loadCourseExports } from '@tutors-ai/adapter-course-content';
import { OllamaLanguageModel } from '@tutors-ai/adapter-ollama';
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

/** The composition root: the only place that knows which adapter serves which port. */
export async function compose(config: Config): Promise<Composed> {
  const pool = new pg.Pool({ connectionString: config.pgUrl, max: 10 });
  try {
    await migrate(pool, config.pgSchema);
    const otel = config.otelEndpoint === undefined ? undefined : startOtel({ endpoint: config.otelEndpoint, serviceName: 'tutors-ai-inference-api' });
    const clock = new SystemClock();
    const evidence = new PostgresEvidenceStore(pool, clock, config.pgSchema);
    const memory = new PostgresLearnerMemory(pool, config.pgSchema);
    const assist = new AssistStudentService({
      policies: new ContractPolicyProvider(),
      content: new CourseExportContent(await loadCourseExports(config.courseExportDir)),
      model: new OllamaLanguageModel(config.ollama),
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
