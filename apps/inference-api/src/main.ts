import { createServer } from 'node:http';
import { compose } from './compose.ts';
import { readConfig } from './config.ts';
import { createHandler } from './http.ts';

const config = readConfig(process.env);
const { services, tools, close } = await compose(config);
const server = createServer(createHandler(services));
server.requestTimeout = config.modelTimeoutMs + 5_000;
server.listen(config.port, () => {
  console.log(JSON.stringify({ msg: 'inference-api listening', port: config.port, model: config.ollama.model, toolServers: tools.servers }));
});

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    server.close(() => void close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
