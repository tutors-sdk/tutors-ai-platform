import { aLearner, aMaterial, FakeLanguageModel, FIRST_YEAR, FixedClock, StaticPolicyProvider, InMemoryCourseContent, InMemoryEvidenceStore, InMemoryLearnerMemory } from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import {
  AssistStudentService,
  drift,
  EvaluateCapabilityService,
  type AnswerJudge,
  type AssistanceRequest,
  type AssistanceResponse,
  type EvaluationReport,
  type GoldenCase,
  type GoldenSet,
} from '../src/index.ts';

const bound = { policyId: 'first-year', policyVersion: '0.1.0', maxDepth: 'hint', maxResponseChars: 100, memory: { kind: 'session', sharing: 'private' } } as const;
const model = { name: 'm', digest: 'sha256:aaa' };

function answered(over: Partial<Extract<AssistanceResponse, { kind: 'answered' }>> = {}): AssistanceResponse {
  return {
    kind: 'answered',
    depth: 'hint',
    text: 'Look at the loop condition.',
    citations: ['m1'],
    truncated: false,
    trace: { bound, materialIds: ['m1', 'm2'], model, promptVersion: 'p1' },
    ...over,
  };
}

const refused: AssistanceResponse = { kind: 'refused', reason: 'no-material', trace: { bound, materialIds: [], model: null, promptVersion: null } };

function aCase(id: string, over: Partial<GoldenCase> = {}): GoldenCase {
  return { id, learner: aLearner(), question: `question ${id}`, expected: { kind: 'answered', maxDepth: 'hint', citations: ['m1'] }, ...over };
}

function harness(reply: (req: AssistanceRequest) => AssistanceResponse | Promise<AssistanceResponse>, opts: { latencyMs?: number; judges?: AnswerJudge[] } = {}) {
  const clock = new FixedClock();
  const requests: AssistanceRequest[] = [];
  const service = new EvaluateCapabilityService({
    assist: {
      assist: async (req) => {
        requests.push(req);
        clock.advance(opts.latencyMs ?? 10);
        return reply(req);
      },
    },
    clock,
    ...(opts.judges === undefined ? {} : { judges: opts.judges }),
    config: { maxLatencyMs: 1_000 },
  });
  return { service, requests };
}

const set = (...cases: GoldenCase[]): GoldenSet => ({ id: 'first-year', version: '1', cases });
const failuresOf = (report: EvaluationReport) => report.results.map((r) => r.failures.map((f) => `${f.judge}: ${f.message}`));

