import type { EvidenceStore, NewEvidence } from '@tutors-ai/core';
import { describe, expect, it } from 'vitest';

export interface EvidenceStoreSubject {
  /** A fresh, empty store for each test. */
  readonly store: () => EvidenceStore | Promise<EvidenceStore>;
}

export function anEvidence(overrides: Partial<NewEvidence> = {}): NewEvidence {
  return {
    type: 'lab-opened',
    learnerId: 'learner-1',
    sessionId: 'session-1',
    courseId: 'course-1',
    labId: 'lab-1',
    observedAt: new Date('2026-10-15T09:00:00Z'),
    source: 'tutors-reader',
    confidence: 1,
    retention: 'course',
    ...overrides,
  };
}

/** The EvidenceStore contract. An adapter may be wired only when this passes. */
export function evidenceStoreContract(name: string, subject: EvidenceStoreSubject): void {
  describe(`EvidenceStore contract: ${name}`, () => {
    it('ES-001 assigns strictly increasing sequence numbers on append', async () => {
      const store = await subject.store();
      const a = await store.append(anEvidence());
      const b = await store.append(anEvidence({ type: 'step-reached', stepId: 's1' }));
      expect(b.sequence).toBeGreaterThan(a.sequence);
    });

    it('ES-002 returns stored evidence exactly as appended, in sequence order', async () => {
      const store = await subject.store();
      const input = [
        anEvidence(),
        anEvidence({ type: 'step-reached', stepId: 's2', confidence: 0.5 }),
        anEvidence({ type: 'assistance-given', depth: 'hint', detail: { policyVersion: '0.1.0' } }),
      ];
      for (const e of input) await store.append(e);
      const read = await store.read({ courseId: 'course-1' });
      expect(read.map((r) => r.sequence)).toEqual([...read.map((r) => r.sequence)].sort((x, y) => x - y));
      expect(read).toHaveLength(3);
      read.forEach((r, i) => expect(r).toMatchObject(input[i] as object));
    });

    it('ES-003 filters by course, learner, lab and sequence', async () => {
      const store = await subject.store();
      await store.append(anEvidence());
      const second = await store.append(anEvidence({ learnerId: 'learner-2' }));
      await store.append(anEvidence({ labId: 'lab-2' }));
      await store.append(anEvidence({ courseId: 'course-2' }));
      expect(await store.read({ courseId: 'course-1' })).toHaveLength(3);
      expect(await store.read({ courseId: 'course-1', learnerId: 'learner-2' })).toHaveLength(1);
      expect(await store.read({ courseId: 'course-1', labId: 'lab-2' })).toHaveLength(1);
      expect(await store.read({ courseId: 'course-1', afterSequence: second.sequence })).toHaveLength(1);
      expect(await store.read({ courseId: 'course-3' })).toEqual([]);
    });

    it('ES-004 is append-only: earlier records are unchanged by later appends', async () => {
      const store = await subject.store();
      await store.append(anEvidence());
      const before = await store.read({ courseId: 'course-1' });
      await store.append(anEvidence({ type: 'step-reached' }));
      const after = await store.read({ courseId: 'course-1' });
      expect(after.slice(0, before.length)).toEqual(before);
    });

    it('ES-005 expires session retention at the end of that session only', async () => {
      const store = await subject.store();
      await store.append(anEvidence({ retention: 'session' }));
      await store.append(anEvidence({ retention: 'session', sessionId: 'session-2' }));
      await store.append(anEvidence({ retention: 'course' }));
      expect(await store.expire({ kind: 'session', sessionId: 'session-1' })).toBe(1);
      const left = await store.read({ courseId: 'course-1' });
      expect(left.map((r) => [r.sessionId, r.retention])).toEqual([
        ['session-2', 'session'],
        ['session-1', 'course'],
      ]);
    });

    it('ES-006 expires session and course retention at the end of that course, keeping programme retention', async () => {
      const store = await subject.store();
      await store.append(anEvidence({ retention: 'session' }));
      await store.append(anEvidence({ retention: 'course' }));
      await store.append(anEvidence({ retention: 'programme' }));
      await store.append(anEvidence({ retention: 'course', courseId: 'course-2' }));
      expect(await store.expire({ kind: 'course', courseId: 'course-1' })).toBe(2);
      expect((await store.read({ courseId: 'course-1' })).map((r) => r.retention)).toEqual(['programme']);
      expect(await store.read({ courseId: 'course-2' })).toHaveLength(1);
    });

    it('ES-007 erases everything for a learner on request, whatever its retention', async () => {
      const store = await subject.store();
      await store.append(anEvidence({ retention: 'programme' }));
      await store.append(anEvidence({ retention: 'session' }));
      await store.append(anEvidence({ learnerId: 'learner-2' }));
      expect(await store.expire({ kind: 'learner', learnerId: 'learner-1' })).toBe(2);
      expect((await store.read({ courseId: 'course-1' })).map((r) => r.learnerId)).toEqual(['learner-2']);
    });
  });
}
