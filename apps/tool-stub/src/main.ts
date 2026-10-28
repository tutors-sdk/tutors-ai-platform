import { createStubServer } from './server.ts';

const port = Number(process.env['PORT'] ?? 8080);
const token = process.env['STUB_TOKEN']?.trim();
const http = createStubServer(token === undefined || token === '' ? {} : { token });
http.listen(port, () => console.log(JSON.stringify({ msg: 'tool-stub listening', port, token: token !== undefined && token !== '' })));
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    http.closeAllConnections();
    http.close(() => process.exit(0));
  });
}
