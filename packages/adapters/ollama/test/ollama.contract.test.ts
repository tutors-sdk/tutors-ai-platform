import { languageModelContract } from '@tutors-ai/testing';
import { afterAll, beforeAll } from 'vitest';
import { OllamaLanguageModel } from '../src/index.ts';
import { startStubOllama, STUB_DIGEST, STUB_MODEL } from './stub-ollama.ts';

// The kit run against a stub that speaks Ollama's wire protocol. The same kit
// runs against a real Ollama in ollama.integration.test.ts.

let fast: Awaited<ReturnType<typeof startStubOllama>>;
let slow: Awaited<ReturnType<typeof startStubOllama>>;

beforeAll(async () => {
  fast = await startStubOllama();
  slow = await startStubOllama({ delayMs: 400 });
});
afterAll(async () => {
  await fast.close();
  await slow.close();
});

const model = (baseUrl: () => string) => () => new OllamaLanguageModel({ baseUrl: baseUrl(), model: STUB_MODEL, digest: STUB_DIGEST });

languageModelContract('OllamaLanguageModel (stub server)', {
  working: model(() => fast.url),
  unreachable: () => new OllamaLanguageModel({ baseUrl: 'http://127.0.0.1:1', model: STUB_MODEL, digest: STUB_DIGEST }),
  slow: model(() => slow.url),
  slowerThanMs: 400,
});
