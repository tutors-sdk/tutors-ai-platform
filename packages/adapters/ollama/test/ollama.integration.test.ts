import { AssistStudentService, REFUSAL_REASONS } from '@tutors-ai/core';
import {
  aLearner,
  FINAL_YEAR,
  FIRST_YEAR,
  FixedClock,
  InMemoryEvidenceStore,
  InMemoryLearnerMemory,
  languageModelContract,
  StaticPolicyProvider,
  aMaterial,
  InMemoryCourseContent,
} from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import { OllamaLanguageModel } from '../src/index.ts';

// Runs against a real Ollama serving a small CPU model. CI starts one; locally:
//   ollama pull qwen2.5:0.5b
//   OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:0.5b OLLAMA_DIGEST=<from /api/tags> pnpm test:integration
// Assertions are on structure, never wording: only the evaluation harness judges wording.

const url = process.env.OLLAMA_URL;
const name = process.env.OLLAMA_MODEL;
const digest = process.env.OLLAMA_DIGEST;
const enabled = url !== undefined && name !== undefined && digest !== undefined;

const model = () => new OllamaLanguageModel({ baseUrl: url ?? '', model: name ?? '', digest: digest ?? '' });

/** Delays every request so the adapter's timeout can be exercised against a real server. */
const delayedFetch: typeof fetch = (input, init) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(fetch(input, init)), 2_000);
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(init.signal?.reason);
    });
  });

if (enabled) {
  languageModelContract(`OllamaLanguageModel (${name})`, {
    working: model,
    unreachable: () => new OllamaLanguageModel({ baseUrl: 'http://127.0.0.1:1', model: name, digest }),
    slow: () => new OllamaLanguageModel({ baseUrl: url, model: name, digest, fetch: delayedFetch }),
    slowerThanMs: 2_000,
    testTimeoutMs: 120_000,
  });
}

describe.skipIf(!enabled)('AssistStudent with a real model', () => {
  it('returns an answer within the bound or a known refusal, never anything else', { timeout: 180_000 }, async () => {
    const clock = new FixedClock();
    const service = new AssistStudentService({
      policies: new StaticPolicyProvider([FIRST_YEAR, FINAL_YEAR]),
      content: new InMemoryCourseContent([
        aMaterial('loops-01', { title: 'While loops', text: 'A while loop repeats while its condition is true. If nothing changes the condition, it never ends.' }),
        aMaterial('loops-02', { title: 'For loops', text: 'A for loop has an initialiser, a condition and an increment.' }),
      ]),
      model: model(),
      memory: new InMemoryLearnerMemory(),
      evidence: new InMemoryEvidenceStore(clock),
      clock,
      config: { source: 'integration-test', modelTimeoutMs: 120_000, memoryRecallLimit: 5 },
    });
    const response = await service.assist({ learner: aLearner(), question: 'Why does my while loop never end?' });
    if (response.kind === 'answered') {
      expect(['redirect', 'hint']).toContain(response.depth);
      expect(response.citations.every((c) => ['loops-01', 'loops-02'].includes(c))).toBe(true);
    } else {
      expect(REFUSAL_REASONS).toContain(response.reason);
    }
    expect(response.trace.model?.digest).toMatch(/^sha256:/);
  });
});
