import { DEFAULT_TOOL_HOST_RESILIENCE } from '@tutors-ai/adapter-resilience';
import { NO_TELEMETRY, PortError } from '@tutors-ai/core';
import { aLearner, aPolicy, aToolPolicy, FixedClock } from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import { composeTools, createPool, logResilience, logToolResilience } from '../src/compose.ts';

describe('composition root resilience', () => {
  it('bounds PostgreSQL waits and listens for idle-client errors so a database restart cannot crash the API', async () => {
    const pool = createPool({ pgUrl: 'postgres://u:p@127.0.0.1:1/x', pgConnectTimeoutMs: 1_234, pgStatementTimeoutMs: 5_000 }, 3);
    try {
      expect(pool.options).toMatchObject({ max: 3, connectionTimeoutMillis: 1_234, statement_timeout: 5_000, query_timeout: 6_000 });
      expect(pool.listenerCount('error')).toBe(1);
      // An unheard 'error' would throw here.
      expect(pool.emit('error', new Error('terminating connection due to administrator command'))).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('logs each resilience event as one JSON line', () => {
    const lines: string[] = [];
    logResilience({ type: 'circuit', from: 'closed', to: 'open' }, (line) => lines.push(line));
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ msg: 'model resilience', type: 'circuit', from: 'closed', to: 'open' }]);
  });

  it('logs each tool resilience event as one JSON line naming the server', () => {
    const lines: string[] = [];
    logToolResilience({ type: 'shed', reason: 'circuit-open', server: 'glossary' }, (line) => lines.push(line));
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ msg: 'tool resilience', type: 'shed', reason: 'circuit-open', server: 'glossary' }]);
  });
});

describe('composition root tools', () => {
  /** Answers every insert by echoing its parameters back as the stored row. */
  function recordingSql() {
    const queries: { text: string; params: readonly unknown[] }[] = [];
    return {
      queries,
      async query<R extends object>(text: string, params: readonly unknown[] = []): Promise<{ rows: R[] }> {
        queries.push({ text, params });
        const [learner_id, session_id, course_id, policy_id, policy_version, server, tool, digest, outcome, reason, is_error, argument_chars, result_chars, elapsed_ms, called_at, source] = params;
        const row = { sequence: '1', learner_id, session_id, course_id, policy_id, policy_version, server, tool, digest, outcome, reason, is_error, argument_chars, result_chars, elapsed_ms, called_at, source };
        return { rows: [row as R] };
      },
    };
  }

  const config = { toolServers: { glossary: { url: 'http://127.0.0.1:1/mcp' } }, toolResilience: { ...DEFAULT_TOOL_HOST_RESILIENCE, circuit: { failureThreshold: 1, resetAfterMs: 60_000 } }, pgSchema: 'tenant_a' };

  it('audits every call in PostgreSQL, under the configured schema and source', async () => {
    const sql = recordingSql();
    const tools = composeTools(config, { sql, clock: new FixedClock(), telemetry: NO_TELEMETRY, source: 'inference-api' });
    try {
      expect(tools.servers).toEqual(['glossary']);
      const session = await tools.harness.open({ learner: aLearner(), policy: { ...aPolicy(), tools: aToolPolicy() } });
      expect(await session.call({ server: 'glossary', name: 'define', arguments: {} })).toMatchObject({ kind: 'refused', reason: 'not-granted' });
      expect(sql.queries).toHaveLength(1);
      expect(sql.queries[0]?.text).toMatch(/insert into "?tenant_a"?\.tool_calls/);
      expect(sql.queries[0]?.params.at(-1)).toBe('inference-api');
    } finally {
      await tools.close();
    }
  });

  it('puts each configured server behind its own circuit, and an unknown server is unavailable', async () => {
    const tools = composeTools(config, { sql: recordingSql(), clock: new FixedClock(), telemetry: NO_TELEMETRY, source: 'inference-api' });
    try {
      const listing = await tools.host.listTools('glossary', 2_000).catch((error: unknown) => error);
      expect(PortError.is(listing) && listing.kind).toBe('unavailable');
      expect(tools.host.circuit('glossary')).toBe('open');
      const unknown = await tools.host.listTools('elsewhere', 2_000).catch((error: unknown) => error);
      expect(PortError.is(unknown) && unknown.message).toMatch(/not configured/);
    } finally {
      await tools.close();
    }
  });
});
