import { describe, expect, it } from 'vitest';
import { createPool, logResilience } from '../src/compose.ts';

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
});
