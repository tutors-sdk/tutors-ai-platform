import { CONTRACT_VERSION, fromAssistResponse } from '@tutors-ai/contract';
import type { AssistanceRequest, AssistanceResponse, AssistStudent } from '@tutors-ai/core';

/**
 * AssistStudent as a student reaches it: over HTTP, through the deployed
 * composition root (EC-001). Nothing is short-circuited for evaluation.
 */
export class HttpAssistStudent implements AssistStudent {
  readonly #url: URL;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = fetch) {
    this.#url = new URL('/v0/assist', baseUrl);
    this.#fetch = fetchImpl;
  }

  async assist(request: AssistanceRequest): Promise<AssistanceResponse> {
    const response = await this.#fetch(this.#url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contractVersion: CONTRACT_VERSION, learner: request.learner, question: request.question }),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`inference API answered ${response.status}: ${JSON.stringify(body)}`);
    return fromAssistResponse(body);
  }
}
