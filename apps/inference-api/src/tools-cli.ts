import { migrate } from '@tutors-ai/adapter-postgres';
import { SystemClock } from '@tutors-ai/adapter-system';
import { NO_TELEMETRY } from '@tutors-ai/core';
import { composeTools, createPool } from './compose.ts';
import { readConfig } from './config.ts';
import { runToolsCommand } from './tools.ts';

// The operator's tool command (see tools.ts), built to /opt/app/tools.mjs beside the API.
const config = readConfig(process.env);
const pool = createPool(config, 1);
const clock = new SystemClock();
let code = 1;
try {
  await migrate(pool, config.pgSchema);
  const tools = composeTools(config, { sql: pool, clock, telemetry: NO_TELEMETRY, source: 'tools-cli' });
  try {
    code = await runToolsCommand(process.argv.slice(2), { harness: tools.harness, host: tools.host, clock, out: console.log, timeoutMs: 10_000 });
  } finally {
    await tools.close();
  }
} finally {
  await pool.end();
}
process.exit(code);
