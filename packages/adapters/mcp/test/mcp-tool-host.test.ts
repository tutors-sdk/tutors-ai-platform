import type { IncomingHttpHeaders } from 'node:http';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { PortError } from '@tutors-ai/core';
import { KIT_SERVER, KIT_TOOLS } from '@tutors-ai/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { McpToolHost, toDefinition, toPortError, toResult, type McpToolHostOptions } from '../src/index.ts';
import { kitServer, startKitServer, type RunningKitServer } from './kit-server.ts';

const clock = { now: () => new Date() };
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

async function started(options: Parameters<typeof startKitServer>[0] = {}): Promise<RunningKitServer> {
  const kit = await startKitServer(options);
  cleanup.push(() => kit.close());
  return kit;
}

function host(options: Partial<McpToolHostOptions> & Pick<McpToolHostOptions, 'servers'>): McpToolHost {
  const created = new McpToolHost(options, clock);
  cleanup.push(() => created.close());
  return created;
}

async function failure(promise: Promise<unknown>): Promise<PortError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(PortError.is(error)).toBe(true);
  return error as PortError;
}

/** Connects through in-memory transports to fresh kit servers, counting connections. */
function inMemory() {
  const servers: Server[] = [];
  const serverSides: Transport[] = [];
  let failNext = false;
  const transport = (): Transport => {
    const [client, server] = InMemoryTransport.createLinkedPair();
    if (failNext) {
      failNext = false;
      client.start = () => Promise.reject(new Error('connect ECONNREFUSED'));
      return client;
    }
    const mcp = kitServer();
    servers.push(mcp);
    serverSides.push(server);
    void mcp.connect(server);
    return client;
  };
  return {
    transport,
    servers,
    serverSides,
    failNextConnection: () => void (failNext = true),
  };
}

const echo = { server: KIT_SERVER, name: 'echo', arguments: { text: 'hi' }, timeoutMs: 5_000 };

describe('toPortError', () => {
  it('TH-005 maps a request timeout to timeout', () => {
    expect(toPortError('docs', new McpError(ErrorCode.RequestTimeout, 'Request timed out'))).toMatchObject({
      port: 'ToolHost',
      kind: 'timeout',
      message: 'tool server "docs" did not answer in time',
    });
  });

  it('TH-004 maps a closed connection, a network failure, a server error status and anything unknown to unavailable', () => {
    expect(toPortError('docs', new McpError(ErrorCode.ConnectionClosed, 'closed'))).toMatchObject({ kind: 'unavailable', message: 'tool server "docs" closed the connection' });
    expect(toPortError('docs', new TypeError('fetch failed'))).toMatchObject({ kind: 'unavailable', message: 'tool server "docs" cannot be reached: fetch failed' });
    expect(toPortError('docs', new StreamableHTTPError(500, 'boom')).kind).toBe('unavailable');
    expect(toPortError('docs', new StreamableHTTPError(undefined, 'boom')).kind).toBe('unavailable');
    expect(toPortError('docs', 'thrown text')).toMatchObject({ kind: 'unavailable', message: 'tool server "docs" cannot be reached: thrown text' });
    expect(toPortError('docs', Object.assign(new Error('not HTTP'), { code: 404 })).kind).toBe('unavailable');
  });

  it.each([ErrorCode.InvalidParams, ErrorCode.MethodNotFound, ErrorCode.InvalidRequest])('TH-006 maps JSON-RPC error %i to rejected', (code) => {
    expect(toPortError('docs', new McpError(code, 'no'))).toMatchObject({ kind: 'rejected', message: `tool server "docs" refused the request: MCP error ${code}: no` });
  });

  it('TH-006 maps a client error status to rejected, from 400 to 499', () => {
    expect(toPortError('docs', new StreamableHTTPError(400, 'bad'))).toMatchObject({ kind: 'rejected', message: 'tool server "docs" refused the request with HTTP 400' });
    expect(toPortError('docs', new StreamableHTTPError(499, 'bad')).kind).toBe('rejected');
    expect(toPortError('docs', new StreamableHTTPError(399, 'odd')).kind).toBe('unavailable');
  });

  it('TH-001 maps any other JSON-RPC error and an answer outside the protocol to invalid-response', () => {
    expect(toPortError('docs', new McpError(ErrorCode.InternalError, 'bug'))).toMatchObject({
      kind: 'invalid-response',
      message: 'tool server "docs" failed the request: MCP error -32603: bug',
    });
    const zod = Object.assign(new Error('expected array'), { name: 'ZodError' });
    expect(toPortError('docs', zod)).toMatchObject({ kind: 'invalid-response', message: 'tool server "docs" answered outside the protocol: expected array' });
    expect(toPortError('docs', new SyntaxError('Unexpected end of JSON input'))).toMatchObject({
      kind: 'invalid-response',
      message: 'tool server "docs" answered outside the protocol: Unexpected end of JSON input',
    });
    expect(toPortError('docs', new StreamableHTTPError(-1, 'Unexpected content type: text/html'))).toMatchObject({
      kind: 'invalid-response',
      message: 'tool server "docs" answered outside the protocol: Streamable HTTP error: Unexpected content type: text/html',
    });
    expect(toPortError('docs', new StreamableHTTPError(99, 'odd')).kind).toBe('invalid-response');
    expect(toPortError('docs', new StreamableHTTPError(100, 'odd')).kind).toBe('unavailable');
  });

  it('TH-004 passes a port error through unchanged', () => {
    const error = new PortError('ToolHost', 'timeout', 'already mapped');
    expect(toPortError('docs', error)).toBe(error);
  });
});

