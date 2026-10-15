import type { LearnerMemory, MemoryScope } from '@tutors-ai/core';
import { describe, expect, it } from 'vitest';
import { aLearner } from '../builders/index.ts';

export interface LearnerMemorySubject {
  /** A fresh, empty memory for each test. */
  readonly memory: () => LearnerMemory | Promise<LearnerMemory>;
}

const at = (minute: number) => new Date(Date.UTC(2026, 9, 15, 9, minute));
const write = (question: string, minute = 0) => ({ question, answer: `answer to ${question}`, recordedAt: at(minute) });

const SESSION: MemoryScope = { kind: 'session', sharing: 'private' };
const COURSE: MemoryScope = { kind: 'course', sharing: 'private' };
const PROGRAMME: MemoryScope = { kind: 'programme', sharing: 'private' };
const NONE: MemoryScope = { kind: 'none', sharing: 'private' };

/** The LearnerMemory contract. An adapter may be wired only when this passes. */
export function learnerMemoryContract(name: string, subject: LearnerMemorySubject): void {
  describe(`LearnerMemory contract: ${name}`, () => {
    it('LMEM-001 remembers nothing and recalls nothing under a none scope', async () => {
      const memory = await subject.memory();
      const learner = aLearner();
      await memory.remember(learner, NONE, write('q1'));
      expect(await memory.recall(learner, NONE, 10)).toEqual([]);
      expect(await memory.recall(learner, SESSION, 10)).toEqual([]);
    });

    it('LMEM-002 keeps session memory to the session', async () => {
      const memory = await subject.memory();
      await memory.remember(aLearner(), SESSION, write('q1'));
      expect(await memory.recall(aLearner(), SESSION, 10)).toHaveLength(1);
      expect(await memory.recall(aLearner({ sessionId: 'session-2' }), SESSION, 10)).toEqual([]);
    });

    it('LMEM-003 shares course memory across sessions of the same course but not across courses', async () => {
      const memory = await subject.memory();
      await memory.remember(aLearner(), COURSE, write('q1'));
      expect(await memory.recall(aLearner({ sessionId: 'session-2' }), COURSE, 10)).toHaveLength(1);
      expect(await memory.recall(aLearner({ sessionId: 'session-2', courseId: 'course-2' }), COURSE, 10)).toEqual([]);
    });

    it('LMEM-004 shares programme memory across courses of the same programme only', async () => {
      const memory = await subject.memory();
      await memory.remember(aLearner(), PROGRAMME, write('q1'));
      expect(await memory.recall(aLearner({ courseId: 'course-2', sessionId: 's9' }), PROGRAMME, 10)).toHaveLength(1);
      expect(
        await memory.recall(aLearner({ courseId: 'course-3', programmeId: 'programme-2', sessionId: 's9' }), PROGRAMME, 10),
      ).toEqual([]);
    });

    it('LMEM-005 never shows one learner private memory of another', async () => {
      const memory = await subject.memory();
      await memory.remember(aLearner(), COURSE, write('q1'));
      expect(await memory.recall(aLearner({ learnerId: 'learner-2' }), { kind: 'course', sharing: 'cohort' }, 10)).toEqual([]);
    });

    it('LMEM-006 shows cohort-shared memory to other learners in the same course when their scope shares too', async () => {
      const memory = await subject.memory();
      await memory.remember(aLearner(), { kind: 'course', sharing: 'cohort' }, write('q1'));
      const peer = aLearner({ learnerId: 'learner-2', sessionId: 'session-9' });
      expect(await memory.recall(peer, { kind: 'course', sharing: 'cohort' }, 10)).toHaveLength(1);
      expect(await memory.recall(peer, COURSE, 10)).toEqual([]);
      expect(await memory.recall({ ...peer, courseId: 'course-2' }, { kind: 'course', sharing: 'cohort' }, 10)).toEqual([]);
    });

    it('LMEM-007 recalls at most the limit, keeping the most recent, oldest first', async () => {
      const memory = await subject.memory();
      for (const n of [1, 2, 3]) await memory.remember(aLearner(), SESSION, write(`q${n}`, n));
      const recalled = await memory.recall(aLearner(), SESSION, 2);
      expect(recalled.map((e) => e.question)).toEqual(['q2', 'q3']);
    });

    it('LMEM-008 erases every entry a learner wrote and reports how many', async () => {
      const memory = await subject.memory();
      await memory.remember(aLearner(), SESSION, write('q1'));
      await memory.remember(aLearner(), PROGRAMME, write('q2'));
      await memory.remember(aLearner({ learnerId: 'learner-2' }), SESSION, write('q3'));
      expect(await memory.expire({ kind: 'learner', learnerId: 'learner-1' })).toBe(2);
      expect(await memory.recall(aLearner(), COURSE, 10)).toEqual([]);
      expect(await memory.recall(aLearner({ learnerId: 'learner-2' }), SESSION, 10)).toHaveLength(1);
    });

    it('LMEM-009 forgets session memory at the end of that session only', async () => {
      const memory = await subject.memory();
      await memory.remember(aLearner(), SESSION, write('q1'));
      await memory.remember(aLearner({ sessionId: 'session-2' }), SESSION, write('q2'));
      await memory.remember(aLearner(), COURSE, write('q3'));
      expect(await memory.expire({ kind: 'session', sessionId: 'session-1' })).toBe(1);
      expect((await memory.recall(aLearner({ sessionId: 'session-2' }), SESSION, 10)).map((e) => e.question)).toEqual(['q2']);
      expect((await memory.recall(aLearner(), COURSE, 10)).map((e) => e.question)).toEqual(['q2', 'q3']);
    });

    it('LMEM-010 forgets session and course memory at the end of that course, keeping programme memory', async () => {
      const memory = await subject.memory();
      await memory.remember(aLearner(), SESSION, write('q1'));
      await memory.remember(aLearner(), COURSE, write('q2'));
      await memory.remember(aLearner(), PROGRAMME, write('q3'));
      await memory.remember(aLearner({ courseId: 'course-2' }), COURSE, write('q4'));
      expect(await memory.expire({ kind: 'course', courseId: 'course-1' })).toBe(2);
      expect((await memory.recall(aLearner(), PROGRAMME, 10)).map((e) => e.question)).toEqual(['q3', 'q4']);
    });

    it('LMEM-011 records the scope kind each entry was written under', async () => {
      const memory = await subject.memory();
      await memory.remember(aLearner(), COURSE, write('q1'));
      expect((await memory.recall(aLearner(), COURSE, 10))[0]?.retention).toBe('course');
    });
  });
}
