import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  canonicalToolDefinition,
  PortError,
  type Clock,
  type ToolDefinition,
  type ToolHost,
  type ToolHostCall,
  type ToolHostResult,
} from '@tutors-ai/core';

export interface McpServerConfig {
  /** The server's Streamable HTTP endpoint. */
  readonly url: string;
  /** Sent with every request, e.g. a bearer token from a mounted secret. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface McpToolHostOptions {
  /** Tool servers by the name grants and the harness use for them. */
  readonly servers: Readonly<Record<string, McpServerConfig>>;
  /** How the platform introduces itself to servers. */
  readonly clientInfo?: { readonly name: string; readonly version: string };
  /** Pages of tools a listing may follow before the server is treated as misbehaving. */
  readonly maxPages?: number;
  /** Builds the transport to a server; Streamable HTTP unless a test supplies another. */
  readonly transport?: (config: McpServerConfig) => Transport;
}

const PORT = 'ToolHost';

const httpTransport = (config: McpServerConfig): Transport => new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: { ...config.headers } } });

/** JSON-RPC errors that mean the server understood the request and refused it. */
const REFUSALS: ReadonlySet<number> = new Set([ErrorCode.InvalidParams, ErrorCode.MethodNotFound, ErrorCode.InvalidRequest]);

/**
 * Maps whatever the SDK or the network threw to a port error (TH-004 to
 * TH-006). A JSON-RPC error means the server answered; anything below the
 * protocol means it could not be reached.
 */
export function toPortError(server: string, error: unknown): PortError {
  if (PortError.is(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  const where = `tool server "${server}"`;
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) return new PortError(PORT, 'timeout', `${where} did not answer in time`);
    if (error.code === ErrorCode.ConnectionClosed) return new PortError(PORT, 'unavailable', `${where} closed the connection`);
    if (REFUSALS.has(error.code)) return new PortError(PORT, 'rejected', `${where} refused the request: ${message}`);
    return new PortError(PORT, 'invalid-response', `${where} failed the request: ${message}`);
  }
  if (error instanceof StreamableHTTPError) {
    // Without a status, treated as a server failure.
    const status = error.code ?? 500;
    if (status >= 400 && status < 500) return new PortError(PORT, 'rejected', `${where} refused the request with HTTP ${status}`);
    // The SDK's code for an answer that was not JSON-RPC at all, such as an HTML error page.
    if (status < 100) return new PortError(PORT, 'invalid-response', `${where} answered outside the protocol: ${message}`);
  }
  if (error instanceof SyntaxError || (error instanceof Error && /zod/i.test(error.name))) {
    return new PortError(PORT, 'invalid-response', `${where} answered outside the protocol: ${message}`);
  }
  return new PortError(PORT, 'unavailable', `${where} cannot be reached: ${message}`);
}

/** What a tool returned, reduced to its text parts in order (TH-003). */
export function toResult(result: object): ToolHostResult {
  const { content: listed, isError } = result as { readonly content?: unknown; readonly isError?: unknown };
  const content: readonly unknown[] = Array.isArray(listed) ? listed : [];
  const texts = content.flatMap((part) => {
    const p = part as { type?: unknown; text?: unknown } | null;
    return p?.type === 'text' && typeof p.text === 'string' ? [p.text] : [];
  });
  return { text: texts.join('\n'), isError: isError === true, omittedParts: content.length - texts.length };
}

/** The definition of one listed tool, with its digest (TH-001, TH-002). */
export function toDefinition(
  server: string,
  tool: { readonly name: string; readonly title?: string | undefined; readonly description?: string | undefined; readonly inputSchema: object; readonly annotations?: { readonly readOnlyHint?: boolean | undefined } | undefined },
): ToolDefinition {
  const definition = {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as Readonly<Record<string, unknown>>,
    readOnly: tool.annotations?.readOnlyHint === true,
  };
  return { server, ...definition, digest: `sha256:${createHash('sha256').update(canonicalToolDefinition(definition)).digest('hex')}` };
}

/**
 * ToolHost over the Model Context Protocol (docs/adr/0008). One client per
 * configured server, connected on first use and dropped when the connection
 * fails, so the next call reconnects. The platform declares no client
 * capabilities: a tool server cannot ask it for sampling, roots or
 * elicitation.
 */
export class McpToolHost implements ToolHost {
  readonly #options: McpToolHostOptions;
  readonly #clock: Clock;
  readonly #clients = new Map<string, Promise<Client>>();

  constructor(options: McpToolHostOptions, clock: Clock) {
    this.#options = options;
    this.#clock = clock;
  }

  async listTools(server: string, timeoutMs: number): Promise<readonly ToolDefinition[]> {
    return this.#use(server, timeoutMs, async (client, remaining) => {
      const definitions: ToolDefinition[] = [];
      let cursor: string | undefined;
      const maxPages = this.#options.maxPages ?? 10;
      for (let page = 0; page < maxPages; page += 1) {
        const listed = await client.listTools(cursor === undefined ? {} : { cursor }, { timeout: remaining() });
        definitions.push(...listed.tools.map((tool) => toDefinition(server, tool)));
        cursor = listed.nextCursor;
        if (cursor === undefined) return definitions;
      }
      throw new PortError(PORT, 'invalid-response', `tool server "${server}" listed more than ${maxPages} pages of tools`);
    });
  }

  async callTool(call: ToolHostCall): Promise<ToolHostResult> {
    return this.#use(call.server, call.timeoutMs, async (client, remaining) =>
      toResult(await client.callTool({ name: call.name, arguments: { ...call.arguments } }, undefined, { timeout: remaining() })),
    );
  }

  /** Closes every open connection. */
  async close(): Promise<void> {
    const clients = [...this.#clients.values()];
    this.#clients.clear();
    await Promise.allSettled(clients.map(async (client) => (await client).close()));
  }

  /** Runs `work` on the server's client, connecting first if need be, all within `timeoutMs`. */
  async #use<T>(server: string, timeoutMs: number, work: (client: Client, remaining: () => number) => Promise<T>): Promise<T> {
    if (!Object.hasOwn(this.#options.servers, server)) throw new PortError(PORT, 'unavailable', `tool server "${server}" is not configured`);
    const config = this.#options.servers[server] as McpServerConfig;
    const deadline = this.#clock.now().getTime() + timeoutMs;
    const remaining = () => Math.max(1, deadline - this.#clock.now().getTime());
    let connection = this.#clients.get(server);
    if (connection === undefined) {
      connection = this.#connect(config, timeoutMs);
      this.#clients.set(server, connection);
    }
    try {
      return await work(await connection, remaining);
    } catch (error) {
      const failure = toPortError(server, error);
      // A connection that failed below the protocol is not reused.
      if (failure.kind === 'unavailable' && this.#clients.get(server) === connection) {
        this.#clients.delete(server);
        void connection.then((client) => client.close()).catch(() => undefined);
      }
      throw failure;
    }
  }

  async #connect(config: McpServerConfig, timeoutMs: number): Promise<Client> {
    // No options: the client declares no capabilities.
    const client = new Client(this.#options.clientInfo ?? { name: 'tutors-ai-platform', version: '0.1.0' });
    await client.connect((this.#options.transport ?? httpTransport)(config), { timeout: timeoutMs });
    return client;
  }
}
