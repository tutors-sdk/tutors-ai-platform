import type { CapabilityLevelId, PedagogicalPolicy, PolicyProvider } from '@tutors-ai/core';
import finalYear from './policies/final-year.json' with { type: 'json' };
import firstYear from './policies/first-year.json' with { type: 'json' };
import { Policy } from './schema.ts';

export const POLICIES_0_1: readonly unknown[] = [firstYear, finalYear];

/**
 * PolicyProvider over versioned policy data from the contract package.
 * A course-specific policy (one listing the course) wins over the level default.
 */
export class ContractPolicyProvider implements PolicyProvider {
  readonly #policies: readonly Policy[];

  constructor(policies: readonly unknown[] = POLICIES_0_1) {
    this.#policies = policies.map((p) => Policy.parse(p));
    const defaults = this.#policies.filter((p) => p.courses === undefined).map((p) => p.level);
    const duplicate = defaults.find((level, i) => defaults.indexOf(level) !== i);
    if (duplicate !== undefined) throw new Error(`more than one default policy for level "${duplicate}"`);
  }

  async policyFor(courseId: string, level: CapabilityLevelId): Promise<PedagogicalPolicy | null> {
    const forLevel = this.#policies.filter((p) => p.level === level);
    const chosen = forLevel.find((p) => p.courses?.includes(courseId)) ?? forLevel.find((p) => p.courses === undefined);
    if (chosen === undefined) return null;
    const { courses: _courses, tools, ...policy } = chosen;
    return tools === undefined ? policy : { ...policy, tools };
  }
}
