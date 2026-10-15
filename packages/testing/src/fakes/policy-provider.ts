import type { CapabilityLevelId, PedagogicalPolicy, PolicyProvider } from '@tutors-ai/core';

/** Policies keyed by level, the same for every course unless a course override is given. */
export class StaticPolicyProvider implements PolicyProvider {
  readonly #byLevel: ReadonlyMap<string, PedagogicalPolicy>;
  readonly #byCourse: ReadonlyMap<string, PedagogicalPolicy>;

  constructor(policies: readonly PedagogicalPolicy[], courseOverrides: Readonly<Record<string, PedagogicalPolicy>> = {}) {
    this.#byLevel = new Map(policies.map((p) => [p.level, p]));
    this.#byCourse = new Map(Object.entries(courseOverrides).map(([course, p]) => [`${course}/${p.level}`, p]));
  }

  async policyFor(courseId: string, level: CapabilityLevelId): Promise<PedagogicalPolicy | null> {
    return this.#byCourse.get(`${courseId}/${level}`) ?? this.#byLevel.get(level) ?? null;
  }
}
