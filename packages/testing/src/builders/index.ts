import type { LearnerContext, Material, PedagogicalPolicy } from '@tutors-ai/core';

export function aLearner(overrides: Partial<LearnerContext> = {}): LearnerContext {
  return {
    learnerId: 'learner-1',
    sessionId: 'session-1',
    courseId: 'course-1',
    programmeId: 'programme-1',
    labId: 'lab-1',
    level: 'first-year',
    memory: { kind: 'session', sharing: 'private' },
    ...overrides,
  };
}

export function aPolicy(overrides: Partial<PedagogicalPolicy> = {}): PedagogicalPolicy {
  return {
    id: 'first-year',
    version: '0.1.0',
    level: 'first-year',
    maxDepth: 'hint',
    memory: { kind: 'session', sharing: 'private' },
    maxResponseChars: 600,
    maxMaterial: 4,
    ...overrides,
  };
}

export const FIRST_YEAR = aPolicy();

export const FINAL_YEAR = aPolicy({
  id: 'final-year',
  level: 'final-year',
  maxDepth: 'explanation',
  memory: { kind: 'course', sharing: 'private' },
  maxResponseChars: 2400,
  maxMaterial: 8,
});

export function aMaterial(id: string, overrides: Partial<Material> = {}): Material {
  return {
    id,
    courseId: 'course-1',
    topicId: 'topic-1',
    labId: 'lab-1',
    title: `Step ${id}`,
    text: `Material for ${id}.`,
    ...overrides,
  };
}
