import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '@tutors-ai/app-inference-api/src/http.ts';
import { ContractPolicyProvider } from '@tutors-ai/contract';
import { ApplyRetentionService, AssistStudentService, RecordEvidenceService, type EvaluationReport } from '@tutors-ai/core';
import { aMaterial, FakeLanguageModel, FixedClock, InMemoryCourseContent, InMemoryEvidenceStore, InMemoryInsightStore, InMemoryLearnerMemory } from '@tutors-ai/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpAssistStudent, run } from '../src/index.ts';

let server: Server;
let api: string;

beforeAll(async () => {
  const clock = new FixedClock();
  const evidence = new InMemoryEvidenceStore(clock);
  const memory = new InMemoryLearnerMemory();
  const handler = createHandler({
    assist: new AssistStudentService({
      policies: new ContractPolicyProvider(),
      content: new InMemoryCourseContent([aMaterial('m1', { courseId: 'c1', labId: 'lab-1' })]),
      model: new FakeLanguageModel(),
      memory,
      evidence,
      clock,
      config: { source: 'evaluation', modelTimeoutMs: 1_000, memoryRecallLimit: 5 },
    }),
    evidence: new RecordEvidenceService({ evidence, clock, maxClockSkewMs: 0 }),
    retention: new ApplyRetentionService({ evidence, memory }),
    insights: new InMemoryInsightStore(),
    ready: async () => true,
  });
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const learner = { learnerId: 'eval', sessionId: 'eval', courseId: 'c1', labId: 'lab-1', level: 'first-year', memory: { kind: 'session', sharing: 'private' } } as const;

async function goldenFile(cases: unknown[]): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'eval-'));
  const path = join(dir, 'first-year.json');
  await writeFile(path, JSON.stringify({ id: 'first-year', version: '1', level: 'first-year', cases }));
  return { dir, path };
}

describe('evaluation harness', () => {
  it('reaches AssistStudent over HTTP and maps the wire response back to the domain', async () => {
    const response = await new HttpAssistStudent(api).assist({ learner, question: 'Why does my loop never end?' });
    expect(response).toMatchObject({ kind: 'answered', citations: ['m1'], trace: { bound: { policyId: 'first-year', maxDepth: 'hint' } } });
    await expect(new HttpAssistStudent(api).assist({ learner: { ...learner, learnerId: '' }, question: 'q' })).rejects.toThrow('inference API answered 400');
  });

  it('writes a report, passes an accepted run and fails a regression against it', async () => {
    const { dir, path } = await goldenFile([
      { id: 'c1', learner, question: 'Why does my loop never end?', expected: { kind: 'answered', maxDepth: 'hint', citations: ['m1'] } },
      { id: 'c2', learner: { ...learner, courseId: 'unknown' }, question: 'Anything?', expected: { kind: 'refused' } },
    ]);
    const out = join(dir, 'report.json');
    const lines: string[] = [];
    expect(await run(['--api', api, '--golden', path, '--out', out], { log: (l) => lines.push(l) })).toBe(0);
    const report = JSON.parse(await readFile(out, 'utf8')) as EvaluationReport;
    expect(report.results.map((r) => [r.caseId, r.passed])).toEqual([
      ['c1', true],
      ['c2', true],
    ]);
    expect(lines.join('\n')).toContain('Golden set first-year v1: 2/2 passed');

    const stricter = await goldenFile([
      { id: 'c1', learner, question: 'Why does my loop never end?', expected: { kind: 'answered', maxDepth: 'redirect', citations: ['m1'] } },
    ]);
    const log: string[] = [];
    expect(await run(['--api', api, '--golden', stricter.path, '--previous', out], { log: (l) => log.push(l) })).toBe(1);
    expect(log.join('\n')).toMatch(/FAIL c1: \[bound\] depth hint exceeds expected redirect/);
    expect(log.join('\n')).toMatch(/1 regression/);
    expect(log.join('\n')).toMatch(/removed c2/);
  });

  it('explains its usage when arguments are missing or wrong', async () => {
    const log: string[] = [];
    expect(await run([], { log: (l) => log.push(l) })).toBe(2);
    expect(await run(['--api', api, '--golden', 'x', '--max-latency-ms', 'soon'], { log: (l) => log.push(l) })).toBe(2);
    expect(await run(['--nope'], { log: (l) => log.push(l) })).toBe(2);
    expect(log.every((l) => l.includes('Usage: tutors-ai-eval'))).toBe(true);
  });
});
