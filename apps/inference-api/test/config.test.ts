import { describe, expect, it } from 'vitest';
import { DEFAULT_RESILIENCE } from '@tutors-ai/adapter-resilience';
import { ConfigError, readConfig } from '../src/config.ts';

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
});