describe('EvaluateCapability', () => {
  it('EC-001 drives every case through AssistStudent exactly as a student request would be', async () => {
    const clock = new FixedClock();
    const evidence = new InMemoryEvidenceStore(clock);
    const assist = new AssistStudentService({
      policies: new StaticPolicyProvider([FIRST_YEAR]),
      content: new InMemoryCourseContent([aMaterial('m1', { courseId: 'course-1' })]),
      model: new FakeLanguageModel(),
      memory: new InMemoryLearnerMemory(),
      evidence,
      clock,
      config: { source: 'evaluation', modelTimeoutMs: 1_000, memoryRecallLimit: 5 },
    });
    const service = new EvaluateCapabilityService({ assist, clock, config: { maxLatencyMs: 1_000 } });
    const report = await service.evaluate(set(aCase('c1', { learner: aLearner({ level: 'first-year' }) }), aCase('c2', { learner: aLearner({ level: 'first-year' }) })));
    expect(report.results.map((r) => [r.caseId, r.outcome, r.passed])).toEqual([
      ['c1', 'answered', true],
      ['c2', 'answered', true],
    ]);
    expect(evidence.all.filter((e) => e.type === 'assistance-requested')).toHaveLength(2);

    const h = harness(() => answered());
    const c = aCase('c1');
    await h.service.evaluate(set(c));
    expect(h.requests).toEqual([{ learner: c.learner, question: c.question }]);
  });

  it('EC-002 records the model, prompt version, policy versions and golden set version', async () => {
    const h = harness((req) =>
      req.question.endsWith('c1')
        ? refused
        : answered({ trace: { bound: { ...bound, policyId: req.question.endsWith('c3') ? 'final-year' : 'first-year' }, materialIds: ['m1'], model, promptVersion: 'p1' } }),
    );
    const report = await h.service.evaluate({ id: 'gs', version: '7', cases: [aCase('c1', { expected: { kind: 'refused' } }), aCase('c2'), aCase('c3')] });
    expect(report).toMatchObject({
      goldenSet: { id: 'gs', version: '7' },
      model,
      promptVersion: 'p1',
      policyVersions: ['final-year@0.1.0', 'first-year@0.1.0'],
      startedAt: '2026-10-15T09:00:00.000Z',
      passed: true,
      drift: null,
    });
    const none = await harness(() => refused).service.evaluate(set(aCase('c1', { expected: { kind: 'refused' } })));
    expect(none).toMatchObject({ model: null, promptVersion: null, policyVersions: ['first-year@0.1.0'] });
    expect(drift(none, none).changed).toEqual([]);
    const unbound = await harness(() => ({ ...refused, trace: { ...refused.trace, bound: null } })).service.evaluate(set(aCase('c1', { expected: { kind: 'refused' } })));
    expect(unbound.policyVersions).toEqual([]);
  });

  it('EC-003 judges the bound: outcome, expected depth, policy depth and length', async () => {
    const cases = [
      aCase('kind', { expected: { kind: 'refused' } }),
      aCase('expected-depth', { expected: { kind: 'answered', maxDepth: 'redirect', citations: [] } }),
      aCase('policy-depth', { expected: { kind: 'answered', maxDepth: 'explanation', citations: [] } }),
      aCase('length'),
      aCase('unbound'),
      aCase('refused-ok', { expected: { kind: 'refused' } }),
    ];
    const replies: Record<string, AssistanceResponse> = {
      'question kind': answered(),
      'question expected-depth': answered(),
      'question policy-depth': answered({ depth: 'explanation' }),
      'question length': answered({ text: 'x'.repeat(101) }),
      'question unbound': answered({ trace: { bound: null, materialIds: ['m1'], model, promptVersion: 'p1' } }),
      'question refused-ok': refused,
    };
    const report = await harness((req) => replies[req.question] as AssistanceResponse).service.evaluate(set(...cases));
    expect(failuresOf(report)).toEqual([
      ['bound: expected refused, got answered'],
      ['bound: depth hint exceeds expected redirect'],
      ['bound: depth explanation exceeds policy hint'],
      ['bound: 101 chars exceeds 100'],
      ['bound: answered without a bound'],
      [],
    ]);
    expect(report.passed).toBe(false);
    const exact = await harness(() => answered({ text: 'x'.repeat(100) })).service.evaluate(set(aCase('c')));
    expect(exact.passed).toBe(true);
  });

  it('EC-003 judges citations: only retrieved material, and every expected citation', async () => {
    const report = await harness(() => answered({ citations: ['m3'] })).service.evaluate(set(aCase('c', { expected: { kind: 'answered', maxDepth: 'hint', citations: ['m1'] } })));
    expect(failuresOf(report)).toEqual([['citation: cites m3, which was not retrieved', 'citation: does not cite expected m1']]);
    const refusal = await harness(() => refused).service.evaluate(set(aCase('c')));
    expect(failuresOf(refusal)).toEqual([['bound: expected answered, got refused']]);
  });

  it('EC-003 judges memory: never wider than requested, never shared when private', async () => {
    const wide = answered({ trace: { bound: { ...bound, memory: { kind: 'course', sharing: 'cohort' } }, materialIds: ['m1'], model, promptVersion: 'p1' } });
    const report = await harness(() => wide).service.evaluate(set(aCase('c', { learner: aLearner({ memory: { kind: 'session', sharing: 'private' } }) })));
    expect(failuresOf(report)).toEqual([['memory: memory course is wider than requested session', 'memory: shares memory the learner kept private']]);
    const same = await harness(() => wide).service.evaluate(set(aCase('c', { learner: aLearner({ memory: { kind: 'course', sharing: 'cohort' } }) })));
    expect(same.passed).toBe(true);
    const unbound = await harness(() => ({ ...refused, trace: { ...refused.trace, bound: null } })).service.evaluate(set(aCase('c', { expected: { kind: 'refused' } })));
    expect(unbound.passed).toBe(true);
  });

  it('EC-003 judges latency, and records an error as a failed case without stopping the run', async () => {
    const slow = await harness(() => answered(), { latencyMs: 1_001 }).service.evaluate(set(aCase('c')));
    expect(failuresOf(slow)).toEqual([['latency: 1001ms exceeds 1000ms']]);
    expect(slow.results[0]?.latencyMs).toBe(1_001);
    const atLimit = await harness(() => answered(), { latencyMs: 1_000 }).service.evaluate(set(aCase('c')));
    expect(atLimit.passed).toBe(true);
    const report = await harness((req) => {
      if (req.question.endsWith('boom')) throw new Error('kaput');
      if (req.question.endsWith('odd')) throw 'odd';
      return answered();
    }).service.evaluate(set(aCase('boom'), aCase('odd'), aCase('fine')));
    expect(report.results.map((r) => [r.caseId, r.outcome, r.passed, r.latencyMs, r.scores])).toEqual([
      ['boom', 'error', false, 10, []],
      ['odd', 'error', false, 10, []],
      ['fine', 'answered', true, 10, []],
    ]);
    expect(failuresOf(report).slice(0, 2)).toEqual([['error: kaput'], ['error: odd']]);
  });

  it('EC-004 reports an uncalibrated model judge without gating, and gates a calibrated one', async () => {
    const judge = (id: string, calibrated: boolean, score: number, threshold?: number): AnswerJudge => ({
      id,
      calibrated,
      ...(threshold === undefined ? {} : { threshold }),
      score: async () => score,
    });
    const report = await harness(() => answered(), {
      judges: [judge('tone', false, 0.1, 0.9), judge('clarity', true, 0.5, 0.6), judge('noThreshold', true, 0.2), judge('ok', true, 0.6, 0.6)],
    }).service.evaluate(set(aCase('c')));
    expect(report.results[0]?.scores).toEqual([
      { judge: 'tone', score: 0.1, gating: false },
      { judge: 'clarity', score: 0.5, gating: true },
      { judge: 'noThreshold', score: 0.2, gating: false },
      { judge: 'ok', score: 0.6, gating: true },
    ]);
    expect(failuresOf(report)).toEqual([['answer:clarity: scored 0.5, below 0.6']]);
  });

  it('EC-005 reports drift case by case against the previous accepted run', async () => {
    const previous = await harness((req) => (req.question.endsWith('b') || req.question.endsWith('c') ? refused : answered())).service.evaluate({
      id: 'gs',
      version: '1',
      cases: [aCase('a'), aCase('b'), aCase('c'), aCase('gone')],
    });
    const changedModel = { name: 'm', digest: 'sha256:bbb' };
    const h = harness((req) => (req.question.endsWith('a') || req.question.endsWith('c') ? refused : answered({ trace: { bound: { ...bound, policyVersion: '0.2.0' }, materialIds: ['m1'], model: changedModel, promptVersion: 'p2' } })));
    const report = await h.service.evaluate({ id: 'gs', version: '2', cases: [aCase('a'), aCase('b'), aCase('c'), aCase('new')] }, previous);
    expect(report.drift).toEqual({
      changed: ['model', 'prompt', 'policy', 'golden-set'],
      cases: [
        { caseId: 'a', drift: 'regressed' },
        { caseId: 'b', drift: 'fixed' },
        { caseId: 'c', drift: 'still-failing' },
        { caseId: 'new', drift: 'new' },
        { caseId: 'gone', drift: 'removed' },
      ],
      regressions: 1,
    });
    expect(drift(previous, previous)).toEqual({
      changed: [],
      cases: [
        { caseId: 'a', drift: 'still-passing' },
        { caseId: 'b', drift: 'still-failing' },
        { caseId: 'c', drift: 'still-failing' },
        { caseId: 'gone', drift: 'still-passing' },
      ],
      regressions: 0,
    });
  });
});
