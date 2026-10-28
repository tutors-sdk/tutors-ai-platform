import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { migrate, PostgresToolAudit } from '@tutors-ai/adapter-postgres';
import { DEFAULT_TOOL_HOST_RESILIENCE } from '@tutors-ai/adapter-resilience';
import { SystemClock } from '@tutors-ai/adapter-system';
import { createStubServer } from '@tutors-ai/app-tool-stub';
import { NO_TELEMETRY } from '@tutors-ai/core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeTools, type ComposedTools } from '../src/compose.ts';
import { CHECK_LEARNER, runToolsCommand } from '../src/tools.ts';

const { PG_URL } = process.env;
const schema = `inference_api_tools_${process.pid}`;

// The tool path as composed for the API, over a real MCP server and PostgreSQL: what the compose
// end-to-end check runs in containers, here without them.
describe.skipIf(PG_URL === undefined || PG_URL === '')('the composed tool path against PostgreSQL and an MCP server', () => {
  let pool: pg.Pool;
  let stub: Server;
  let tools: ComposedTools;
  const clock = new SystemClock();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: PG_URL });
    await migrate(pool, schema);
    stub = createStubServer({ token: 'it-token' });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/mcp`;
    tools = composeTools(
      {
        toolServers: { stub: { url, headers: { authorization: 'Bearer it-token' } }, gone: { url: 'http://127.0.0.1:1/mcp' } },
        toolResilience: DEFAULT_TOOL_HOST_RESILIENCE,
        pgSchema: schema,
      },
      { sql: pool, clock, telemetry: NO_TELEMETRY, source: 'tools-it' },
    );
  });

  afterAll(async () => {
    await tools?.close();
    stub?.closeAllConnections();
    await new Promise((resolve) => stub?.close(resolve));
    await pool?.query(`drop schema if exists "${schema}" cascade`);
    await pool?.end();
  });

  const run = async (...argv: string[]) => {
    const lines: string[] = [];
    const code = await runToolsCommand(argv, { harness: tools.harness, host: tools.host, clock, out: (l) => lines.push(l), timeoutMs: 5_000 });
    return { code, printed: lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
  };

  it('calls a tool through the harness and keeps the audit record in PostgreSQL', async () => {
    const { code, printed } = await run('check', 'stub', 'glossary_lookup', '{"term":"loop"}');
    expect(code).toBe(0);
    expect(printed[0]?.['outcome']).toMatchObject({ kind: 'result', isError: false, text: expect.stringMatching(/^loop: /) });
    const audit = await new PostgresToolAudit(pool, schema).read({ courseId: CHECK_LEARNER });
    expect(audit).toEqual([expect.objectContaining({ server: 'stub', tool: 'glossary_lookup', outcome: 'result', isError: false, source: 'tools-it', digest: printed[0]?.['digest'] })]);
  });

  it('never calls a tool that is not read-only, and survives a server that is not there', async () => {
    expect(await run('check', 'stub', 'record_grade', '{"learner":"x","grade":1}')).toEqual({ code: 1, printed: [{ server: 'stub', tool: 'record_grade', excluded: ['not-read-only'] }] });
    const gone = await run('list', 'gone');
    expect(gone.code).toBe(1);
    expect(gone.printed[0]).toMatchObject({ server: 'gone', error: 'unavailable' });
    expect(await new PostgresToolAudit(pool, schema).read({ courseId: CHECK_LEARNER })).toHaveLength(1);
  });
});
