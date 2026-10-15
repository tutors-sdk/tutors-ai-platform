import {
  aLearner,
  aMaterial,
  aPolicy,
  FakeLanguageModel,
  FINAL_YEAR,
  FIRST_YEAR,
  FixedClock,
  InMemoryCourseContent,
  InMemoryEvidenceStore,
  InMemoryLearnerMemory,
  RecordingTelemetry,
  StaticPolicyProvider,
  type FakeLanguageModelOptions,
} from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import {
  AssistStudentService,
  evidenceRetention,
  PortError,
  type AssistanceRequest,
  type LearnerContext,
  type Material,
  type MaterialQuery,
  type PedagogicalPolicy,
} from '../src/index.ts';

const MATERIAL: readonly Material[] = [
  aMaterial('m1', { text: 'A while loop ends when its condition becomes false.' }),
  aMaterial('m2', { text: 'Use console.log to inspect a variable.' }),
  aMaterial('other-course', { courseId: 'course-2' }),
];

interface Setup {
  readonly model?: FakeLanguageModelOptions;
  readonly policies?: readonly PedagogicalPolicy[];
  readonly material?: readonly Material[];
}

function setup({ model, policies = [FIRST_YEAR, FINAL_YEAR], material = MATERIAL }: Setup = {}) {
  const clock = new FixedClock();
  const deps = {
    policies: new StaticPolicyProvider(policies),
    content: new InMemoryCourseContent(material),
    model: new FakeLanguageModel(model),
    memory: new InMemoryLearnerMemory(),
    evidence: new InMemoryEvidenceStore(clock),
    clock,
    telemetry: new RecordingTelemetry(),
    config: { source: 'inference-api', modelTimeoutMs: 1_000, memoryRecallLimit: 5 },
  };
  return { ...deps, service: new AssistStudentService(deps) };
}

const ask = (learner: Partial<LearnerContext> = {}, question = 'Why does my while loop never end?'): AssistanceRequest => ({
  learner: aLearner(learner),
  question,
});

