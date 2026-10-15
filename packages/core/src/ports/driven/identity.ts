import type { CapabilityLevelId } from '../../domain/capability.ts';

export type Role = 'student' | 'lecturer' | 'evaluator';

export interface Principal {
  readonly subject: string;
  readonly roles: readonly Role[];
  readonly level?: CapabilityLevelId;
}

/** Driven port: token validation and role resolution. */
export interface Identity {
  /** The principal for a valid token, or null when the token is invalid, expired or wrongly scoped. */
  verify(token: string): Promise<Principal | null>;
}
