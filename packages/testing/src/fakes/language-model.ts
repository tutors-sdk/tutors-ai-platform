import {
  PortError,
  type Completion,
  type CompletionChunk,
  type CompletionRequest,
  type LanguageModel,
} from '@tutors-ai/core';

export type FakeReply = Partial<Omit<Completion, 'usage' | 'model'>> & Pick<Partial<Completion>, 'usage' | 'model'>;

export interface FakeLanguageModelOptions {
  /** Builds the reply; defaults to a hint citing the first material item. */
  readonly reply?: (request: CompletionRequest) => FakeReply;
  /** Simulated latency; a request whose timeout is shorter fails with a timeout PortError. */
  readonly latencyMs?: number;
  readonly unavailable?: boolean;
}

export const FAKE_MODEL = { name: 'fake-model', digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' };

/** A scripted LanguageModel. Records every request so tests can inspect what the core sent. */
export class FakeLanguageModel implements LanguageModel {
  readonly requests: CompletionRequest[] = [];
  readonly #options: FakeLanguageModelOptions;

  constructor(options: FakeLanguageModelOptions = {}) {
    this.#options = options;
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    this.requests.push(request);
    if (this.#options.unavailable === true) throw new PortError('LanguageModel', 'unavailable', 'fake model is down');
    const latency = this.#options.latencyMs ?? 0;
    if (latency > request.timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, request.timeoutMs));
      throw new PortError('LanguageModel', 'timeout', `fake model exceeded ${request.timeoutMs}ms`);
    }
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
    const reply = this.#options.reply?.(request) ?? {};
    const first = request.material[0];
    const text = reply.text ?? `Have another look at ${first?.title ?? 'the lab'}.`;
    return {
      depth: reply.depth ?? 'hint',
      text,
      citations: reply.citations ?? (first === undefined ? [] : [first.id]),
      usage: reply.usage ?? { inputTokens: request.question.length, outputTokens: text.length },
      model: reply.model ?? FAKE_MODEL,
      promptVersion: reply.promptVersion ?? 'fake-1',
    };
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const completion = await this.complete(request);
    for (const word of completion.text.split(/(?<= )/)) yield { kind: 'delta', text: word };
    yield { kind: 'done', completion };
  }
}