describe('toResult and toDefinition', () => {
  it('TH-003 keeps text parts in order and counts everything else as dropped', () => {
    expect(toResult({ content: [{ type: 'text', text: 'a' }, null, { type: 'text', text: 7 }, { type: 'image' }, { type: 'text', text: 'b' }] })).toEqual({
      text: 'a\nb',
      isError: false,
      omittedParts: 3,
    });
    expect(toResult({})).toEqual({ text: '', isError: false, omittedParts: 0 });
    expect(toResult({ content: 'text', isError: 'yes' })).toEqual({ text: '', isError: false, omittedParts: 0 });
    expect(toResult({ content: [], isError: true }).isError).toBe(true);
  });

  it('TH-001 takes the title when given, an empty description when not, and read-only only when declared', () => {
    const inputSchema = { type: 'object' };
    expect(toDefinition('docs', { name: 'a', title: 'A', description: 'd', inputSchema, annotations: { readOnlyHint: true } })).toMatchObject({
      server: 'docs',
      name: 'a',
      title: 'A',
      description: 'd',
      readOnly: true,
    });
    const bare = toDefinition('docs', { name: 'b', inputSchema });
    expect(bare).toMatchObject({ description: '', readOnly: false });
    expect(bare).not.toHaveProperty('title');
    expect(toDefinition('docs', { name: 'c', inputSchema, annotations: { readOnlyHint: false } }).readOnly).toBe(false);
    expect(toDefinition('docs', { name: 'c', inputSchema, annotations: {} }).readOnly).toBe(false);
  });
});

