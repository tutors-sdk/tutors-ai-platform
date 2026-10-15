import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export const STUB_MODEL = 'stub-model:0.1';
export const STUB_DIGEST = 'a80c4f17acd55265feec403c7aef86be0c25983ab279d83f3bcd3abbcb5b8b72';

export interface StubOptions {
  /** Delay before the first byte, to exercise timeouts. */
  readonly delayMs?: number;
  /** What the model "generates" as its JSON reply. */
  readonly reply?: (system: string) => string;
}

/** A minimal Ollama: /api/tags and /api/chat (NDJSON, streamed in small fragments). */
export async function startStubOllama(options: StubOptions = {}): Promise<{ url: string; requests: unknown[]; close(): Promise<void> }> {
  const requests: unknown[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      if (req.url === '/api/tags') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ models: [{ name: STUB_MODEL, model: STUB_MODEL, digest: STUB_DIGEST }] }));
        return;
      }
      if (req.url !== '/api/chat') {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      const request = JSON.parse(body) as { messages: { role: string; content: string }[] };
      requests.push(request);
      const system = request.messages[0]?.content ?? '';
      const firstId = /^\[([^\]]+)\]/m.exec(system)?.[1] ?? 'none';
      const reply =
        options.reply?.(system) ??
        JSON.stringify({ depth: 'hint', citations: [firstId], text: 'Look again at the "loop" condition.\nWhat makes it false? é' });
      setTimeout(() => {
        if (res.destroyed) return;
        res.setHeader('content-type', 'application/x-ndjson');
        for (let i = 0; i < reply.length; i += 5) {
          res.write(JSON.stringify({ model: STUB_MODEL, message: { role: 'assistant', content: reply.slice(i, i + 5) }, done: false }) + '\n');
        }
        res.end(JSON.stringify({ model: STUB_MODEL, message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 120, eval_count: 30 }) + '\n');
      }, options.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
