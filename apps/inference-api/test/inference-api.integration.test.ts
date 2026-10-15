import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { CONTRACT_VERSION, contract } from '@tutors-ai/contract';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compose, type Composed } from '../src/compose.ts';
import { readConfig } from '../src/config.ts';
import { createHandler } from '../src/http.ts';

const { PG_URL, OLLAMA_URL, OLLAMA_MODEL, OLLAMA_DIGEST } = process.env;
const enabled = [PG_URL, OLLAMA_URL, OLLAMA_MODEL, OLLAMA_DIGEST].every((v) => v !== undefined && v !== '');
const schema = `inference_api_${process.pid}`;
const courses = fileURLToPath(new URL('../../../packages/adapters/course-content/test/fixtures', import.meta.url));

describe.skipIf(!enabled)('inference-api against PostgreSQL and Ollama', () => {
  let composed: Composed;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    composed = await compose(readConfig({ ...process.env, PG_SCHEMA: schema, COURSE_EXPORT_DIR: courses, MODEL_TIMEOUT_MS: '90000' }));
    server = createServer(createHandler(composed.services));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await composed?.close();
    const pool = new pg.Pool({ connectionString: PG_URL });
    await pool.query(`drop schema if exists "${schema}" cascade`);
    await pool.end();
  });

  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('is ready once migrated', async () => {
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });

  it('answers or refuses a learner question with a valid contract response, then forgets the session', async () => {
    const res = await post('/v0/assist', {
      contractVersion: CONTRACT_VERSION,
      learner: {
        learnerId: 'it-learner',
        sessionId: 'it-session',
        courseId: 'full-stack-1',
        labId: 'lab-01-loops',
        level: 'first-year',
        memory: { kind: 'session', sharing: 'private' },
      },
      question: 'Why does my while loop never end?',
    });
    expect(res.status).toBe(200);
    const body = contract.AssistResponse.parse(await res.json());
    expect(body.trace.policy?.id).toBe('first-year');
    expect(body.trace.materialIds.length).toBeGreaterThan(0);

    const retention = await post('/v0/retention', { contractVersion: CONTRACT_VERSION, boundary: { kind: 'session', sessionId: 'it-session' } });
    expect(retention.status).toBe(200);
    // An answer records the request and what was given; a refusal records the request only.
    expect(contract.RetentionResponse.parse(await retention.json()).removed.evidence).toBe(body.kind === 'answered' ? 2 : 1);
  });
});
