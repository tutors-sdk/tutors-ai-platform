import { aLearner, anEvidence, FixedClock, InMemoryEvidenceStore, InMemoryLearnerMemory } from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import { ApplyRetentionService, DomainRuleViolation, endsAt, type RetentionBoundary } from '../src/index.ts';

async function setup() {
  const evidence = new InMemoryEvidenceStore(new FixedClock());
  const memory = new InMemoryLearnerMemory();
  const at = new Date('2026-10-15T09:00:00Z');
  const write = { question: 'q', answer: 'a', recordedAt: at };
  for (const [learner, retention] of [
    [aLearner(), 'session'],
    [aLearner(), 'course'],
    [aLearner(), 'programme'],
    [aLearner({ sessionId: 'session-2' }), 'session'],
    [aLearner({ learnerId: 'learner-2' }), 'course'],
  ] as const) {
    await evidence.append(anEvidence({ learnerId: learner.learnerId, sessionId: learner.sessionId, retention }));
    await memory.remember(learner, { kind: retention, sharing: 'private' }, write);
  }
  return { evidence, memory, service: new ApplyRetentionService({ evidence, memory }) };
}

describe('ApplyRetention', () => {
  it('AR-001 ends session retention for that session', async () => {
    const s = await setup();
    expect(await s.service.apply({ kind: 'session', sessionId: 'session-1' })).toEqual({ evidence: 1, memory: 1 });
    expect(s.evidence.all.map((e) => e.retention)).toEqual(['course', 'programme', 'session', 'course']);
  });

  it('AR-002 ends session and course retention for that course', async () => {
    const s = await setup();
    expect(await s.service.apply({ kind: 'course', courseId: 'course-1' })).toEqual({ evidence: 4, memory: 4 });
    expect(s.memory.all.map((e) => e.retention)).toEqual(['programme']);
  });

  it('AR-003 erases everything a learner has, and nothing of anyone else', async () => {
    const s = await setup();
    expect(await s.service.apply({ kind: 'learner', learnerId: 'learner-1' })).toEqual({ evidence: 4, memory: 4 });
    expect(s.evidence.all.map((e) => e.learnerId)).toEqual(['learner-2']);
    expect(s.memory.all.map((e) => e.learnerId)).toEqual(['learner-2']);
  });

  it('AR-004 rejects a boundary with an empty id without removing anything', async () => {
    for (const boundary of [
      { kind: 'session', sessionId: ' ' },
      { kind: 'course', courseId: '' },
      { kind: 'learner', learnerId: '' },
    ] as RetentionBoundary[]) {
      const s = await setup();
      await expect(s.service.apply(boundary)).rejects.toThrow(DomainRuleViolation);
      await expect(s.service.apply(boundary)).rejects.toMatchObject({ rule: 'AR-004' });
      await expect(s.service.apply(boundary)).rejects.toThrow(`${boundary.kind} boundary needs an id`);
      expect(s.evidence.all).toHaveLength(5);
      expect(s.memory.all).toHaveLength(5);
    }
  });

  it('AR-005 is idempotent', async () => {
    const s = await setup();
    await s.service.apply({ kind: 'course', courseId: 'course-1' });
    expect(await s.service.apply({ kind: 'course', courseId: 'course-1' })).toEqual({ evidence: 0, memory: 0 });
  });

  it('AR-006 removes memory before evidence', async () => {
    const s = await setup();
    const order: string[] = [];
    const service = new ApplyRetentionService({
      evidence: { ...s.evidence, append: s.evidence.append, read: s.evidence.read, expire: async () => (order.push('evidence'), 0) },
      memory: { recall: s.memory.recall, remember: s.memory.remember, expire: async () => (order.push('memory'), 0) },
    });
    await service.apply({ kind: 'learner', learnerId: 'learner-1' });
    expect(order).toEqual(['memory', 'evidence']);
  });

  it('decides what ends at a boundary from retention, learner, session and course', () => {
    const data = { retention: 'session', learnerId: 'l', sessionId: 's', courseId: 'c' } as const;
    expect(endsAt({ kind: 'session', sessionId: 's' }, data)).toBe(true);
    expect(endsAt({ kind: 'session', sessionId: 'x' }, data)).toBe(false);
    expect(endsAt({ kind: 'session', sessionId: 's' }, { ...data, retention: 'course' })).toBe(false);
    expect(endsAt({ kind: 'course', courseId: 'c' }, data)).toBe(true);
    expect(endsAt({ kind: 'course', courseId: 'c' }, { ...data, retention: 'course' })).toBe(true);
    expect(endsAt({ kind: 'course', courseId: 'c' }, { ...data, retention: 'programme' })).toBe(false);
    expect(endsAt({ kind: 'course', courseId: 'x' }, data)).toBe(false);
    expect(endsAt({ kind: 'learner', learnerId: 'l' }, { ...data, retention: 'programme' })).toBe(true);
    expect(endsAt({ kind: 'learner', learnerId: 'x' }, data)).toBe(false);
  });
});
