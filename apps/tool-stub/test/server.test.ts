import type { AddressInfo } from 'node:net';
import { McpToolHost } from '@tutors-ai/adapter-mcp';
import { SystemClock } from '@tutors-ai/adapter-system';
import { PortError, unsupportedSchema } from '@tutors-ai/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStubServer } from '../src/server.ts';

// The stub's own check: what CI's end-to-end run relies on, through the real MCP adapter.
describe('the tool stub', () => {
  const http = createStubServer({ token: 'stub-token' });
  let base = '';

  beforeAll(async () => {
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  });

  const host = (token = 'stub-token') => new McpToolHost({ servers: { stub: { url: `${base}/mcp`, headers: { authorization: `Bearer ${token}` } } } }, new SystemClock());

  it('lists a read-only lookup the harness can enforce, and a tool it must exclude', async () => {
    const tools = host();
    try {
      const listed = await tools.listTools('stub', 5_000);
      expect(listed.map((t) => [t.name, t.readOnly])).toEqual([
        ['glossary_lookup', true],
        ['record_grade', false],
      ]);
      expect(unsupportedSchema(listed[0]?.inputSchema)).toBeNull();
      expect(listed[0]?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      await tools.close();
    }
  });

  it('answers a known term, and reports an unknown one as a tool error', async () => {
    const tools = host();
    try {
      expect(await tools.callTool({ server: 'stub', name: 'glossary_lookup', arguments: { term: ' Loop ' }, timeoutMs: 5_000 })).toEqual({
        text: 'loop: A statement that runs its body again while its condition holds.',
        isError: false,
        omittedParts: 0,
      });
      expect(await tools.callTool({ server: 'stub', name: 'glossary_lookup', arguments: { term: 'toString' }, timeoutMs: 5_000 })).toMatchObject({ isError: true });
      await expect(tools.callTool({ server: 'stub', name: 'nothing', arguments: {}, timeoutMs: 5_000 })).rejects.toMatchObject({ kind: 'rejected' });
    } finally {
      await tools.close();
    }
  });

  it('refuses a request without its token', async () => {
    const tools = host('wrong');
    try {
      const error = await tools.listTools('stub', 5_000).catch((e: unknown) => e);
      expect(PortError.is(error) && error.kind).toBe('rejected');
      expect((error as Error).message).toMatch(/HTTP 401/);
    } finally {
      await tools.close();
    }
  });

  it('answers its health check and nothing else outside /mcp', async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });
});