describe('AssistStudent', () => {
  it('AS-001 refuses an empty question without consulting policy, material, model or evidence', async () => {
    const s = setup();
    const response = await s.service.assist(ask({}, '   '));
    expect(response).toEqual({
      kind: 'refused',
      reason: 'empty-question',
      trace: { bound: null, materialIds: [], model: null, promptVersion: null },
    });
    expect(s.model.requests).toHaveLength(0);
    expect(s.evidence.all).toHaveLength(0);
  });

  it('AS-002 refuses with no-policy when no policy exists for the course and level', async () => {
    const s = setup();
    const response = await s.service.assist(ask({ level: 'postgraduate' }));
    expect(response).toMatchObject({ kind: 'refused', reason: 'no-policy', trace: { bound: null } });
    expect(s.model.requests).toHaveLength(0);
  });

  it('AS-003 bounds memory by the narrower of the learner scope and the policy scope', async () => {
    const wide = setup();
    await wide.service.assist(ask({ memory: { kind: 'programme', sharing: 'cohort' } }));
    expect(wide.model.requests[0]?.bound.memory).toEqual({ kind: 'session', sharing: 'private' });

    const narrow = setup();
    await narrow.service.assist(ask({ level: 'final-year', memory: { kind: 'none', sharing: 'private' } }));
    expect(narrow.model.requests[0]?.bound.memory).toEqual({ kind: 'none', sharing: 'private' });
    expect(narrow.model.requests[0]?.bound).toMatchObject({ policyId: 'final-year', maxDepth: 'explanation' });
  });

  it('AS-004 retrieves material only from the learner course and lab, at most the policy limit', async () => {
    const many = Array.from({ length: 10 }, (_, i) => aMaterial(`m${i}`));
    const s = setup({ material: [...many, aMaterial('elsewhere', { labId: 'lab-9' })] });
    await s.service.assist(ask());
    const sent = s.model.requests[0]?.material ?? [];
    expect(sent).toHaveLength(FIRST_YEAR.maxMaterial);
    for (const m of sent) expect(m).toMatchObject({ courseId: 'course-1', labId: 'lab-1' });
  });

  it('AS-004 discards material from another course or beyond the limit even if an adapter returns it', async () => {
    const s = setup();
    const extra = Array.from({ length: 6 }, (_, i) => aMaterial(`x${i}`));
    const leaky = { retrieve: async () => [...MATERIAL, ...extra] };
    const service = new AssistStudentService({ ...s, content: leaky });
    const response = await service.assist(ask());
    expect(response.trace.materialIds).toEqual(['m1', 'm2', 'x0', 'x1']);
  });

  it('AS-004 asks for material by course, topic and lab, with the question as ranking text', async () => {
    const s = setup();
    const queries: MaterialQuery[] = [];
    const content = { retrieve: async (q: MaterialQuery) => (queries.push(q), MATERIAL) };
    const service = new AssistStudentService({ ...s, content });
    await service.assist(ask({ topicId: 'topic-1' }, 'loops?'));
    await service.assist({ learner: { ...aLearner(), labId: undefined as never }, question: 'q' });
    expect(queries[0]).toStrictEqual({ courseId: 'course-1', topicId: 'topic-1', labId: 'lab-1', text: 'loops?', limit: 4 });
    expect(queries[1]).toStrictEqual({ courseId: 'course-1', text: 'q', limit: 4 });
  });

  it('AS-004 refuses with no-material when nothing is retrieved, without calling the model', async () => {
    const s = setup({ material: [] });
    const response = await s.service.assist(ask());
    expect(response).toMatchObject({ kind: 'refused', reason: 'no-material' });
    expect(s.model.requests).toHaveLength(0);
  });

  it('AS-005 recalls memory under the bound scope, and not at all when the scope is none', async () => {
    const s = setup();
    await s.memory.remember(aLearner(), { kind: 'session', sharing: 'private' }, {
      question: 'earlier',
      answer: 'earlier answer',
      recordedAt: new Date('2026-10-15T08:00:00Z'),
    });
    await s.service.assist(ask());
    expect(s.model.requests[0]?.memory.map((e) => e.question)).toEqual(['earlier']);

    await s.service.assist(ask({ memory: { kind: 'none', sharing: 'private' } }));
    expect(s.model.requests[1]?.memory).toEqual([]);
  });

  it('AS-005 AS-015 never touches learner memory when the bound scope is none', async () => {
    const s = setup();
    const calls: string[] = [];
    const memory = {
      recall: async () => (calls.push('recall'), []),
      remember: async () => void calls.push('remember'),
      expire: async () => 0,
    };
    const service = new AssistStudentService({ ...s, memory });
    expect(await service.assist(ask({ memory: { kind: 'none', sharing: 'private' } }))).toMatchObject({ kind: 'answered' });
    expect(calls).toEqual([]);
  });

  it('AS-005 limits recalled memory to the configured recall limit', async () => {
    const s = setup();
    for (let i = 0; i < 8; i++) {
      await s.memory.remember(aLearner(), { kind: 'session', sharing: 'private' }, {
        question: `q${i}`,
        answer: 'a',
        recordedAt: new Date('2026-10-15T08:00:00Z'),
      });
    }
    await s.service.assist(ask());
    expect(s.model.requests[0]?.memory).toHaveLength(5);
  });

  it('AS-006 sends the question, material, bound, memory and configured timeout to the model', async () => {
    const s = setup();
    await s.service.assist(ask({}, 'How do I stop a loop?'));
    expect(s.model.requests[0]).toMatchObject({
      question: 'How do I stop a loop?',
      timeoutMs: 1_000,
      bound: { policyId: 'first-year', policyVersion: '0.1.0', maxDepth: 'hint', maxResponseChars: 600 },
    });
  });

  it('AS-007 refuses with model-unavailable when the model fails with a port error', async () => {
    const s = setup({ model: { unavailable: true } });
    const response = await s.service.assist(ask());
    expect(response).toMatchObject({ kind: 'refused', reason: 'model-unavailable', trace: { materialIds: ['m1', 'm2'] } });
  });

  it('AS-007 refuses with model-unavailable on timeout', async () => {
    const s = setup({ model: { latencyMs: 5_000 } });
    const service = new AssistStudentService({ ...s, config: { ...s.config, modelTimeoutMs: 5 } });
    expect(await service.assist(ask())).toMatchObject({ kind: 'refused', reason: 'model-unavailable' });
  });

  it('AS-007 lets non-port errors propagate rather than hiding defects as refusals', async () => {
    const s = setup();
    const broken = { complete: async () => Promise.reject(new TypeError('bug')), stream: s.model.stream };
    const service = new AssistStudentService({ ...s, model: broken });
    await expect(service.assist(ask())).rejects.toThrow(TypeError);
  });

  it('AS-008 refuses when the model answers deeper than the bound allows', async () => {
    const s = setup({ model: { reply: () => ({ depth: 'explanation' }) } });
    expect(await s.service.assist(ask())).toMatchObject({ kind: 'refused', reason: 'depth-exceeded' });
  });

  it('AS-008 accepts an answer at or below the bound', async () => {
    const atBound = setup({ model: { reply: () => ({ depth: 'hint' }) } });
    expect(await atBound.service.assist(ask())).toMatchObject({ kind: 'answered', depth: 'hint' });
    const below = setup({ model: { reply: () => ({ depth: 'redirect' }) } });
    expect(await below.service.assist(ask())).toMatchObject({ kind: 'answered', depth: 'redirect' });
    const finalYear = setup({ model: { reply: () => ({ depth: 'explanation' }) } });
    expect(await finalYear.service.assist(ask({ level: 'final-year' }))).toMatchObject({ kind: 'answered' });
  });

  it('AS-009 refuses an answer that cites nothing', async () => {
    const s = setup({ model: { reply: () => ({ citations: [] }) } });
    expect(await s.service.assist(ask())).toMatchObject({ kind: 'refused', reason: 'no-citation' });
  });

  it('AS-010 refuses an answer that cites material outside the retrieved set', async () => {
    const s = setup({ model: { reply: () => ({ citations: ['m1', 'other-course'] }) } });
    expect(await s.service.assist(ask())).toMatchObject({ kind: 'refused', reason: 'citation-outside-material' });
  });

  it('AS-011 truncates a response longer than the policy allows and says so', async () => {
    const long = 'x'.repeat(FIRST_YEAR.maxResponseChars + 1);
    const s = setup({ model: { reply: () => ({ text: long }) } });
    const response = await s.service.assist(ask());
    expect(response).toMatchObject({ kind: 'answered', truncated: true });
    if (response.kind === 'answered') expect(response.text).toHaveLength(FIRST_YEAR.maxResponseChars);

    const exact = setup({ model: { reply: () => ({ text: long.slice(1) }) } });
    expect(await exact.service.assist(ask())).toMatchObject({ kind: 'answered', truncated: false });
  });

  it('AS-012 traces the bound, material, model digest and prompt version on every answer', async () => {
    const s = setup({ model: { reply: () => ({ promptVersion: 'assist-v3' }) } });
    const response = await s.service.assist(ask());
    expect(response.trace).toEqual({
      bound: {
        policyId: 'first-year',
        policyVersion: '0.1.0',
        maxDepth: 'hint',
        maxResponseChars: 600,
        memory: { kind: 'session', sharing: 'private' },
      },
      materialIds: ['m1', 'm2'],
      model: expect.objectContaining({ name: 'fake-model' }),
      promptVersion: 'assist-v3',
    });
  });

  it('AS-012 traces what was known when a refusal happened after the model replied', async () => {
    const s = setup({ model: { reply: () => ({ depth: 'explanation', promptVersion: 'p9' }) } });
    const response = await s.service.assist(ask());
    expect(response.trace).toMatchObject({ promptVersion: 'p9', model: { name: 'fake-model' }, materialIds: ['m1', 'm2'] });
  });

  it('AS-013 records the request and the assistance given, with depth, policy and model', async () => {
    const s = setup();
    await s.service.assist(ask());
    expect(s.evidence.all.map((e) => e.type)).toEqual(['assistance-requested', 'assistance-given']);
    expect(s.evidence.all[0]).toMatchObject({
      learnerId: 'learner-1',
      sessionId: 'session-1',
      courseId: 'course-1',
      labId: 'lab-1',
      source: 'inference-api',
      confidence: 1,
      observedAt: new Date('2026-10-15T09:00:00Z'),
      detail: { outcome: 'answered' },
    });
    expect(s.evidence.all[1]).toMatchObject({
      depth: 'hint',
      detail: { policyVersion: '0.1.0', modelDigest: expect.stringMatching(/^sha256:/) },
    });
  });

  it('AS-013 records a refused request with its reason and no assistance given', async () => {
    const s = setup({ model: { reply: () => ({ depth: 'explanation' }) } });
    await s.service.assist(ask());
    expect(s.evidence.all).toHaveLength(1);
    expect(s.evidence.all[0]).toMatchObject({
      type: 'assistance-requested',
      detail: { outcome: 'refused', reason: 'depth-exceeded' },
    });
    const noPolicy = setup();
    await noPolicy.service.assist(ask({ level: 'unknown' }));
    expect(noPolicy.evidence.all[0]).toMatchObject({ detail: { outcome: 'refused', reason: 'no-policy' } });
  });

  it('AS-014 keeps evidence for the bound memory scope, and for the session when memory is none', async () => {
    expect(evidenceRetention('none')).toBe('session');
    expect(evidenceRetention('session')).toBe('session');
    expect(evidenceRetention('course')).toBe('course');
    expect(evidenceRetention('programme')).toBe('programme');
    const s = setup();
    await s.service.assist(ask({ level: 'final-year', memory: { kind: 'programme', sharing: 'private' } }));
    expect(s.evidence.all.map((e) => e.retention)).toEqual(['course', 'course']);
  });

  it('AS-015 remembers the answered exchange under the bound scope', async () => {
    const s = setup({ model: { reply: () => ({ text: 'Check the loop condition.' }) } });
    await s.service.assist(ask({}, 'Why?'));
    expect(s.memory.all).toEqual([
      expect.objectContaining({ question: 'Why?', answer: 'Check the loop condition.', sharing: 'private', sessionId: 'session-1' }),
    ]);
  });

  it('AS-015 remembers nothing when the bound scope is none or the request is refused', async () => {
    const none = setup();
    await none.service.assist(ask({ memory: { kind: 'none', sharing: 'private' } }));
    expect(none.memory.all).toEqual([]);
    const refused = setup({ model: { reply: () => ({ citations: [] }) } });
    await refused.service.assist(ask());
    expect(refused.memory.all).toEqual([]);
  });

  it('AS-015 remembers the truncated text, not the full model output', async () => {
    const s = setup({ model: { reply: () => ({ text: 'y'.repeat(700) }) } });
    await s.service.assist(ask());
    expect(s.memory.all[0]?.answer).toHaveLength(600);
  });

  it('AS-016 fails the request rather than return an answer it could not record', async () => {
    const s = setup();
    s.evidence.failAppends = true;
    await expect(s.service.assist(ask())).rejects.toThrow('evidence store unavailable');
    expect(s.memory.all).toEqual([]);
    expect(s.telemetry.spans[0]?.outcome).toBe('error');
  });

  it('AS-017 emits one span per request with the outcome, policy and model attributes', async () => {
    const s = setup();
    await s.service.assist(ask());
    await s.service.assist(ask({}, ''));
    const [answered, refused] = s.telemetry.spans;
    expect(answered).toMatchObject({
      name: 'AssistStudent',
      outcome: 'ok',
      attributes: {
        'learner.level': 'first-year',
        'course.id': 'course-1',
        'assist.outcome': 'answered',
        'assist.depth': 'hint',
        'policy.version': '0.1.0',
        'model.digest': expect.stringMatching(/^sha256:/),
        'model.tokens.in': expect.any(Number),
        'model.tokens.out': expect.any(Number),
      },
    });
    expect(refused).toMatchObject({ outcome: 'ok', attributes: { 'assist.outcome': 'refused', 'assist.refusal': 'empty-question' } });
  });

  it('works without a telemetry adapter', async () => {
    const s = setup();
    const { telemetry: _unused, ...rest } = s;
    const service = new AssistStudentService(rest);
    expect(await service.assist(ask())).toMatchObject({ kind: 'answered' });
  });

  it('prefers a course-specific policy over the level default', async () => {
    const s = setup();
    const strict = aPolicy({ id: 'strict', maxDepth: 'redirect' });
    const service = new AssistStudentService({
      ...s,
      policies: new StaticPolicyProvider([FIRST_YEAR], { 'course-1': strict }),
    });
    expect(await service.assist(ask())).toMatchObject({ kind: 'refused', reason: 'depth-exceeded' });
  });

  it('treats a PortError from the model as a refusal even when thrown synchronously in a promise chain', async () => {
    const s = setup();
    const failing = {
      complete: async () => {
        throw new PortError('LanguageModel', 'invalid-response', 'bad json');
      },
      stream: s.model.stream,
    };
    const service = new AssistStudentService({ ...s, model: failing });
    expect(await service.assist(ask())).toMatchObject({ kind: 'refused', reason: 'model-unavailable' });
  });
});
