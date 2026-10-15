import type { Insight, InsightRun, InsightStore } from '@tutors-ai/core';
import { describe, expect, it } from 'vitest';

export interface InsightStoreSubject {
  /** A fresh, empty store for each test. */
  readonly store: () => InsightStore | Promise<InsightStore>;
}

const insight: Insight = {
  id: 'stalled-step:course-1:lab-1:02',
  type: 'stalled-step',
  courseId: 'course-1',
  labId: 'lab-1',
  stepId: '02',
  claim: '6 of 10 learners stopped at step 02 of lab-1',
  producedBy: 'rule',
  evidence: { sequences: [1, 2, 3, 4, 5, 6], learners: 6, byType: { 'step-reached': 6 } },
  reasoning: '60% of learners got no further than 02.',
};

function aRun(courseId: string, minute: number, claim = insight.claim): InsightRun {
  const i = { ...insight, courseId, claim };
  return {
    courseId,
    producedAt: new Date(Date.UTC(2026, 9, 15, 2, minute)),
    insights: [i],
    recommendations: [{ id: `PED-1:${i.id}`, suggestion: 'Review step 02 of lab-1.', insight: i, rule: { id: 'PED-1', statement: 'Scaffold the step.' } }],
  };
}

/** The InsightStore contract. An adapter may be wired only when this passes. */
export function insightStoreContract(name: string, subject: InsightStoreSubject): void {
  describe(`InsightStore contract: ${name}`, () => {
    it('IS-001 returns a saved run unchanged as the latest for its course', async () => {
      const store = await subject.store();
      const run = aRun('course-1', 0);
      await store.save(run);
      expect(await store.latest('course-1')).toEqual(run);
    });

    it('IS-002 returns the most recently produced run, and null when there is none', async () => {
      const store = await subject.store();
      expect(await store.latest('course-1')).toBeNull();
      await store.save(aRun('course-1', 30, 'later'));
      await store.save(aRun('course-1', 10, 'earlier'));
      expect((await store.latest('course-1'))?.insights[0]?.claim).toBe('later');
    });

    it('IS-003 keeps the runs of each course separate', async () => {
      const store = await subject.store();
      await store.save(aRun('course-1', 0, 'one'));
      await store.save(aRun('course-2', 5, 'two'));
      expect((await store.latest('course-1'))?.insights[0]?.claim).toBe('one');
      expect((await store.latest('course-2'))?.insights[0]?.claim).toBe('two');
      expect(await store.latest('course-3')).toBeNull();
    });
  });
}
