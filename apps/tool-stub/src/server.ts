import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type Tool } from '@modelcontextprotocol/sdk/types.js';

/** Synthetic entries, like the fixtures' courses: nothing here is real teaching material. */
export const GLOSSARY: Readonly<Record<string, string>> = {
  loop: 'A statement that runs its body again while its condition holds.',
  variable: 'A name bound to a value that the program can read and change.',
  function: 'A named block of code that takes arguments and may return a value.',
};

export const TOOLS: readonly Tool[] = [
  {
    name: 'glossary_lookup',
    title: 'Glossary lookup',
    description: 'Looks up a programming term in the course glossary.',
    inputSchema: { type: 'object', properties: { term: { type: 'string', minLength: 1, maxLength: 64 } }, required: ['term'], additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    // Offered so the harness can be seen excluding it: it does not declare itself read-only.
    name: 'record_grade',
    description: 'Records a grade for a learner.',
    inputSchema: { type: 'object', properties: { learner: { type: 'string' }, grade: { type: 'number' } }, required: ['learner', 'grade'] },
    annotations: { readOnlyHint: false },
  },
];

function toolServer(): Server {
  const server = new Server({ name: 'tutors-ai-tool-stub', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...TOOLS] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
      case 'glossary_lookup': {
        const term = String(request.params.arguments?.['term']).trim().toLowerCase();
        const entry = Object.hasOwn(GLOSSARY, term) ? GLOSSARY[term] : undefined;
        return entry === undefined
          ? { content: [{ type: 'text', text: `No glossary entry for "${term}".` }], isError: true }
          : { content: [{ type: 'text', text: `${term}: ${entry}` }] };
      }
      case 'record_grade':
        return { content: [{ type: 'text', text: 'recorded' }] };
      default:
        throw new McpError(ErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    }
  });
  return server;
}

export interface StubOptions {
  /** When set, every MCP request must carry it as a bearer token. */
  readonly token?: string;
}

/**
 * Serves the stub's tools over stateless Streamable HTTP at /mcp, and a
 * health check at /healthz. A request without the token gets 401, as a real
 * server behind a gateway would answer.
 */
export function createStubServer(options: StubOptions = {}): HttpServer {
  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://stub').pathname;
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (path !== '/mcp') {
      res.writeHead(404).end();
      return;
    }
    if (options.token !== undefined && req.headers.authorization !== `Bearer ${options.token}`) {
      res.writeHead(401, { 'www-authenticate': 'Bearer' }).end();
      return;
    }
    const server = toolServer();
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
}
