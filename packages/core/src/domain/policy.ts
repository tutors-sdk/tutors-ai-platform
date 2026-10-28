import type { AssistanceDepth, CapabilityLevelId, MemoryScope } from './capability.ts';
import type { ToolPolicy } from './tools.ts';

/**
 * The versioned rule set that bounds what the assistant may say and remember
 * at one capability level. Policies are data owned by the contract package;
 * the platform applies them and never defines them.
 */
export interface PedagogicalPolicy {
  readonly id: string;
  readonly version: string;
  readonly level: CapabilityLevelId;
  /** The deepest assistance a response may give at this level. */
  readonly maxDepth: AssistanceDepth;
  /** The widest memory the assistant may keep at this level. */
  readonly memory: MemoryScope;
  /** Responses longer than this are truncated. */
  readonly maxResponseChars: number;
  /** Upper bound on retrieved material passed to the model. */
  readonly maxMaterial: number;
  /** The tools an exchange at this level may use; none when absent (docs/adr/0008). */
  readonly tools?: ToolPolicy;
}

/** The bound applied to one exchange, derived from a policy and a learner context. */
export interface AssistanceBound {
  readonly policyId: string;
  readonly policyVersion: string;
  readonly maxDepth: AssistanceDepth;
  readonly maxResponseChars: number;
  readonly memory: MemoryScope;
}
