import type { ResilienceOptions } from '@tutors-ai/adapter-resilience';

/** Everything the composition root reads from its environment. */
export interface Config {
  readonly port: number;
  readonly ollama: { readonly baseUrl: string; readonly model: string; readonly digest: string };
  readonly pgUrl: string;
  readonly pgSchema: string;
  /** How long to wait for a PostgreSQL connection, and for any one statement. */
  readonly pgConnectTimeoutMs: number;
  readonly pgStatementTimeoutMs: number;
  readonly courseExportDir: string;
  /** OTLP/HTTP collector base URL; telemetry is off when absent. */
  readonly otelEndpoint: string | undefined;
  /** The evidence `source` stamped on what this service records. */
  readonly evidenceSource: string;
  readonly modelTimeoutMs: number;
  /** Circuit breaker, retry and bulkhead around the model (ADR 0007). */
  readonly modelResilience: ResilienceOptions;
  readonly memoryRecallLimit: number;
  readonly maxClockSkewMs: number;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (value === undefined || value === '') throw new ConfigError(`${key} is required`);
  return value;
}

function integer(env: Env, key: string, fallback: number, min: number): number {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new ConfigError(`${key} must be an integer of at least ${min}, got "${raw}"`);
  return value;
}

function url(env: Env, key: string): string {
  const value = required(env, key);
  try {
    new URL(value);
  } catch {
    throw new ConfigError(`${key} must be a URL`);
  }
  return value;
}

/** Reads and validates configuration, failing fast with every problem named. */
export function readConfig(env: Env): Config {
  const digest = required(env, 'OLLAMA_DIGEST');
  if (!/^(sha256:)?[0-9a-f]{64}$/.test(digest)) throw new ConfigError('OLLAMA_DIGEST must be a sha256 digest: the model is pinned, never floating');
  const otel = env['OTEL_EXPORTER_OTLP_ENDPOINT']?.trim();
  return {
    port: integer(env, 'PORT', 8080, 0),
    ollama: { baseUrl: url(env, 'OLLAMA_URL'), model: required(env, 'OLLAMA_MODEL'), digest },
    pgUrl: url(env, 'PG_URL'),
    pgSchema: env['PG_SCHEMA']?.trim() || 'public',
    pgConnectTimeoutMs: integer(env, 'PG_CONNECT_TIMEOUT_MS', 5_000, 1),
    pgStatementTimeoutMs: integer(env, 'PG_STATEMENT_TIMEOUT_MS', 10_000, 1),
    courseExportDir: required(env, 'COURSE_EXPORT_DIR'),
    otelEndpoint: otel === undefined || otel === '' ? undefined : otel,
    evidenceSource: env['EVIDENCE_SOURCE']?.trim() || 'inference-api',
    modelTimeoutMs: integer(env, 'MODEL_TIMEOUT_MS', 30_000, 1),
    modelResilience: {
      circuit: {
        failureThreshold: integer(env, 'MODEL_CIRCUIT_FAILURES', 5, 1),
        resetAfterMs: integer(env, 'MODEL_CIRCUIT_RESET_MS', 30_000, 1),
      },
      retries: integer(env, 'MODEL_RETRIES', 1, 0),
      backoff: { baseMs: integer(env, 'MODEL_RETRY_BASE_MS', 250, 1), maxMs: integer(env, 'MODEL_RETRY_MAX_MS', 2_000, 1) },
      bulkhead: { maxConcurrent: integer(env, 'MODEL_MAX_CONCURRENT', 4, 1), maxQueued: integer(env, 'MODEL_MAX_QUEUED', 32, 0) },
    },
    memoryRecallLimit: integer(env, 'MEMORY_RECALL_LIMIT', 6, 0),
    maxClockSkewMs: integer(env, 'MAX_CLOCK_SKEW_MS', 60_000, 0),
  };
}
