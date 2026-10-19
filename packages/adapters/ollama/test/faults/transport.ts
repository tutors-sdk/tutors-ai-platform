/**
 * The transport seam: a scripted `fetch` that serves one response per request,
 * in order. Everything above it (the adapter, the decorator) is the real code.
 */
export interface ScriptedResponse {
  /** `refuse` rejects the request as a refused connection does. Default `respond`. */
  readonly kind?: 'respond' | 'refuse';
  readonly status?: number;
  readonly contentType?: string;
  /** Body chunks in order; a Uint8Array is sent as raw bytes, so a character can be split. */
  readonly chunks?: readonly (string | Uint8Array)[];
  /** After the chunks: end the body (default), reset the connection, or stall until the caller gives up. */
  readonly then?: 'end' | 'reset' | 'stall';
  /** Holds the headers back this long. */
  readonly headersAfterMs?: number;
}

export interface Transport {
  readonly fetch: typeof globalThis.fetch;
  /** Paths requested, in order. */
  readonly requests: string[];
}

const encoder = new TextEncoder();

function aborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (signal == null) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

export function scriptedTransport(script: readonly ScriptedResponse[]): Transport {
  const requests: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push(url.pathname);
    const step = script[requests.length - 1];
    if (step === undefined) throw new TypeError(`fault script exhausted at request ${requests.length} (${url.pathname})`);
    const signal = init?.signal;
    if (step.headersAfterMs !== undefined) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([new Promise((resolve) => (timer = setTimeout(resolve, step.headersAfterMs))), aborted(signal)]).finally(() => clearTimeout(timer));
    }
    if (step.kind === 'refuse') throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:11434') });
    const chunks = (step.chunks ?? []).map((c) => (typeof c === 'string' ? encoder.encode(c) : c));
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const chunk = chunks[index++];
        if (chunk !== undefined) return controller.enqueue(chunk);
        if (step.then === 'reset') return controller.error(new TypeError('terminated', { cause: new Error('other side closed') }));
        if (step.then === 'stall') {
          await aborted(signal).catch((reason: unknown) => controller.error(reason));
          return;
        }
        controller.close();
      },
    });
    return new Response(body, { status: step.status ?? 200, headers: { 'content-type': step.contentType ?? 'application/x-ndjson' } });
  };
  return { fetch, requests };
}
