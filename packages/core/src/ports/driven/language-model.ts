import type { AssistanceDepth } from '../../domain/capability.ts';
import type { Material } from '../../domain/material.ts';
import type { MemoryEntry } from '../../domain/memory.ts';
import type { AssistanceBound } from '../../domain/policy.ts';

/**
 * Structured input to a model. Prompt templates are adapter-owned: the core
 * hands over the material, the bound and the memory, never a prompt string.
 */
export interface CompletionRequest {
  readonly question: string;
  readonly material: readonly Material[];
  readonly bound: AssistanceBound;
  readonly memory: readonly MemoryEntry[];
  readonly timeoutMs: number;
}

export interface ModelIdentity {
  readonly name: string;
  /** Content digest of the weights; never a mutable tag. */
  readonly digest: string;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface Completion {
  /** The depth the model declares it answered at; the core checks it against the bound. */
  readonly depth: AssistanceDepth;
  readonly text: string;
  /** Ids of the material the answer relies on. */
  readonly citations: readonly string[];
  readonly usage: TokenUsage;
  readonly model: ModelIdentity;
  readonly promptVersion: string;
}

export type CompletionChunk =
  | { readonly kind: 'delta'; readonly text: string }
  | { readonly kind: 'done'; readonly completion: Completion };

/**
 * Driven port: an open-weight model behind any serving stack.
 * Failures are thrown as PortError with kind "timeout", "unavailable" or
 * "invalid-response".
 */
export interface LanguageModel {
  complete(request: CompletionRequest): Promise<Completion>;
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;
}