describe('McpToolHost', () => {
  it('TH-001 follows the server’s pages of tools, up to the page limit', async () => {
    const kit = await started({ pageSize: 1 });
    const names = (await host({ servers: { [KIT_SERVER]: { url: kit.url } }, maxPages: 5 }).listTools(KIT_SERVER, 5_000)).map((d) => d.name);
    expect(names).toEqual(Object.keys(KIT_TOOLS));
    const error = await failure(host({ servers: { [KIT_SERVER]: { url: kit.url } }, maxPages: 4 }).listTools(KIT_SERVER, 5_000));
    expect(error).toMatchObject({ kind: 'invalid-response', message: 'tool server "kit" listed more than 4 pages of tools' });
  });

  it('TH-001 follows up to ten pages by default', async () => {
    const kit = await started({ pageSize: 1 });
    expect(await host({ servers: { [KIT_SERVER]: { url: kit.url } } }).listTools(KIT_SERVER, 5_000)).toHaveLength(5);
  });

  it('TH-004 sends the configured headers with every request', async () => {
    const seen: IncomingHttpHeaders[] = [];
    const kit = await started({ onRequest: (headers) => seen.push(headers) });
    await host({ servers: { [KIT_SERVER]: { url: kit.url, headers: { authorization: 'Bearer t0ken' } } } }).callTool(echo);
    expect(seen.length).toBeGreaterThan(0);
    for (const headers of seen) expect(headers.authorization).toBe('Bearer t0ken');
  });

  it.each(['docs', '__proto__', 'toString'])('TH-004 fails as unavailable for a server that is not configured: %s', async (server) => {
    const error = await failure(host({ servers: { [KIT_SERVER]: { url: 'http://127.0.0.1:9/mcp' } } }).listTools(server, 1_000));
    expect(error).toMatchObject({ kind: 'unavailable', message: `tool server "${server}" is not configured` });
  });

  it('TH-004 introduces itself and declares no client capabilities', async () => {
    const memory = inMemory();
    await host({ servers: { [KIT_SERVER]: { url: 'memory' } }, transport: memory.transport }).listTools(KIT_SERVER, 5_000);
    expect(memory.servers[0]?.getClientVersion()).toEqual({ name: 'tutors-ai-platform', version: '0.1.0' });
    expect(memory.servers[0]?.getClientCapabilities()).toEqual({});
    const named = inMemory();
    await host({ servers: { [KIT_SERVER]: { url: 'memory' } }, transport: named.transport, clientInfo: { name: 'test', version: '9' } }).listTools(KIT_SERVER, 5_000);
    expect(named.servers[0]?.getClientVersion()).toEqual({ name: 'test', version: '9' });
  });

  it('TH-004 keeps one connection per server while it works, and reconnects after a connection fails', async () => {
    const memory = inMemory();
    const tools = host({ servers: { [KIT_SERVER]: { url: 'memory' } }, transport: memory.transport });
    memory.failNextConnection();
    expect((await failure(tools.callTool(echo))).kind).toBe('unavailable');
    expect(await tools.callTool(echo)).toMatchObject({ text: 'hi' });
    expect(await tools.listTools(KIT_SERVER, 5_000)).toHaveLength(5);
    expect(memory.servers).toHaveLength(1);
    await memory.serverSides[0]?.close();
    expect((await failure(tools.callTool(echo))).kind).toBe('unavailable');
    expect(await tools.callTool(echo)).toMatchObject({ text: 'hi' });
    expect(memory.servers).toHaveLength(2);
  });

  it('TH-006 keeps the connection after the server refuses a call', async () => {
    const memory = inMemory();
    const tools = host({ servers: { [KIT_SERVER]: { url: 'memory' } }, transport: memory.transport });
    expect((await failure(tools.callTool({ ...echo, name: 'missing' }))).kind).toBe('rejected');
    expect(await tools.callTool(echo)).toMatchObject({ text: 'hi' });
    expect(memory.servers).toHaveLength(1);
  });

  it('TH-004 closes its connections on close, and connects afresh after', async () => {
    const memory = inMemory();
    const tools = host({ servers: { [KIT_SERVER]: { url: 'memory' } }, transport: memory.transport });
    await tools.callTool(echo);
    let closed = false;
    if (memory.servers[0] !== undefined) memory.servers[0].onclose = () => void (closed = true);
    await tools.close();
    expect(closed).toBe(true);
    await tools.callTool(echo);
    expect(memory.servers).toHaveLength(2);
  });

  it('TH-005 keeps connecting within the timeout', async () => {
    const tools = host({
      servers: { [KIT_SERVER]: { url: 'memory' } },
      // A transport that never answers the handshake.
      transport: () => InMemoryTransport.createLinkedPair()[0],
    });
    const started = Date.now();
    expect((await failure(tools.listTools(KIT_SERVER, 200))).kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
