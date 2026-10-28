import { KIT_SERVER, toolHostContract } from '@tutors-ai/testing';
import { afterAll, beforeAll } from 'vitest';
import { McpToolHost } from '../src/index.ts';
import { SLOW_MS, startKitServer, type RunningKitServer } from './kit-server.ts';

// The adapter against a real MCP server over Streamable HTTP, in this process.

const clock = { now: () => new Date() };
let kit: RunningKitServer;
const hosts: McpToolHost[] = [];
const host = (url: string) => {
  const created = new McpToolHost({ servers: { [KIT_SERVER]: { url } } }, clock);
  hosts.push(created);
  return created;
};

beforeAll(async () => {
  kit = await startKitServer();
});

afterAll(async () => {
  await Promise.all(hosts.map((h) => h.close()));
  await kit.close();
});

toolHostContract('McpToolHost over Streamable HTTP', {
  working: () => host(kit.url),
  changed: () => host(kit.changedUrl),
  // Port 9 (discard) is closed on the test machines: the connection is refused at once.
  unreachable: () => host('http://127.0.0.1:9/mcp'),
  slowerThanMs: SLOW_MS,
  testTimeoutMs: 10_000,
});
