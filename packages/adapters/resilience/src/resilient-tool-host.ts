import type { ToolDefinition, ToolHost, ToolHostCall, ToolHostResult } from '@tutors-ai/core';
import type { BulkheadOptions } from './bulkhead.ts';
import type { CircuitBreakerOptions, CircuitState } from './circuit-breaker.ts';
import { Guard, type GuardEvent } from './guard.ts';
import { systemTimer, type Timer } from './timer.ts';

export interface ToolHostResilienceOptions {
  /** Per server. */
  readonly circuit: CircuitBreakerOptions;
  /** Per server. */
  readonly bulkhead: BulkheadOptions;
}

export const DEFAULT_TOOL_HOST_RESILIENCE: ToolHostResilienceOptions = {
  circuit: { failureThreshold: 3, resetAfterMs: 30_000 },
  bulkhead: { maxConcurrent: 4, maxQueued: 16 },
};

export type ToolHostResilienceEvent = GuardEvent & { readonly server: string };

export interface ToolHostResilienceDeps {
  readonly timer?: Timer;
  /** Told about every state change and shed call, with the server it concerns (RTH-008). */
  readonly observe?: (event: ToolHostResilienceEvent) => void;
}

/**
 * A circuit breaker and a bulkhead per tool server, around any ToolHost
 * (docs/adr/0008). Unlike the model, a tool call is never retried: the
 * harness cannot know that a tool is safe to run twice.
 */
export class ResilientToolHost implements ToolHost {
  readonly #inner: ToolHost;
  readonly #options: ToolHostResilienceOptions;
  readonly #timer: Timer;
  readonly #observe: (event: ToolHostResilienceEvent) => void;
  readonly #guards = new Map<string, Guard>();

  constructor(inner: ToolHost, options: ToolHostResilienceOptions = DEFAULT_TOOL_HOST_RESILIENCE, deps: ToolHostResilienceDeps = {}) {
    this.#inner = inner;
    this.#options = options;
    this.#timer = deps.timer ?? systemTimer;
    this.#observe = deps.observe ?? (() => {});
  }

  /** The state of one server's circuit; closed for a server not yet called. */
  circuit(server: string): CircuitState {
    return this.#guards.get(server)?.circuit ?? 'closed';
  }

  listTools(server: string, timeoutMs: number): Promise<readonly ToolDefinition[]> {
    return this.#run(server, timeoutMs, (remaining) => this.#inner.listTools(server, remaining));
  }

  callTool(call: ToolHostCall): Promise<ToolHostResult> {
    return this.#run(call.server, call.timeoutMs, (remaining) => this.#inner.callTool({ ...call, timeoutMs: remaining }));
  }

  /** RTH-001 to RTH-007: one attempt, admitted by the server's bulkhead and circuit, within the timeout. */
  async #run<T>(server: string, timeoutMs: number, attempt: (remainingMs: number) => Promise<T>): Promise<T> {
    const guard = this.#guard(server);
    const deadline = this.#timer.now() + timeoutMs;
    const entry = await guard.enter(deadline);
    try {
      const ticket = guard.admit();
      try {
        const result = await attempt(guard.remaining(deadline));
        guard.succeeded(ticket);
        return result;
      } catch (error) {
        guard.record(ticket, error);
        throw error;
      }
    } finally {
      entry.cancel();
    }
  }

  #guard(server: string): Guard {
    let guard = this.#guards.get(server);
    if (guard === undefined) {
      guard = new Guard('ToolHost', `tool server "${server}"`, this.#options, this.#timer, (event) => this.#observe({ ...event, server }));
      this.#guards.set(server, guard);
    }
    return guard;
  }
}
