/**
 * The heap soak: drives many requests through the real HTTP handler, the
 * real use cases and the resilience decorator, and asks whether the heap
 * keeps growing. Doubles here are stateless, so anything that accumulates is
 * the code under test. `leakVerdict` is unit tested on synthetic samples;
 * `heap.soak.test.ts` runs the soak, with and without an injected leak.
 */
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ResilientLanguageModel } from '@tutors-ai/adapter-resilience';
import { CONTRACT_VERSION, ContractPolicyProvider } from '@tutors-ai/contract';
import {
  ApplyRetentionService,
  AssistStudentService,
  PortError,
  RecordEvidenceService,
  type Completion,
  type CompletionRequest,
  type EvidenceStore,
  type LanguageModel,
  type LearnerMemory,
  type NewEvidence,
  type RecordedEvidence,
} from '@tutors-ai/core';
import { aMaterial, FAKE_MODEL, FixedClock, InMemoryCourseContent, InMemoryInsightStore } from '@tutors-ai/testing';
import { createHandler, type Services } from '../src/http.ts';

export interface Sample {
  readonly requests: number;
  readonly heapBytes: number;
}

export interface Verdict {
  readonly slopeBytesPerRequest: number;
  /** What the fitted slope adds over the whole run. */
  readonly projectedGrowthBytes: number;
  readonly leaking: boolean;
}

/**
 * Least-squares slope of heap over requests across the second half of the
 * samples (the first half includes warm-up: JIT, pools, caches filling), and
 * whether it projects more growth over the whole run than the threshold.
 */
export function leakVerdict(samples: readonly Sample[], maxGrowthBytes: number): Verdict {
  if (samples.length < 4) throw new Error(`a verdict needs at least 4 samples, got ${samples.length}`);
  const tail = samples.slice(Math.floor(samples.length / 2));
  const n = tail.length;
  const meanX = tail.reduce((s, p) => s + p.requests, 0) / n;
  const meanY = tail.reduce((s, p) => s + p.heapBytes, 0) / n;
  const sxx = tail.reduce((s, p) => s + (p.requests - meanX) ** 2, 0);
  const sxy = tail.reduce((s, p) => s + (p.requests - meanX) * (p.heapBytes - meanY), 0);
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const span = samples[samples.length - 1]!.requests - samples[0]!.requests;
  const projected = slope * span;
  return { slopeBytesPerRequest: slope, projectedGrowthBytes: projected, leaking: projected > maxGrowthBytes };
}

/** Evidence goes nowhere: the soak measures the request path, not a store. */
class SinkEvidence implements EvidenceStore {
  #sequence = 0;
  async append(evidence: NewEvidence): Promise<RecordedEvidence> {
    this.#sequence += 1;
    return { ...evidence, sequence: this.#sequence, recordedAt: new Date(0) };
  }
  async read(): Promise<readonly RecordedEvidence[]> {
    return [];
  }
  async expire(): Promise<number> {
    return 0;
  }
}

class ForgetfulMemory implements LearnerMemory {
  async recall(): Promise<readonly never[]> {
    return [];
  }
  async remember(): Promise<void> {}
  async expire(): Promise<number> {
    return 0;
  }
}

/** Answers at once, except one call in `failEvery`, which finds the server unreachable. */
class FlakyModel implements LanguageModel {
  #calls = 0;
  constructor(private readonly failEvery: number) {}
  async complete(request: CompletionRequest): Promise<Completion> {
    this.#calls += 1;
    if (this.#calls % this.failEvery === 0) throw new PortError('LanguageModel', 'unavailable', 'soak: refused');
    const first = request.material[0]!;
    return { depth: 'hint', text: `Look at ${first.title}.`, citations: [first.id], usage: { inputTokens: 1, outputTokens: 1 }, model: FAKE_MODEL, promptVersion: 'soak-1' };
  }
  stream(): never {
    throw new Error('not used');
  }
}

export function soakServices(): Services {
  const clock = new FixedClock();
  const evidence = new SinkEvidence();
  const memory = new ForgetfulMemory();
  const model = new ResilientLanguageModel(new FlakyModel(25), {
    circuit: { failureThreshold: 1_000, resetAfterMs: 10 },
    retries: 1,
    backoff: { baseMs: 1, maxMs: 2 },
    bulkhead: { maxConcurrent: 4, maxQueued: 64 },
  });
  return {
    assist: new AssistStudentService({
      policies: new ContractPolicyProvider(),
      content: new InMemoryCourseContent([aMaterial('m1', { courseId: 'c1', labId: 'lab-1' })]),
      model,
      memory,
      evidence,
      clock,
      config: { source: 'soak', modelTimeoutMs: 5_000, memoryRecallLimit: 5 },
    }),
    evidence: new RecordEvidenceService({ evidence, clock, maxClockSkewMs: 60_000 }),
    retention: new ApplyRetentionService({ evidence, memory }),
    insights: new InMemoryInsightStore(),
    ready: async () => true,
  };
}

const learner = { learnerId: 'soak', sessionId: 's', courseId: 'c1', labId: 'lab-1', level: 'first-year', memory: { kind: 'session', sharing: 'private' } };

/** The request mix: answers, evidence, malformed bodies and unknown routes. */
function requestFor(i: number): [string, RequestInit] {
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  switch (i % 5) {
    case 0:
    case 1:
      return ['/v0/assist', json({ contractVersion: CONTRACT_VERSION, learner, question: `Why does loop ${i} never end?` })];
    case 2:
      return ['/v0/evidence', json({ contractVersion: CONTRACT_VERSION, type: 'lab-opened', learnerId: 'soak', sessionId: 's', courseId: 'c1', observedAt: '2026-10-15T08:59:00Z', source: 'soak', confidence: 1, retention: 'session' })];
    case 3:
      return ['/v0/assist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"not json' }];
    default:
      return ['/nowhere', { method: 'GET' }];
  }
}

export interface SoakOptions {
  readonly requests: number;
  readonly concurrency: number;
  readonly samples: number;
  /** Wraps the handler; the self-test uses it to plant a leak. */
  readonly wrap?: (handler: RequestListener) => RequestListener;
}

export interface SoakResult {
  readonly samples: readonly Sample[];
  readonly statuses: Readonly<Record<number, number>>;
  /** Timers still scheduled after the server closed, beyond those there before it started. */
  readonly strayTimers: number;
}

const gc = () => {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('the soak needs --expose-gc (vitest --project soak sets it)');
  collect();
  collect();
};

const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

export async function soak(options: SoakOptions): Promise<SoakResult> {
  const before = timers();
  const handler = createHandler(soakServices());
  const server = createServer(options.wrap?.(handler) ?? handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const statuses: Record<number, number> = {};
  const samples: Sample[] = [];
  const every = Math.max(1, Math.floor(options.requests / options.samples));
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (let i = next++; i < options.requests; i = next++) {
      const [path, init] = requestFor(i);
      const res = await fetch(`${base}${path}`, init);
      await res.arrayBuffer();
      statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      done += 1;
      if (done % every === 0) {
        gc();
        // External memory too: a leaked Buffer lives outside the V8 heap.
        const { heapUsed, external } = process.memoryUsage();
        samples.push({ requests: done, heapBytes: heapUsed + external });
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: options.concurrency }, worker));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { samples, statuses, strayTimers: Math.max(0, timers() - before) };
}
