import type { McpServerConfig } from '@tutors-ai/adapter-mcp';
import type { ResilienceOptions, ToolHostResilienceOptions } from '@tutors-ai/adapter-resilience';

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
  /** MCP tool servers by the name grants use for them; none when MCP_SERVERS is unset (ADR 0008). */
  readonly toolServers: Readonly<Record<string, McpServerConfig>>;
  /** Circuit breaker and bulkhead around each tool server. */
  readonly toolResilience: ToolHostResilienceOptions;
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

const SERVER_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const TOKEN_PREFIX = 'MCP_TOKEN_';

/** The variable that holds a server's bearer token: MCP_TOKEN_ and the name in capitals, dashes as underscores. */
export const tokenVariable = (server: string): string => TOKEN_PREFIX + server.toUpperCase().replaceAll('-', '_');

/**
 * MCP_SERVERS is a JSON object of server name to Streamable HTTP URL. A
 * server's token comes from its own variable, mounted from a Secret, and is
 * sent as a bearer token; it never sits in the URL or in MCP_SERVERS.
 */
function toolServers(env: Env): Record<string, McpServerConfig> {
  const raw = env['MCP_SERVERS']?.trim();
  let listed: unknown = {};
  if (raw !== undefined && raw !== '') {
    try {
      listed = JSON.parse(raw);
    } catch {
      throw new ConfigError('MCP_SERVERS must be JSON');
    }
  }
  if (typeof listed !== 'object' || listed === null || Array.isArray(listed)) {
    throw new ConfigError('MCP_SERVERS must be a JSON object of server name to URL');
  }
  const servers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(listed)) {
    if (!SERVER_NAME.test(name)) throw new ConfigError(`MCP_SERVERS: "${name}" is not a server name (lower case letters, digits and dashes)`);
    const parsed = typeof value === 'string' && URL.canParse(value) ? new URL(value) : undefined;
    if (parsed === undefined || !['http:', 'https:'].includes(parsed.protocol)) throw new ConfigError(`MCP_SERVERS: ${name} must be an http or https URL`);
    if (parsed.username !== '' || parsed.password !== '') throw new ConfigError(`MCP_SERVERS: ${name} has credentials in its URL; put a token in ${tokenVariable(name)}`);
    const token = env[tokenVariable(name)]?.trim();
    servers[name] = token === undefined || token === '' ? { url: parsed.href } : { url: parsed.href, headers: { authorization: `Bearer ${token}` } };
  }
  // A token for a server that is not listed is a typo that would otherwise go unnoticed.
  const known = new Set(Object.keys(servers).map(tokenVariable));
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(TOKEN_PREFIX) && !known.has(key) && value?.trim()) throw new ConfigError(`${key} names no server in MCP_SERVERS`);
  }
  return servers;
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
    toolServers: toolServers(env),
    toolResilience: {
      circuit: {
        failureThreshold: integer(env, 'TOOL_CIRCUIT_FAILURES', 3, 1),
        resetAfterMs: integer(env, 'TOOL_CIRCUIT_RESET_MS', 30_000, 1),
      },
      bulkhead: { maxConcurrent: integer(env, 'TOOL_MAX_CONCURRENT', 4, 1), maxQueued: integer(env, 'TOOL_MAX_QUEUED', 16, 0) },
    },
  };
}
