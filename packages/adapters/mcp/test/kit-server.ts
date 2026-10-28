import { createServer, type IncomingHttpHeaders, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { KIT_CHANGED_ECHO_DESCRIPTION, KIT_TOOLS } from '@tutors-ai/testing';

export const SLOW_MS = 300;

export interface KitServerOptions {
  /** Tools per page of a listing; all on one page when absent. */
  readonly pageSize?: number;
  /** Told the headers of every request. */
  readonly onRequest?: (headers: IncomingHttpHeaders) => void;
}

/** The kit's tools as MCP lists them. */
function tools(echoDescription: string): Tool[] {
  return Object.values(KIT_TOOLS).map(({ readOnly, ...tool }) => ({
    ...tool,
    ...(tool.name === 'echo' ? { description: echoDescription } : {}),
    inputSchema: tool.inputSchema as Tool['inputSchema'],
    annotations: { readOnlyHint: readOnly },
  }));
}

/** An MCP server offering the kit's tools, behaving as KIT_TOOLS documents. */
export function kitServer(echoDescription: string = KIT_TOOLS.echo.description, pageSize?: number): Server {
  const server = new Server({ name: 'kit', version: '1.0.0' }, { capabilities: { tools: {} } });
  const listed = tools(echoDescription);
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    if (pageSize === undefined) return { tools: listed };
    const start = Number(request.params?.cursor ?? 0);
    const end = start + pageSize;
    return { tools: listed.slice(start, end), ...(end < listed.length ? { nextCursor: String(end) } : {}) };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const text = String(request.params.arguments?.['text']);
    switch (request.params.name) {
      case 'echo':
        return { content: [{ type: 'text', text }] };
      case 'fail':
        return { content: [{ type: 'text', text: `failed: ${text}` }], isError: true };
      case 'mixed':
        return {
          content: [
            { type: 'text', text: 'first' },
            { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
            { type: 'text', text: 'second' },
          ],
        };
      case 'slow':
        await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
        return { content: [{ type: 'text', text: 'late' }] };
      case 'write':
        return { content: [{ type: 'text', text: 'written' }] };
      default:
        throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    }
  });
  return server;
}

export interface RunningKitServer {
  /** The endpoint serving the kit's tools. */
  readonly url: string;
  /** The endpoint serving them with echo's description changed. */
  readonly changedUrl: string;
  close(): Promise<void>;
}

/** Serves the kit over Streamable HTTP on a free local port, statelessly: a server per request. */
export async function startKitServer(options: KitServerOptions = {}): Promise<RunningKitServer> {
  const http: HttpServer = createServer(async (req, res) => {
    options.onRequest?.(req.headers);
    const server = kitServer(req.url === '/changed' ? KIT_CHANGED_ECHO_DESCRIPTION : KIT_TOOLS.echo.description, options.pageSize);
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    changedUrl: `http://127.0.0.1:${port}/changed`,
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}
