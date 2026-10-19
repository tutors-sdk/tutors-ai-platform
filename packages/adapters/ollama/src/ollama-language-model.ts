import {
  ASSISTANCE_DEPTHS,
  PortError,
  type AssistanceDepth,
  type Completion,
  type CompletionChunk,
  type CompletionRequest,
  type LanguageModel,
  type ModelIdentity,
} from '@tutors-ai/core';
import { JsonTextStream } from './json-text-stream.ts';
import { buildMessages, PROMPT_VERSION, responseSchema } from './prompt.ts';

export interface OllamaConfig {
  /** e.g. http://ollama.inference.svc:11434 */
  readonly baseUrl: string;
  /** The model name as Ollama knows it, e.g. "qwen2.5:0.5b". */
  readonly model: string;
  /**
   * The sha256 digest the composition root pins. The adapter refuses to
   * answer if the server's weights under that name have a different digest.
   */
  readonly digest: string;
  readonly seed?: number;
  readonly fetch?: typeof fetch;
}

interface ChatResponseLine {
  readonly message?: { readonly content?: string };
  readonly done?: boolean;
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
  readonly error?: string;
}

const PORT = 'LanguageModel';

/** LanguageModel over Ollama's HTTP API (/api/chat with structured output). */
export class OllamaLanguageModel implements LanguageModel {
  readonly #config: OllamaConfig;
  readonly #fetch: typeof fetch;
  readonly #identity: ModelIdentity;
  #verified = false;

  constructor(config: OllamaConfig) {
    this.#config = config;
    this.#fetch = config.fetch ?? fetch;
    const digest = config.digest.startsWith('sha256:') ? config.digest : `sha256:${config.digest}`;
    this.#identity = { name: config.model, digest };
  }

  async complete(request: CompletionRequest): Promise<Completion> {
    let last: Completion | undefined;
    for await (const chunk of this.#chat(request, false)) if (chunk.kind === 'done') last = chunk.completion;
    if (last === undefined) throw new PortError(PORT, 'invalid-response', 'Ollama closed the response without finishing');
    return last;
  }

  stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    return this.#chat(request, true);
  }

  async *#chat(request: CompletionRequest, stream: boolean): AsyncGenerator<CompletionChunk> {
    const signal = AbortSignal.timeout(request.timeoutMs);
    try {
      await this.#verifyDigest(signal);
      const response = await this.#fetch(new URL('/api/chat', this.#config.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: this.#config.model,
          messages: buildMessages(request),
          format: responseSchema(request.bound.maxDepth),
          stream,
          options: { temperature: 0, seed: this.#config.seed ?? 42 },
        }),
      });
      if (!response.ok || response.body === null) {
        throw new PortError(PORT, statusKind(response.status), `Ollama answered ${response.status} ${await safeText(response)}`);
      }
      const text = new JsonTextStream();
      let usage: Completion['usage'] | undefined;
      for await (const line of ndjson(response.body)) {
        if (line.error !== undefined) throw new PortError(PORT, 'unavailable', `Ollama error: ${line.error}`);
        const delta = text.push(line.message?.content ?? '');
        if (stream && delta.length > 0) yield { kind: 'delta', text: delta };
        if (line.done === true) {
          usage = { inputTokens: line.prompt_eval_count ?? 0, outputTokens: line.eval_count ?? 0 };
        }
      }
      // OLL-006: a body that ends without the final line was cut off, whatever it holds so far.
      if (usage === undefined) throw new PortError(PORT, 'unavailable', 'Ollama closed the response before its final line');
      yield { kind: 'done', completion: this.#parse(text.json, usage) };
    } catch (error) {
      throw toPortError(error, request.timeoutMs);
    }
  }

  async #verifyDigest(signal: AbortSignal): Promise<void> {
    if (this.#verified) return;
    const response = await this.#fetch(new URL('/api/tags', this.#config.baseUrl), { signal });
    if (!response.ok) throw new PortError(PORT, statusKind(response.status), `Ollama /api/tags answered ${response.status}`);
    let list: { models?: { name: string; digest: string }[] };
    try {
      list = JSON.parse(await response.text()) as typeof list;
    } catch {
      throw new PortError(PORT, 'invalid-response', 'Ollama /api/tags sent a body that is not JSON');
    }
    const { models = [] } = list;
    const found = models.find((m) => m.name === this.#config.model);
    if (found === undefined) throw new PortError(PORT, 'unavailable', `model ${this.#config.model} is not loaded`);
    if (`sha256:${found.digest.replace(/^sha256:/, '')}` !== this.#identity.digest) {
      throw new PortError(PORT, 'rejected', `model ${this.#config.model} has digest ${found.digest}, expected ${this.#identity.digest}`);
    }
    this.#verified = true;
  }

  #parse(json: string, usage: Completion['usage']): Completion {
    let body: { depth?: unknown; citations?: unknown; text?: unknown };
    try {
      body = JSON.parse(json) as typeof body;
    } catch {
      throw new PortError(PORT, 'invalid-response', 'model output is not valid JSON');
    }
    const { depth, citations, text } = body;
    if (
      typeof text !== 'string' ||
      text.length === 0 ||
      !(ASSISTANCE_DEPTHS as readonly unknown[]).includes(depth) ||
      !Array.isArray(citations) ||
      !citations.every((c) => typeof c === 'string')
    ) {
      throw new PortError(PORT, 'invalid-response', 'model output does not match the response schema');
    }
    return {
      depth: depth as AssistanceDepth,
      text,
      citations,
      usage,
      model: this.#identity,
      promptVersion: PROMPT_VERSION,
    };
  }
}

async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatResponseLine> {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line.length > 0) yield parseLine(line);
    }
  }
  if (pending.trim().length > 0) yield parseLine(pending.trim());
}

function parseLine(line: string): ChatResponseLine {
  try {
    return JSON.parse(line) as ChatResponseLine;
  } catch {
    throw new PortError(PORT, 'invalid-response', 'Ollama sent a line that is not JSON');
  }
}

/** OLL-001, OLL-002: worth trying again later, or a request Ollama will never accept. */
function statusKind(status: number): 'unavailable' | 'rejected' {
  return status >= 500 || status === 408 || status === 429 ? 'unavailable' : 'rejected';
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '';
  }
}

function toPortError(error: unknown, timeoutMs: number): PortError {
  if (PortError.is(error)) return error;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new PortError(PORT, 'timeout', `Ollama did not answer within ${timeoutMs}ms`);
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new PortError(PORT, 'unavailable', `Ollama could not be reached: ${reason}`);
}
