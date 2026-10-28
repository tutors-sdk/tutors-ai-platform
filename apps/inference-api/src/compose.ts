import { CourseExportContent, loadCourseExports } from '@tutors-ai/adapter-course-content';
import { McpToolHost } from '@tutors-ai/adapter-mcp';
import { OllamaLanguageModel } from '@tutors-ai/adapter-ollama';
import { ResilientLanguageModel, ResilientToolHost, type ResilienceEvent, type ToolHostResilienceEvent } from '@tutors-ai/adapter-resilience';
import { startOtel } from '@tutors-ai/adapter-otel';
import { migrate, PostgresEvidenceStore, PostgresInsightStore, PostgresLearnerMemory, PostgresToolAudit, type SqlClient } from '@tutors-ai/adapter-postgres';
import { SystemClock } from '@tutors-ai/adapter-system';
import { ContractPolicyProvider } from '@tutors-ai/contract';
import { ApplyRetentionService, AssistStudentService, NO_TELEMETRY, RecordEvidenceService, ToolHarness, type Clock, type Telemetry } from '@tutors-ai/core';
import pg from 'pg';
import type { Config } from './config.ts';
import type { Services } from './http.ts';

export interface Composed {
  readonly services: Services;
  /** Composed now so its configuration and audit are proven; AssistStudent takes it with the first tool. */
  readonly tools: ComposedTools;
  close(): Promise<void>;
}

export interface ComposedTools {
  readonly harness: ToolHarness;
  /** The resilient host, whose circuits show each server's state. */
  readonly host: ResilientToolHost;
  /** The configured server names. */
  readonly servers: readonly string[];
  close(): Promise<void>;
}

/** One JSON line per resilience event, so the circuit's state shows in the pod log. */
export function logResilience(event: ResilienceEvent, log: (line: string) => void = console.log): void {
  log(JSON.stringify({ msg: 'model resilience', ...event }));
}

/** One JSON line per tool server resilience event, naming the server. */
export function logToolResilience(event: ToolHostResilienceEvent, log: (line: string) => void = console.log): void {
  log(JSON.stringify({ msg: 'tool resilience', ...event }));
}

/**
 * Tools reach a model only through the harness (docs/adr/0008): MCP behind a
 * circuit breaker and bulkhead per server, and every call audited in
 * PostgreSQL. There is no way to compose it with an audit that does not last.
 */
export function composeTools(
  config: Pick<Config, 'toolServers' | 'toolResilience' | 'pgSchema'>,
  deps: { readonly sql: SqlClient; readonly clock: Clock; readonly telemetry: Telemetry; readonly source: string },
): ComposedTools {
  const mcp = new McpToolHost({ servers: config.toolServers }, deps.clock);
  const host = new ResilientToolHost(mcp, config.toolResilience, { observe: (e) => logToolResilience(e) });
  return {
    harness: new ToolHarness({ host, audit: new PostgresToolAudit(deps.sql, config.pgSchema), clock: deps.clock, telemetry: deps.telemetry, source: deps.source }),
    host,
    servers: Object.keys(config.toolServers),
    close: () => mcp.close(),
  };
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
    const telemetry = otel?.telemetry ?? NO_TELEMETRY;
    const tools = composeTools(config, { sql: pool, clock, telemetry, source: config.evidenceSource });
    const assist = new AssistStudentService({
      policies: new ContractPolicyProvider(),
      content: new CourseExportContent(await loadCourseExports(config.courseExportDir)),
      model: new ResilientLanguageModel(new OllamaLanguageModel(config.ollama), config.modelResilience, { observe: (e) => logResilience(e) }),
      memory,
      evidence,
      clock,
      telemetry,
      config: { source: config.evidenceSource, modelTimeoutMs: config.modelTimeoutMs, memoryRecallLimit: config.memoryRecallLimit },
    });
    return {
      tools,
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
        await tools.close();
        await otel?.shutdown();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
