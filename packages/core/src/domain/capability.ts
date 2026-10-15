/**
 * Capability levels, assistance depth and memory scope.
 *
 * The values here are the vocabulary of pedagogical policy. Which level a
 * learner is at, and what each level allows, arrives as data from the
 * contract package; the core only knows how to compare and apply them.
 */

/** A capability level as named by the contract, e.g. "first-year" or "final-year". */
export type CapabilityLevelId = string;

/** How much the assistant may say, from least to most. */
export const ASSISTANCE_DEPTHS = ['redirect', 'hint', 'explanation'] as const;
export type AssistanceDepth = (typeof ASSISTANCE_DEPTHS)[number];

export function depthRank(depth: AssistanceDepth): number {
  return ASSISTANCE_DEPTHS.indexOf(depth);
}

export function depthWithin(depth: AssistanceDepth, bound: AssistanceDepth): boolean {
  return depthRank(depth) <= depthRank(bound);
}

/** How long a learner's assistant may remember, from narrowest to widest. */
export const MEMORY_SCOPE_KINDS = ['none', 'session', 'course', 'programme'] as const;
export type MemoryScopeKind = (typeof MEMORY_SCOPE_KINDS)[number];

/** Whether remembered material may be seen by other learners in the same cohort. */
export const MEMORY_SHARINGS = ['private', 'cohort'] as const;
export type MemorySharing = (typeof MEMORY_SHARINGS)[number];

export interface MemoryScope {
  readonly kind: MemoryScopeKind;
  readonly sharing: MemorySharing;
}

export function scopeRank(kind: MemoryScopeKind): number {
  return MEMORY_SCOPE_KINDS.indexOf(kind);
}

/**
 * The narrower of two memory scopes. Used when the monorepo's requested scope
 * and the policy's permitted scope differ: the platform never widens memory.
 */
export function narrowestScope(a: MemoryScope, b: MemoryScope): MemoryScope {
  const kind = MEMORY_SCOPE_KINDS[Math.min(scopeRank(a.kind), scopeRank(b.kind))] as MemoryScopeKind;
  const sharing: MemorySharing = a.sharing === 'private' || b.sharing === 'private' ? 'private' : 'cohort';
  return { kind, sharing };
}
