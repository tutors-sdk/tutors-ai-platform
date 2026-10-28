import { describe, expect, it } from 'vitest';
import { DEFAULT_RESILIENCE, DEFAULT_TOOL_HOST_RESILIENCE } from '@tutors-ai/adapter-resilience';
import { ConfigError, readConfig, tokenVariable } from '../src/config.ts';

const env = {
  OLLAMA_URL: 'http://ollama:11434',
  OLLAMA_MODEL: 'qwen2.5:0.5b',
  OLLAMA_DIGEST: 'a'.repeat(64),
  PG_URL: 'postgres://u:p@db:5432/tutors',
  COURSE_EXPORT_DIR: '/data/courses',
};

describe('readConfig', () => {
  it('reads the required settings and defaults the rest', () => {
    expect(readConfig(env)).toEqual({
      port: 8080,
      ollama: { baseUrl: 'http://ollama:11434', model: 'qwen2.5:0.5b', digest: 'a'.repeat(64) },
      pgUrl: 'postgres://u:p@db:5432/tutors',
      pgSchema: 'public',
      pgConnectTimeoutMs: 5_000,
      pgStatementTimeoutMs: 10_000,
      courseExportDir: '/data/courses',
      otelEndpoint: undefined,
      evidenceSource: 'inference-api',
      modelTimeoutMs: 30_000,
      modelResilience: DEFAULT_RESILIENCE,
      memoryRecallLimit: 6,
      maxClockSkewMs: 60_000,
      toolServers: {},
      toolResilience: DEFAULT_TOOL_HOST_RESILIENCE,
    });
    expect(readConfig({ ...env, PORT: '9000', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318', MODEL_TIMEOUT_MS: '5000' })).toMatchObject({
      port: 9000,
      otelEndpoint: 'http://otel:4318',
      modelTimeoutMs: 5000,
    });
  });

  it('reads the model resilience and database timeouts', () => {
    const config = readConfig({
      ...env,
      MODEL_CIRCUIT_FAILURES: '2',
      MODEL_CIRCUIT_RESET_MS: '1500',
      MODEL_RETRIES: '0',
      MODEL_RETRY_BASE_MS: '50',
      MODEL_RETRY_MAX_MS: '400',
      MODEL_MAX_CONCURRENT: '1',
      MODEL_MAX_QUEUED: '0',
      PG_CONNECT_TIMEOUT_MS: '2000',
      PG_STATEMENT_TIMEOUT_MS: '3000',
    });
    expect(config.modelResilience).toEqual({
      circuit: { failureThreshold: 2, resetAfterMs: 1_500 },
      retries: 0,
      backoff: { baseMs: 50, maxMs: 400 },
      bulkhead: { maxConcurrent: 1, maxQueued: 0 },
    });
    expect([config.pgConnectTimeoutMs, config.pgStatementTimeoutMs]).toEqual([2_000, 3_000]);
    expect(() => readConfig({ ...env, MODEL_CIRCUIT_FAILURES: '0' })).toThrow('MODEL_CIRCUIT_FAILURES');
    expect(() => readConfig({ ...env, MODEL_MAX_CONCURRENT: '0' })).toThrow('MODEL_MAX_CONCURRENT');
    expect(() => readConfig({ ...env, MODEL_RETRIES: '-1' })).toThrow('MODEL_RETRIES');
  });

  it('fails fast on missing or malformed settings', () => {
    expect(() => readConfig({ ...env, PG_URL: undefined })).toThrow(new ConfigError('PG_URL is required'));
    expect(() => readConfig({ ...env, OLLAMA_URL: 'not a url' })).toThrow('OLLAMA_URL must be a URL');
    expect(() => readConfig({ ...env, OLLAMA_DIGEST: 'latest' })).toThrow('pinned');
    expect(() => readConfig({ ...env, MODEL_TIMEOUT_MS: '0' })).toThrow('MODEL_TIMEOUT_MS');
    expect(() => readConfig({ ...env, PORT: 'eighty' })).toThrow('PORT');
  });

  it('reads tool servers, each with its own token from its own variable, and their resilience', () => {
    const config = readConfig({
      ...env,
      MCP_SERVERS: '{"glossary": "http://glossary:8080/mcp", "course-docs": "https://docs.example.org/mcp"}',
      MCP_TOKEN_COURSE_DOCS: ' s3cret ',
      TOOL_CIRCUIT_FAILURES: '2',
      TOOL_CIRCUIT_RESET_MS: '5000',
      TOOL_MAX_CONCURRENT: '1',
      TOOL_MAX_QUEUED: '0',
    });
    expect(config.toolServers).toEqual({
      glossary: { url: 'http://glossary:8080/mcp' },
      'course-docs': { url: 'https://docs.example.org/mcp', headers: { authorization: 'Bearer s3cret' } },
    });
    expect(config.toolResilience).toEqual({ circuit: { failureThreshold: 2, resetAfterMs: 5_000 }, bulkhead: { maxConcurrent: 1, maxQueued: 0 } });
    expect(tokenVariable('course-docs')).toBe('MCP_TOKEN_COURSE_DOCS');
    expect(readConfig({ ...env, MCP_SERVERS: ' ', MCP_TOKEN_GLOSSARY: '' }).toolServers).toEqual({});
  });

  it('fails fast on a tool server it cannot use safely', () => {
    const servers = (value: string, extra: Record<string, string> = {}) => () => readConfig({ ...env, MCP_SERVERS: value, ...extra });
    expect(servers('{')).toThrow(new ConfigError('MCP_SERVERS must be JSON'));
    expect(servers('["http://a"]')).toThrow('MCP_SERVERS must be a JSON object of server name to URL');
    expect(servers('null')).toThrow('MCP_SERVERS must be a JSON object');
    expect(servers('"http://a"')).toThrow('MCP_SERVERS must be a JSON object');
    expect(servers('{"Glossary": "http://a"}')).toThrow('MCP_SERVERS: "Glossary" is not a server name');
    expect(servers('{"glossary": 8080}')).toThrow('MCP_SERVERS: glossary must be an http or https URL');
    expect(servers('{"glossary": "not a url"}')).toThrow('MCP_SERVERS: glossary must be an http or https URL');
    expect(servers('{"glossary": "file:///etc/passwd"}')).toThrow('MCP_SERVERS: glossary must be an http or https URL');
    expect(servers('{"glossary": "https://user:pw@a/mcp"}')).toThrow('MCP_SERVERS: glossary has credentials in its URL; put a token in MCP_TOKEN_GLOSSARY');
    expect(servers('{"glossary": "https://user@a/mcp"}')).toThrow('credentials');
    expect(servers('{"glossary": "http://a"}', { MCP_TOKEN_GLOSARY: 'x' })).toThrow(new ConfigError('MCP_TOKEN_GLOSARY names no server in MCP_SERVERS'));
    expect(() => readConfig({ ...env, MCP_TOKEN_GLOSSARY: 'x' })).toThrow('MCP_TOKEN_GLOSSARY names no server');
    expect(() => readConfig({ ...env, TOOL_CIRCUIT_FAILURES: '0' })).toThrow('TOOL_CIRCUIT_FAILURES');
    expect(() => readConfig({ ...env, TOOL_MAX_CONCURRENT: '0' })).toThrow('TOOL_MAX_CONCURRENT');
  });
});
