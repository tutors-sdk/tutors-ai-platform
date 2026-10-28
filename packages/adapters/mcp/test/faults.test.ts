import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { PortError } from '@tutors-ai/core';
import { afterEach, describe, expect, it } from 'vitest';
import { McpToolHost } from '../src/index.ts';

// Each way a tool server or the network can misbehave once the session is up, served by a
// scripted HTTP server: the handshake is answered properly, and the fault applies to every
// listing and call after it. Each names the port error the harness must see (TH-004 to TH-006).

type Fault = (res: ServerResponse, id: unknown, req: IncomingMessage) => void;

interface Case {
  readonly name: string;
  readonly kind: PortError['kind'];
  readonly fault: Fault;
  /** A timeout for the call when the fault is that the server never answers. */
  readonly timeoutMs?: number;
}

const json = (res: ServerResponse, status: number, body: unknown, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const CATALOGUE: readonly Case[] = [
  { name: 'HTTP 500', kind: 'unavailable', fault: (res) => json(res, 500, 'internal error', 'text/plain') },
  { name: 'HTTP 503', kind: 'unavailable', fault: (res) => json(res, 503, 'draining', 'text/plain') },
  { name: 'HTTP 401', kind: 'rejected', fault: (res) => json(res, 401, 'no token', 'text/plain') },
  { name: 'HTTP 404, a server that forgot the session', kind: 'rejected', fault: (res) => json(res, 404, 'not found', 'text/plain') },
  { name: 'socket closed before answering', kind: 'unavailable', fault: (res) => res.socket?.destroy() },
  { name: 'no answer before the timeout', kind: 'timeout', fault: () => undefined, timeoutMs: 200 },
  { name: 'an HTML page instead of JSON-RPC', kind: 'invalid-response', fault: (res) => json(res, 200, '<html>proxy</html>', 'text/html') },
  { name: 'JSON that does not parse', kind: 'invalid-response', fault: (res) => json(res, 200, '{"jsonrpc":"2.0",') },
  {
    name: 'a JSON-RPC internal error',
    kind: 'invalid-response',
    fault: (res, id) => json(res, 200, { jsonrpc: '2.0', id, error: { code: -32603, message: 'tool crashed' } }),
  },
  {
    name: 'a JSON-RPC invalid-params error',
    kind: 'rejected',
    fault: (res, id) => json(res, 200, { jsonrpc: '2.0', id, error: { code: -32602, message: 'bad arguments' } }),
  },
  {
    name: 'a result that is not the method’s schema',
    kind: 'invalid-response',
    fault: (res, id) => json(res, 200, { jsonrpc: '2.0', id, result: { tools: 'none', content: 'none' } }),
  },
];

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** A server that completes the MCP handshake and then applies `fault` to every request. */
async function faulty(fault: Fault): Promise<string> {
  const http = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const message = body === '' ? {} : (JSON.parse(body) as { id?: unknown; method?: string });
      if (req.method !== 'POST') return json(res, 405, 'no SSE', 'text/plain');
      if (message.method === 'initialize') {
        return json(res, 200, {
          jsonrpc: '2.0',
          id: message.id,
          result: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'faulty', version: '1' } },
        });
      }
      if (message.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      return fault(res, message.id, req);
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
}

async function failure(promise: Promise<unknown>): Promise<PortError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(PortError.is(error), `expected a PortError, got ${String(error)}`).toBe(true);
  return error as PortError;
}

describe('McpToolHost fault catalogue', () => {
  for (const { name, kind, fault, timeoutMs = 5_000 } of CATALOGUE) {
    it(`TH-004 TH-005 TH-006 maps ${name} to ${kind}, for a listing and a call`, async () => {
      const url = await faulty(fault);
      const host = new McpToolHost({ servers: { docs: { url } } }, { now: () => new Date() });
      closers.push(() => host.close());
      const listing = await failure(host.listTools('docs', timeoutMs));
      expect(listing).toMatchObject({ port: 'ToolHost', kind });
      expect(listing.message).toContain('tool server "docs"');
      const call = await failure(host.callTool({ server: 'docs', name: 'search', arguments: {}, timeoutMs }));
      expect(call.kind).toBe(kind);
    });
  }
});
