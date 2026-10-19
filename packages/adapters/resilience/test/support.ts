import { PortError, type Completion, type CompletionChunk, type CompletionRequest, type LanguageModel } from '@tutors-ai/core';
import { FAKE_MODEL } from '@tutors-ai/testing';
import type { Delay, Timer } from '../src/index.ts';

/** Lets every queued promise callback and immediate run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** A timer that moves only when the test says so. */
export class ManualTimer implements Timer {
  #now = 0;
  #pending: { at: number; resolve: () => void; cancelled: boolean }[] = [];

  now(): number {
    return this.#now;
  }

  delay(ms: number): Delay {
    let resolve!: () => void;
    const elapsed = new Promise<void>((r) => (resolve = r));
    const timer = { at: this.#now + ms, resolve, cancelled: false };
    this.#pending.push(timer);
    return { elapsed, cancel: () => void (timer.cancelled = true) };
  }

  /** Timers that are neither fired nor cancelled. */
  get pending(): number {
    return this.#pending.filter((t) => !t.cancelled).length;
  }

  /** Moves time forward, firing each due timer in order and letting its callbacks run. */
  async advance(ms: number): Promise<void> {
    await settle();
    const target = this.#now + ms;
    for (;;) {
      const due = this.#pending.filter((t) => !t.cancelled && t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      this.#now = due.at;
      this.#pending.splice(this.#pending.indexOf(due), 1);
      due.resolve();
      await settle();
    }
    this.#now = target;
    await settle();
  }
}

export const COMPLETION: Completion = {
  depth: 'hint',
  text: 'Look at the loop condition.',
  citations: ['m1'],
  usage: { inputTokens: 1, outputTokens: 1 },
  model: FAKE_MODEL,
  promptVersion: 'test-1',
};

export const unavailable = () => new PortError('LanguageModel', 'unavailable', 'connection refused');
export const timeout = () => new PortError('LanguageModel', 'timeout', 'no answer in time');
export const invalid = () => new PortError('LanguageModel', 'invalid-response', 'not the schema');
export const rejected = () => new PortError('LanguageModel', 'rejected', 'wrong digest');

interface Call {
  readonly request: CompletionRequest;
  resolve(completion?: Completion): void;
  reject(error: unknown): void;
}

/** A model whose every call waits until the test answers it. */
export class ControlledModel implements LanguageModel {
  readonly calls: Call[] = [];
  /** Calls not yet answered. */
  get open(): Call[] {
    return this.calls.filter((c) => !this.#answered.has(c));
  }
  readonly #answered = new Set<Call>();

  complete(request: CompletionRequest): Promise<Completion> {
    return new Promise<Completion>((resolve, reject) => {
      const call: Call = {
        request,
        resolve: (completion = COMPLETION) => {
          this.#answered.add(call);
          resolve(completion);
        },
        reject: (error) => {
          this.#answered.add(call);
          reject(error);
        },
      };
      this.calls.push(call);
    });
  }

  async *stream(request: CompletionRequest): AsyncIterable<CompletionChunk> {
    const completion = await this.complete(request);
    for (const word of completion.text.split(' ')) yield { kind: 'delta', text: word };
    yield { kind: 'done', completion };
  }
}

/** Settles a promise into what it resolved or rejected with, so tests can assert either. */
export async function outcome<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
}
