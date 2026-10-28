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
  fromAssistResponse,
  toAssistResponse,
  toGoldenSet,
  toInsightsResponse,
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
    expect(toAssistResponse(answered).trace.policy).toEqual({
      id: 'first-year',
      version: '0.1.0',
      maxDepth: 'hint',
      maxResponseChars: 600,
      memory: { kind: 'session', sharing: 'private' },
    });
    for (const r of [answered, refused]) expect(fromAssistResponse(JSON.parse(JSON.stringify(toAssistResponse(r))))).toEqual(r);
    expect(() => fromAssistResponse({ ...toAssistResponse(refused), reason: 'bored' })).toThrow(ContractViolation);
  });

  it('reads a golden set, leaving absent optionals absent', () => {
    const set = toGoldenSet({
      id: 'first-year',
      version: '1',
      level: 'first-year',
      cases: [
        { id: 'c1', learner: wireRequest.learner, question: 'Why?', expected: { kind: 'answered', maxDepth: 'hint', citations: ['m1'] } },
        { id: 'c2', learner: wireRequest.learner, question: 'Solve it for me', expected: { kind: 'refused' } },
      ],
    });
    expect(set.cases.map((c) => c.expected.kind)).toEqual(['answered', 'refused']);
    expect(Object.keys(set.cases[0]?.learner ?? {})).not.toContain('topicId');
    expect(() => toGoldenSet({ id: 'x', version: '1', level: 'first-year', cases: [{ id: 'c' }] })).toThrow(ContractViolation);
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

  it('maps an insights run to the wire, with an empty response before the first run', () => {
    const insight = {
      id: 'help-hotspot:c1:lab-1',
      type: 'help-hotspot',
      courseId: 'c1',
      labId: 'lab-1',
      claim: '6 of 10 learners asked for help in lab-1',
      producedBy: 'rule' as const,
      evidence: { sequences: [1, 2], learners: 6, byType: { 'assistance-requested': 2 } },
      reasoning: 'r',
    };
    const wire = toInsightsResponse('c1', {
      courseId: 'c1',
      producedAt: new Date('2026-10-15T02:00:00Z'),
      insights: [insight],
      recommendations: [{ id: 'PED-2:x', suggestion: 's', insight, rule: { id: 'PED-2', statement: 'st' } }],
    });
    expect(contract.InsightsResponse.parse(wire)).toEqual(wire);
    expect(wire.producedAt).toBe('2026-10-15T02:00:00.000Z');
    expect(toInsightsResponse('c2', null)).toEqual({ contractVersion: CONTRACT_VERSION, courseId: 'c2', producedAt: null, insights: [], recommendations: [] });
    expect(() => contract.Insight.parse({ ...insight, evidence: { ...insight.evidence, sequences: [] } })).toThrow();
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

  const withTools = (grants: unknown[]) => ({
    id: 'fy',
    version: '0.1.0',
    level: 'first-year',
    maxDepth: 'hint',
    memory: { kind: 'session', sharing: 'private' },
    maxResponseChars: 100,
    maxMaterial: 2,
    tools: { grants, maxCalls: 3, callTimeoutMs: 2_000, exchangeBudgetMs: 8_000, maxArgumentChars: 1_000, maxResultChars: 4_000 },
  });
  const grant = { server: 'docs', tool: 'search', digest: `sha256:${'0'.repeat(64)}` };

  it('HAR-001 carries a policy’s tool grants and limits through, and none when the policy has none', async () => {
    const provider = new ContractPolicyProvider([withTools([grant])]);
    expect((await provider.policyFor('c1', 'first-year'))?.tools).toEqual(withTools([grant]).tools);
    expect(await new ContractPolicyProvider().policyFor('c1', 'first-year')).not.toHaveProperty('tools');
  });

  it('HAR-004 rejects a grant without a full SHA-256 digest, a duplicate grant, or an unknown field at load', () => {
    expect(() => new ContractPolicyProvider([withTools([{ ...grant, digest: 'sha256:abc' }])])).toThrow();
    expect(() => new ContractPolicyProvider([withTools([{ ...grant, digest: grant.digest.toUpperCase() }])])).toThrow();
    expect(() => new ContractPolicyProvider([withTools([grant, { ...grant }])])).toThrow(/only once/);
    expect(() => new ContractPolicyProvider([withTools([{ ...grant, readOnly: true }])])).toThrow();
    expect(() => new ContractPolicyProvider([{ ...withTools([]), tools: { ...withTools([]).tools, maxCalls: 0 } }])).toThrow();
  });
});
