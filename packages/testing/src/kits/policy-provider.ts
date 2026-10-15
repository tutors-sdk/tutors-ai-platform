import { ASSISTANCE_DEPTHS, MEMORY_SCOPE_KINDS, MEMORY_SHARINGS, type PolicyProvider } from '@tutors-ai/core';
import { describe, expect, it } from 'vitest';

export interface PolicyProviderSubject {
  readonly provider: () => PolicyProvider | Promise<PolicyProvider>;
  readonly courseId: string;
  /** Levels the subject defines a policy for. */
  readonly levels: readonly string[];
}

/** The PolicyProvider contract. An adapter may be wired only when this passes. */
export function policyProviderContract(name: string, subject: PolicyProviderSubject): void {
  describe(`PolicyProvider contract: ${name}`, () => {
    it('PP-001 returns a policy for exactly the requested level', async () => {
      const provider = await subject.provider();
      for (const level of subject.levels) {
        expect((await provider.policyFor(subject.courseId, level))?.level).toBe(level);
      }
    });

    it('PP-002 returns null for a level with no policy', async () => {
      expect(await (await subject.provider()).policyFor(subject.courseId, 'no-such-level')).toBeNull();
    });

    it('PP-003 returns well-formed policies', async () => {
      const provider = await subject.provider();
      for (const level of subject.levels) {
        const policy = await provider.policyFor(subject.courseId, level);
        expect(policy?.id.length).toBeGreaterThan(0);
        expect(policy?.version.length).toBeGreaterThan(0);
        expect(ASSISTANCE_DEPTHS).toContain(policy?.maxDepth);
        expect(MEMORY_SCOPE_KINDS).toContain(policy?.memory.kind);
        expect(MEMORY_SHARINGS).toContain(policy?.memory.sharing);
        expect(policy?.maxResponseChars).toBeGreaterThan(0);
        expect(policy?.maxMaterial).toBeGreaterThan(0);
      }
    });
  });
}
