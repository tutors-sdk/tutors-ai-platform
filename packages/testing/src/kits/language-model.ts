import { ASSISTANCE_DEPTHS, PortError, type CompletionRequest, type LanguageModel } from '@tutors-ai/core';
import { describe, expect, it } from 'vitest';
import { aMaterial, FIRST_YEAR } from '../builders/index.ts';

export interface LanguageModelSubject {
  /** A model that is up and answering. */
  readonly working: () => LanguageModel | Promise<LanguageModel>;
  /** A model whose server cannot be reached. */
  readonly unreachable: () => LanguageModel | Promise<LanguageModel>;
  /** A model that takes longer than `slowerThanMs` to answer. */
  readonly slow: () => LanguageModel | Promise<LanguageModel>;
  readonly slowerThanMs: number;
  /** Per-test timeout for suites that hit a real model. */
  readonly testTimeoutMs?: number;
}

export function aCompletionRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    question: 'Why does my loop never end?',
    material: [aMaterial('m1', { text: 'A while loop ends when its condition becomes false.' }), aMaterial('m2')],
    bound: {
      policyId: FIRST_YEAR.id,
      policyVersion: FIRST_YEAR.version,
      maxDepth: 'hint',
      maxResponseChars: 600,
      memory: FIRST_YEAR.memory,
    },
    memory: [],
    timeoutMs: 30_000,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

/** The LanguageModel contract. An adapter may be wired only when this passes. */
export function languageModelContract(name: string, subject: LanguageModelSubject): void {
  const timeout = subject.testTimeoutMs ?? 5_000;

  describe(`LanguageModel contract: ${name}`, () => {
    it('LM-001 returns a completion with a known depth, text and citations as material ids', { timeout }, async () => {
      const model = await subject.working();
      const request = aCompletionRequest();
      const completion = await model.complete(request);
      expect(ASSISTANCE_DEPTHS).toContain(completion.depth);
      expect(typeof completion.text).toBe('string');
      expect(completion.text.length).toBeGreaterThan(0);
      expect(Array.isArray(completion.citations)).toBe(true);
      for (const id of completion.citations) expect(typeof id).toBe('string');
    });

    it('LM-002 identifies the model by name and content digest, never by tag alone', { timeout }, async () => {
      const completion = await (await subject.working()).complete(aCompletionRequest());
      expect(completion.model.name.length).toBeGreaterThan(0);
      expect(completion.model.digest).toMatch(/^sha256:[0-9a-f]{12,}$/);
      expect(completion.promptVersion.length).toBeGreaterThan(0);
    });

    it('LM-003 accounts for tokens in and out as non-negative integers', { timeout }, async () => {
      const { usage } = await (await subject.working()).complete(aCompletionRequest());
      for (const n of [usage.inputTokens, usage.outputTokens]) {
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
      }
    });

    it('LM-004 streams deltas then exactly one final completion whose text is the deltas joined', { timeout }, async () => {
      const model = await subject.working();
      const chunks = [];
      for await (const chunk of model.stream(aCompletionRequest())) chunks.push(chunk);
      const last = chunks.at(-1);
      expect(last?.kind).toBe('done');
      expect(chunks.filter((c) => c.kind === 'done')).toHaveLength(1);
      const joined = chunks.map((c) => (c.kind === 'delta' ? c.text : '')).join('');
      if (last?.kind === 'done') expect(last.completion.text).toBe(joined);
    });

    it('LM-005 fails with an unavailable PortError when the server cannot be reached', { timeout }, async () => {
      const error = await failure((await subject.unreachable()).complete(aCompletionRequest()));
      expect(PortError.is(error)).toBe(true);
      expect((error as PortError).kind).toBe('unavailable');
    });

    it('LM-006 fails with a timeout PortError once the request timeout passes', { timeout }, async () => {
      const model = await subject.slow();
      const timeoutMs = Math.max(1, Math.floor(subject.slowerThanMs / 2));
      const started = Date.now();
      const error = await failure(model.complete(aCompletionRequest({ timeoutMs })));
      expect(PortError.is(error)).toBe(true);
      expect((error as PortError).kind).toBe('timeout');
      expect(Date.now() - started).toBeLessThan(subject.slowerThanMs + 1_000);
    });
  });
}
