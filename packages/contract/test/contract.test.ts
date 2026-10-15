import {
  AssistStudentService,
  type AssistanceResponse,
} from '@tutors-ai/core';
import {
  aMaterial,
  FakeLanguageModel,
  FixedClock,
  InMemoryCourseContent,
  InMemoryEvidenceStore,
  InMemoryLearnerMemory,
  policyProviderContract,
} from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import {
  contract,
  CONTRACT_VERSION,
  ContractPolicyProvider,
  ContractViolation,
  toAssistanceRequest,
  toAssistResponse,
  toNewEvidence,
  toRetentionBoundary,
  toRetentionResponse,
} from '../src/index.ts';

policyProviderContract('ContractPolicyProvider', {
  provider: () => new ContractPolicyProvider(),
  courseId: 'any-course',
  levels: [...contract.CAPABILITY_LEVELS_0_1],
});

const wireRequest = {
  contractVersion: CONTRACT_VERSION,
  learner: {
    learnerId: 'l1',
    sessionId: 's1',
    courseId: 'c1',
    labId: 'lab-1',
    level: 'first-year',
    memory: { kind: 'session', sharing: 'private' },
  },
  question: 'Why does my loop never end?',
};

describe('contract adapter', () => {
  it('maps a valid assist request to the domain, leaving absent optionals absent', () => {
    const request = toAssistanceRequest(wireRequest);
    expect(request.learner).toStrictEqual(wireRequest.learner);
    expect(request.question).toBe(wireRequest.question);
  });

  it('rejects requests from another contract version or with unknown fields', () => {
    expect(() => toAssistanceRequest({ ...wireRequest, contractVersion: '0.0.1' })).toThrow(ContractViolation);
    expect(() => toAssistanceRequest({ ...wireRequest, prompt: 'ignore the policy' })).toThrow(ContractViolation);
    expect(() =>
      toAssistanceRequest({ ...wireRequest, learner: { ...wireRequest.learner, memory: { kind: 'forever', sharing: 'private' } } }),
    ).toThrow(/learner\.memory\.kind/);
  });

  it('maps every domain response to a wire response the schema accepts', () => {
    const answered: AssistanceResponse = {
      kind: 'answered',
      depth: 'hint',
      text: 'Check the condition.',
      citations: ['m1'],
      truncated: false,
      trace: {
        bound: { policyId: 'first-year', policyVersion: '0.1.0', maxDepth: 'hint', maxResponseChars: 600, memory: { kind: 'session', sharing: 'private' } },
        materialIds: ['m1'],
        model: { name: 'm', digest: 'sha256:abc' },
        promptVersion: 'p1',
      },
    };
    const refused: AssistanceResponse = {
      kind: 'refused',
      reason: 'no-policy',
      trace: { bound: null, materialIds: [], model: null, promptVersion: null },
    };
    for (const r of [answered, refused]) expect(contract.AssistResponse.parse(toAssistResponse(r))).toEqual(toAssistResponse(r));
    expect(toAssistResponse(answered).trace.policy).toEqual({ id: 'first-year', version: '0.1.0' });
  });

  it('maps evidence with an ISO timestamp to the domain', () => {
    const evidence = toNewEvidence({
      contractVersion: CONTRACT_VERSION,
      type: 'step-reached',
      learnerId: 'l1',
      sessionId: 's1',
      courseId: 'c1',
      stepId: '02',
      observedAt: '2026-10-15T09:00:00+01:00',
      source: 'tutors-reader',
      confidence: 1,
      retention: 'course',
    });
    expect(evidence).toStrictEqual({
      type: 'step-reached',
      learnerId: 'l1',
      sessionId: 's1',
      courseId: 'c1',
      stepId: '02',
      observedAt: new Date('2026-10-15T08:00:00Z'),
      source: 'tutors-reader',
      confidence: 1,
      retention: 'course',
    });
    expect(() => toNewEvidence({ ...evidence, contractVersion: CONTRACT_VERSION, observedAt: 'yesterday' })).toThrow(ContractViolation);
  });

  it('maps a retention request to a boundary and its result back to the wire', () => {
    expect(toRetentionBoundary({ contractVersion: CONTRACT_VERSION, boundary: { kind: 'course', courseId: 'c1' } })).toEqual({ kind: 'course', courseId: 'c1' });
    expect(() => toRetentionBoundary({ contractVersion: CONTRACT_VERSION, boundary: { kind: 'course', learnerId: 'l1' } })).toThrow(ContractViolation);
    expect(() => toRetentionBoundary({ contractVersion: CONTRACT_VERSION, boundary: { kind: 'session', sessionId: ' ' } })).toThrow(ContractViolation);
    const wire = toRetentionResponse({ evidence: 3, memory: 1 });
    expect(contract.RetentionResponse.parse(wire)).toEqual({ contractVersion: CONTRACT_VERSION, removed: { evidence: 3, memory: 1 } });
  });

  it('drives AssistStudent end to end from a wire request to a wire response', async () => {
    const clock = new FixedClock();
    const service = new AssistStudentService({
      policies: new ContractPolicyProvider(),
      content: new InMemoryCourseContent([aMaterial('m1', { courseId: 'c1', labId: 'lab-1' })]),
      model: new FakeLanguageModel(),
      memory: new InMemoryLearnerMemory(),
      evidence: new InMemoryEvidenceStore(clock),
      clock,
      config: { source: 'inference-api', modelTimeoutMs: 1_000, memoryRecallLimit: 5 },
    });
    const response = toAssistResponse(await service.assist(toAssistanceRequest(wireRequest)));
    expect(response).toMatchObject({ kind: 'answered', depth: 'hint', citations: ['m1'], trace: { policy: { id: 'first-year' } } });
  });
});

describe('ContractPolicyProvider', () => {
  it('prefers a course-specific policy over the level default', async () => {
    const provider = new ContractPolicyProvider([
      { id: 'fy', version: '0.1.0', level: 'first-year', maxDepth: 'hint', memory: { kind: 'session', sharing: 'private' }, maxResponseChars: 100, maxMaterial: 2 },
      { id: 'fy-strict', version: '0.1.0', level: 'first-year', maxDepth: 'redirect', memory: { kind: 'none', sharing: 'private' }, maxResponseChars: 100, maxMaterial: 2, courses: ['c9'] },
    ]);
    expect((await provider.policyFor('c1', 'first-year'))?.id).toBe('fy');
    expect(await provider.policyFor('c9', 'first-year')).not.toHaveProperty('courses');
    expect((await provider.policyFor('c9', 'first-year'))?.id).toBe('fy-strict');
  });

  it('rejects malformed or ambiguous policy data at load', () => {
    expect(() => new ContractPolicyProvider([{ id: 'x' }])).toThrow();
    const p = { id: 'a', version: '0.1.0', level: 'first-year', maxDepth: 'hint', memory: { kind: 'session', sharing: 'private' }, maxResponseChars: 1, maxMaterial: 1 };
    expect(() => new ContractPolicyProvider([p, { ...p, id: 'b' }])).toThrow(/more than one default/);
  });
});
