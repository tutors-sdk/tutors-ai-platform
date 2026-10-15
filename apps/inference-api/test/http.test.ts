import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CONTRACT_VERSION, ContractPolicyProvider } from '@tutors-ai/contract';
import { ApplyRetentionService, AssistStudentService, PortError, RecordEvidenceService } from '@tutors-ai/core';
import { aMaterial, FakeLanguageModel, FixedClock, InMemoryCourseContent, InMemoryEvidenceStore, InMemoryInsightStore, InMemoryLearnerMemory } from '@tutors-ai/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler, MAX_BODY_BYTES, type Services } from '../src/http.ts';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

function fakes(overrides: Partial<Services> = {}) {
  const clock = new FixedClock();
  const evidence = new InMemoryEvidenceStore(clock);
  const memory = new InMemoryLearnerMemory();
  const services: Services = {
    assist: new AssistStudentService({
      policies: new ContractPolicyProvider(),
      content: new InMemoryCourseContent([aMaterial('m1', { courseId: 'c1', labId: 'lab-1' })]),
      model: new FakeLanguageModel(),
      memory,
      evidence,
      clock,
      config: { source: 'inference-api', modelTimeoutMs: 1_000, memoryRecallLimit: 5 },
    }),
    evidence: new RecordEvidenceService({ evidence, clock, maxClockSkewMs: 60_000 }),
    retention: new ApplyRetentionService({ evidence, memory }),
    insights: new InMemoryInsightStore(),
    ready: async () => true,
    ...overrides,
  };
  return { services, evidence, memory };
}

async function serve(services: Services): Promise<string> {
  const server = createServer(createHandler(services));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (base: string, path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

const learner = {
  learnerId: 'l1',
  sessionId: 's1',
  courseId: 'c1',
  labId: 'lab-1',
  level: 'first-year',
  memory: { kind: 'session', sharing: 'private' },
};

describe('inference-api over HTTP', () => {
  it('answers an assist request with a contract response, recording evidence', async () => {
    const f = fakes();
    const base = await serve(f.services);
    const res = await post(base, '/v0/assist', { contractVersion: CONTRACT_VERSION, learner, question: 'Why does my loop never end?' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ contractVersion: CONTRACT_VERSION, kind: 'answered', citations: ['m1'] });
    expect(f.evidence.all.map((e) => e.type)).toEqual(['assistance-requested', 'assistance-given']);
  });

  it('records evidence and returns its sequence', async () => {
    const f = fakes();
    const base = await serve(f.services);
    const res = await post(base, '/v0/evidence', {
      contractVersion: CONTRACT_VERSION,
      type: 'step-reached',
      learnerId: 'l1',
      sessionId: 's1',
      courseId: 'c1',
      labId: 'lab-1',
      stepId: '02',
      observedAt: '2026-10-15T08:59:00Z',
      source: 'tutors-reader',
      confidence: 1,
      retention: 'course',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ contractVersion: CONTRACT_VERSION, sequence: 1, recordedAt: '2026-10-15T09:00:00.000Z' });
  });

  it('applies a retention boundary and says what it removed', async () => {
    const f = fakes();
    const base = await serve(f.services);
    await post(base, '/v0/assist', { contractVersion: CONTRACT_VERSION, learner, question: 'Why does my loop never end?' });
    const res = await post(base, '/v0/retention', { contractVersion: CONTRACT_VERSION, boundary: { kind: 'session', sessionId: 's1' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contractVersion: CONTRACT_VERSION, removed: { evidence: 2, memory: 1 } });
  });

  it('serves the latest insights run for a course, and an empty one before any run', async () => {
    const insights = new InMemoryInsightStore();
    await insights.save({ courseId: 'c1', producedAt: new Date('2026-10-15T02:00:00Z'), insights: [], recommendations: [] });
    const base = await serve(fakes({ insights }).services);
    const res = await fetch(`${base}/v0/insights?courseId=c1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ contractVersion: CONTRACT_VERSION, courseId: 'c1', producedAt: '2026-10-15T02:00:00.000Z', insights: [], recommendations: [] });
    expect(await (await fetch(`${base}/v0/insights?courseId=c2`)).json()).toMatchObject({ producedAt: null });
    expect((await fetch(`${base}/v0/insights`)).status).toBe(400);
    expect((await fetch(`${base}/v0/insights?courseId=%20`)).status).toBe(400);
  });

  it('rejects contract violations and domain rule violations with 400', async () => {
    const base = await serve(fakes().services);
    const wrong = await post(base, '/v0/assist', { contractVersion: '9.9.9', learner, question: 'q' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: 'contract-violation', issues: [{ path: 'contractVersion' }] });
    const future = await post(base, '/v0/evidence', {
      contractVersion: CONTRACT_VERSION,
      type: 'lab-opened',
      learnerId: 'l1',
      sessionId: 's1',
      courseId: 'c1',
      observedAt: '2030-01-01T00:00:00Z',
      source: 'tutors-reader',
      confidence: 1,
      retention: 'session',
    });
    expect(future.status).toBe(400);
    expect(await future.json()).toMatchObject({ error: 'domain-rule-violation', rule: expect.stringMatching(/^RE-/) });
  });

  it('rejects malformed JSON, the wrong media type and oversized bodies', async () => {
    const base = await serve(fakes().services);
    expect((await post(base, '/v0/assist', '{not json')).status).toBe(400);
    const text = await fetch(`${base}/v0/assist`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect(text.status).toBe(415);
    const big = await post(base, '/v0/assist', { pad: 'x'.repeat(MAX_BODY_BYTES) });
    expect(big.status).toBe(413);
  });

  it('answers 404 for unknown paths and 405 with Allow for the wrong method', async () => {
    const base = await serve(fakes().services);
    expect((await fetch(`${base}/v0/nope`)).status).toBe(404);
    const res = await fetch(`${base}/v0/assist`);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('reports liveness always and readiness from its dependencies', async () => {
    const up = await serve(fakes().services);
    expect((await fetch(`${up}/healthz`)).status).toBe(200);
    expect((await fetch(`${up}/readyz`)).status).toBe(200);
    const down = await serve(
      fakes({
        ready: async () => {
          throw new Error('db down');
        },
      }).services,
    );
    expect((await fetch(`${down}/healthz`)).status).toBe(200);
    expect((await fetch(`${down}/readyz`)).status).toBe(503);
  });

  it('maps an unavailable dependency to 503 and anything else to 500 without detail', async () => {
    const unavailable = await serve(
      fakes({
        evidence: {
          record: async () => {
            throw new PortError('EvidenceStore', 'unavailable', 'secret connection string');
          },
        },
      }).services,
    );
    const body = { contractVersion: CONTRACT_VERSION, boundary: { kind: 'learner', learnerId: 'l1' } };
    const evidence = {
      contractVersion: CONTRACT_VERSION,
      type: 'lab-opened',
      learnerId: 'l1',
      sessionId: 's1',
      courseId: 'c1',
      observedAt: '2026-10-15T08:00:00Z',
      source: 'tutors-reader',
      confidence: 1,
      retention: 'session',
    };
    const res = await post(unavailable, '/v0/evidence', evidence);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('secret');
    const broken = await serve(
      fakes({
        retention: {
          apply: async () => {
            throw new Error('secret stack');
          },
        },
      }).services,
    );
    const crash = await post(broken, '/v0/retention', body);
    expect(crash.status).toBe(500);
    expect(await crash.json()).toEqual({ error: 'internal' });
  });
});
