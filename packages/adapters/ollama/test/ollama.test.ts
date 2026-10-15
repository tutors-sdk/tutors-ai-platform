import { aCompletionRequest } from '@tutors-ai/testing';
import { PortError } from '@tutors-ai/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildMessages, JsonTextStream, OllamaLanguageModel, PROMPT_VERSION, responseSchema } from '../src/index.ts';
import { startStubOllama, STUB_DIGEST, STUB_MODEL } from './stub-ollama.ts';

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function stub(options: Parameters<typeof startStubOllama>[0] = {}) {
  const server = await startStubOllama(options);
  servers.push(server);
  return server;
}

async function portError(promise: Promise<unknown>): Promise<PortError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(PortError.is(error)).toBe(true);
  return error as PortError;
}

describe('OllamaLanguageModel', () => {
  it('pins temperature and seed, sends the structured schema bounded by depth, and names the prompt version', async () => {
    const server = await stub();
    const model = new OllamaLanguageModel({ baseUrl: server.url, model: STUB_MODEL, digest: `sha256:${STUB_DIGEST}`, seed: 7 });
    const completion = await model.complete(aCompletionRequest());
    expect(server.requests[0]).toMatchObject({
      model: STUB_MODEL,
      stream: false,
      options: { temperature: 0, seed: 7 },
      format: { properties: { depth: { enum: ['redirect', 'hint'] } } },
    });
    expect(completion).toMatchObject({
      depth: 'hint',
      citations: ['m1'],
      text: 'Look again at the "loop" condition.\nWhat makes it false? é',
      usage: { inputTokens: 120, outputTokens: 30 },
      model: { name: STUB_MODEL, digest: `sha256:${STUB_DIGEST}` },
      promptVersion: PROMPT_VERSION,
    });
  });

  it('refuses to answer when the served weights do not match the pinned digest', async () => {
    const server = await stub();
    const model = new OllamaLanguageModel({ baseUrl: server.url, model: STUB_MODEL, digest: 'sha256:' + '0'.repeat(64) });
    expect((await portError(model.complete(aCompletionRequest()))).kind).toBe('rejected');
    expect(server.requests).toHaveLength(0);
  });

  it('reports a model that is not loaded as unavailable', async () => {
    const server = await stub();
    const model = new OllamaLanguageModel({ baseUrl: server.url, model: 'missing:1b', digest: STUB_DIGEST });
    expect((await portError(model.complete(aCompletionRequest()))).kind).toBe('unavailable');
  });

  it('reports output that is not the response schema as an invalid response', async () => {
    for (const reply of ['not json', JSON.stringify({ depth: 'essay', citations: [], text: 'x' }), JSON.stringify({ depth: 'hint', citations: [1], text: 'x' }), JSON.stringify({ depth: 'hint', citations: [], text: '' })]) {
      const server = await stub({ reply: () => reply });
      const model = new OllamaLanguageModel({ baseUrl: server.url, model: STUB_MODEL, digest: STUB_DIGEST });
      expect((await portError(model.complete(aCompletionRequest()))).kind).toBe('invalid-response');
    }
  });

  it('streams only the decoded answer text, not the JSON around it', async () => {
    const server = await stub();
    const model = new OllamaLanguageModel({ baseUrl: server.url, model: STUB_MODEL, digest: STUB_DIGEST });
    const deltas: string[] = [];
    for await (const chunk of model.stream(aCompletionRequest())) if (chunk.kind === 'delta') deltas.push(chunk.text);
    expect(deltas.length).toBeGreaterThan(3);
    expect(deltas.join('')).toBe('Look again at the "loop" condition.\nWhat makes it false? é');
  });
});

describe('prompt template', () => {
  it('lists material by id, states the bound and replays memory as turns', () => {
    const messages = buildMessages(
      aCompletionRequest({
        memory: [
          {
            learnerId: 'l',
            sessionId: 's',
            courseId: 'c',
            sharing: 'private',
            recordedAt: new Date(),
            question: 'earlier?',
            answer: 'earlier.',
          },
        ],
      }),
    );
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[0]?.content).toContain('[m1] Step m1');
    expect(messages[0]?.content).toContain('Never go beyond "hint"');
    expect(messages[0]?.content).not.toContain('"explanation" (');
  });

  it('only offers depths up to the bound in the schema', () => {
    expect(responseSchema('redirect').properties.depth.enum).toEqual(['redirect']);
    expect(responseSchema('explanation').properties.depth.enum).toEqual(['redirect', 'hint', 'explanation']);
  });
});

describe('JsonTextStream', () => {
  it('decodes the text value across arbitrary fragment boundaries, including escapes', () => {
    const json = JSON.stringify({ depth: 'hint', citations: ['a'], text: 'a "b"\\ c\né☃ end' });
    for (const size of [1, 2, 3, 7, json.length]) {
      const s = new JsonTextStream();
      let out = '';
      for (let i = 0; i < json.length; i += size) out += s.push(json.slice(i, i + size));
      expect(out).toBe('a "b"\\ c\né☃ end');
      expect(s.json).toBe(json);
    }
    const unicode = new JsonTextStream();
    expect(unicode.push('{"text":"\\u00')).toBe('');
    expect(unicode.push('e9!"}')).toBe('é!');
  });
});
