import type { Identity, Principal } from '@tutors-ai/core';

export class FakeIdentity implements Identity {
  readonly #tokens: ReadonlyMap<string, Principal>;

  constructor(tokens: Readonly<Record<string, Principal>>) {
    this.#tokens = new Map(Object.entries(tokens));
  }

  async verify(token: string): Promise<Principal | null> {
    return this.#tokens.get(token) ?? null;
  }
}
