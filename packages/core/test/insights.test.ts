import { anEvidence, FixedClock, InMemoryEvidenceStore } from '@tutors-ai/testing';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSIGHT_THRESHOLDS,
  DomainRuleViolation,
  ExplainLabInsightsService,
  PEDAGOGICAL_RULES,
  RecommendInterventionsService,
  summarise,
  type EvidenceStore,
  type ExplainLabInsights,
  type Insight,
  type ModelInsightSource,
  type NewEvidence,
} from '../src/index.ts';

const learners = (n: number, prefix = 'l') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/**
 * lab-1: 10 learners. 6 stop at step 02, 4 reach 03. 6 ask for help, 3 demonstrate the outcome,
 * 4 of 6 answers are full explanations. lab-2: 3 learners, too few to describe.
 */
async function cohort(extra: (e: (o: Partial<NewEvidence>) => Promise<void>) => Promise<void> = async () => undefined) {
  const store = new InMemoryEvidenceStore(new FixedClock());
  const e = async (o: Partial<NewEvidence>) => void (await store.append(anEvidence(o)));
  const all = learners(10);
  for (const [i, learnerId] of all.entries()) {
    await e({ learnerId, type: 'lab-opened' });
    await e({ learnerId, type: 'step-reached', stepId: '01' });
    await e({ learnerId, type: 'step-reached', stepId: '02' });
    if (i >= 6) await e({ learnerId, type: 'step-reached', stepId: '03' });
    if (i < 6) await e({ learnerId, type: 'assistance-requested', stepId: '02' });
    if (i < 6) await e({ learnerId, type: 'assistance-given', depth: i < 4 ? 'explanation' : 'hint' });
    if (i >= 7) await e({ learnerId, type: 'outcome-demonstrated' });
  }
  for (const learnerId of learners(3, 'x')) await e({ learnerId, labId: 'lab-2', type: 'lab-opened' });
  const { labId: _labId, ...noLab } = anEvidence({ learnerId: 'l0', type: 'step-reached', stepId: '05' });
  await store.append(noLab);
  await extra(e);
  return store;
}

const types = (insights: readonly Insight[]) => insights.map((i) => i.type);

describe('ExplainLabInsights', () => {
  it('ELI-001 attaches the evidence and the reasoning to every insight', async () => {
    const insights = await new ExplainLabInsightsService({ evidence: await cohort() }).explain({ courseId: 'course-1', granularity: 'cohort' });
    expect(types(insights)).toEqual(['stalled-step', 'help-hotspot', 'low-completion', 'explanation-reliance']);
    const [stall, help, completion, reliance] = insights;
    expect(stall).toEqual({
      id: 'stalled-step:course-1:lab-1:02',
      type: 'stalled-step',
      courseId: 'course-1',
      labId: 'lab-1',
      stepId: '02',
      claim: '6 of 10 learners stopped at step 02 of lab-1',
      producedBy: 'rule',
      evidence: { sequences: expect.any(Array), learners: 6, byType: { 'step-reached': 6 } },
      reasoning: '60% of learners who reached any step got no further than 02, against a threshold of 40%; the lab goes on to step 03.',
    });
    expect(help).toMatchObject({
      id: 'help-hotspot:course-1:lab-1',
      claim: '6 of 10 learners asked for help in lab-1',
      evidence: { sequences: expect.any(Array), learners: 6, byType: { 'assistance-requested': 6 } },
      reasoning: '60% of the lab\'s learners requested assistance (6 requests), against a threshold of 50%.',
    });
    expect(help).not.toHaveProperty('stepId');
    expect(completion?.evidence.byType).toEqual({ 'lab-opened': 10, 'outcome-demonstrated': 3 });
    expect(help?.evidence.byType).toEqual({ 'assistance-requested': 6 });
    expect(reliance?.evidence.byType).toEqual({ 'assistance-given': 6 });
    expect(completion).toMatchObject({
      claim: '3 of 10 learners demonstrated the outcome of lab-1',
      evidence: { sequences: expect.any(Array), learners: 10, byType: { 'lab-opened': 10, 'outcome-demonstrated': 3 } },
      reasoning: '30% of the lab\'s learners demonstrated its outcome, below a threshold of 50%.',
    });
    expect(reliance).toMatchObject({
      claim: '4 of 6 answers in lab-1 were full explanations',
      evidence: { sequences: expect.any(Array), learners: 6, byType: { 'assistance-given': 6 } },
      reasoning: '67% of assistance given in the lab was at explanation depth, against a threshold of 50%.',
    });
    for (const i of insights) expect(i.evidence.sequences.length).toBeGreaterThan(0);
  });

  it('ELI-001 raises no insight when the lab is healthy', async () => {
    const store = new InMemoryEvidenceStore(new FixedClock());
    for (const learnerId of learners(5)) {
      await store.append(anEvidence({ learnerId, type: 'step-reached', stepId: '01' }));
      await store.append(anEvidence({ learnerId, type: 'outcome-demonstrated' }));
    }
    expect(await new ExplainLabInsightsService({ evidence: store }).explain({ courseId: 'course-1', granularity: 'cohort' })).toEqual([]);
  });

  it('ELI-001 applies each threshold at its boundary', async () => {
    const evidence = await cohort();
    const at = (o: Partial<typeof DEFAULT_INSIGHT_THRESHOLDS>) =>
      new ExplainLabInsightsService({ evidence, thresholds: { ...DEFAULT_INSIGHT_THRESHOLDS, ...o } }).explain({ courseId: 'course-1', granularity: 'cohort' });
    expect(types(await at({ stallShare: 0.6, helpShare: 0.6, completionShare: 0.3, explanationShare: 4 / 6 }))).toEqual([
      'stalled-step',
      'help-hotspot',
      'explanation-reliance',
    ]);
    expect(types(await at({ stallShare: 0.61, helpShare: 0.61, completionShare: 0.31, explanationShare: 0.67 }))).toEqual(['low-completion']);
    expect(types(await at({ minCohort: 6 }))).toEqual(['stalled-step', 'help-hotspot', 'low-completion', 'explanation-reliance']);
    expect(types(await at({ minCohort: 7 }))).toEqual(['low-completion']);
    expect(types(await at({ minCohort: 11 }))).toEqual([]);
  });

  it('ELI-001 finds the furthest step whatever order the evidence arrives in, and never calls the last step a stall', async () => {
    const store = new InMemoryEvidenceStore(new FixedClock());
    for (const learnerId of learners(5)) {
      await store.append(anEvidence({ learnerId, type: 'step-reached', stepId: '02' }));
      await store.append(anEvidence({ learnerId, type: 'step-reached', stepId: '01' }));
      await store.append(anEvidence({ learnerId, type: 'step-reached' }));
      await store.append(anEvidence({ learnerId, type: 'outcome-demonstrated' }));
    }
    await store.append(anEvidence({ learnerId: 'no-step', type: 'step-reached' }));
    await store.append(anEvidence({ learnerId: 'no-step', type: 'outcome-demonstrated' }));
    for (const learnerId of learners(5, 'y')) {
      await store.append(anEvidence({ learnerId, type: 'step-reached', stepId: '01' }));
      await store.append(anEvidence({ learnerId, type: 'assistance-requested', stepId: '03' }));
      await store.append(anEvidence({ learnerId, type: 'outcome-demonstrated' }));
    }
    const insights = await new ExplainLabInsightsService({ evidence: store }).explain({ courseId: 'course-1', granularity: 'cohort' });
    expect(insights.map((i) => [i.type, i.stepId, i.claim])).toEqual([['stalled-step', '01', '5 of 10 learners stopped at step 01 of lab-1']]);
    expect(insights[0]?.evidence.byType).toEqual({ 'step-reached': 5 });
  });

  it('ELI-001 bases low completion on the whole lab when nobody opened it or demonstrated anything', async () => {
    const store = new InMemoryEvidenceStore(new FixedClock());
    for (const learnerId of learners(5)) await store.append(anEvidence({ learnerId, type: 'assistance-given', depth: 'hint' }));
    const [low] = await new ExplainLabInsightsService({ evidence: store }).explain({ courseId: 'course-1', granularity: 'cohort' });
    expect(low).toMatchObject({ type: 'low-completion', evidence: { learners: 5, byType: { 'assistance-given': 5 } } });
  });

  it('ELI-002 ELI-003 ELI-004 keeps only evidenced, harness-passed model insights, labelled as model-produced', async () => {
    const evidence = await cohort();
    const records = await evidence.read({ courseId: 'course-1', labId: 'lab-1' });
    const seq = (n: number) => records.filter((r) => r.type === 'lab-opened').slice(0, n).map((r) => r.sequence);
    const seen: unknown[] = [];
    const source: ModelInsightSource = {
      propose: async (courseId, labs) => {
        seen.push({ courseId, labs });
        return [
          { type: 'pacing', labId: 'lab-1', stepId: '02', claim: 'Pacing is uneven', reasoning: 'r1', evidenceSequences: seq(6) },
          { type: 'pacing', claim: 'Course pacing', reasoning: 'r2', evidenceSequences: [...seq(5)].reverse() },
          { type: 'pacing', labId: 'lab-1', claim: 'No evidence', reasoning: 'r3', evidenceSequences: [] },
          { type: 'pacing', labId: 'lab-1', claim: 'Invented evidence', reasoning: 'r4', evidenceSequences: [...seq(5), 99_999] },
          { type: 'pacing', labId: 'lab-1', claim: 'Too few learners', reasoning: 'r5', evidenceSequences: seq(4) },
          { type: 'mood', labId: 'lab-1', claim: 'Unevaluated type', reasoning: 'r6', evidenceSequences: seq(6) },
        ];
      },
    };
    const service = new ExplainLabInsightsService({ evidence, model: { source, passedTypes: ['pacing'] } });
    const model = (await service.explain({ courseId: 'course-1', granularity: 'cohort' })).slice(4);
    expect(model).toStrictEqual([
      {
        id: 'model:pacing:course-1:lab-1:02',
        type: 'pacing',
        courseId: 'course-1',
        labId: 'lab-1',
        stepId: '02',
        claim: 'Pacing is uneven',
        producedBy: 'model',
        evidence: { sequences: seq(6), learners: 6, byType: { 'lab-opened': 6 } },
        reasoning: 'r1',
      },
      {
        id: 'model:pacing:course-1',
        type: 'pacing',
        courseId: 'course-1',
        claim: 'Course pacing',
        producedBy: 'model',
        evidence: { sequences: seq(5), learners: 5, byType: { 'lab-opened': 5 } },
        reasoning: 'r2',
      },
    ]);
    expect(seen).toEqual([
      {
        courseId: 'course-1',
        labs: [
          {
            labId: 'lab-1',
            learners: 10,
            byType: { 'lab-opened': 10, 'step-reached': 24, 'assistance-requested': 6, 'assistance-given': 6, 'outcome-demonstrated': 3 },
            furthestStep: { '02': 6, '03': 4 },
          },
        ],
      },
    ]);
  });

  it('ELI-002 rejects a model insight with no evidence or unknown evidence even when no cohort minimum applies', async () => {
    const evidence = await cohort();
    const [first] = await evidence.read({ courseId: 'course-1' });
    const source: ModelInsightSource = {
      propose: async () => [
        { type: 't', claim: 'none', reasoning: 'r', evidenceSequences: [] },
        { type: 't', claim: 'unknown', reasoning: 'r', evidenceSequences: [123_456] },
        { type: 't', claim: 'real', reasoning: 'r', evidenceSequences: [first?.sequence ?? 0] },
      ],
    };
    const service = new ExplainLabInsightsService({ evidence, thresholds: { ...DEFAULT_INSIGHT_THRESHOLDS, minCohort: 0 }, model: { source, passedTypes: ['t'] } });
    const model = (await service.explain({ courseId: 'course-1', granularity: 'cohort' })).filter((i) => i.producedBy === 'model');
    expect(model.map((i) => i.claim)).toEqual(['real']);
  });

  it('ELI-003 keeps the rule insights when the model source fails, and does not ask it about nothing', async () => {
    let calls = 0;
    const source: ModelInsightSource = {
      propose: async () => {
        calls++;
        throw new Error('model down');
      },
    };
    const service = new ExplainLabInsightsService({ evidence: await cohort(), model: { source, passedTypes: ['pacing'] } });
    expect(types(await service.explain({ courseId: 'course-1', granularity: 'cohort' }))).toHaveLength(4);
    expect(calls).toBe(1);
    expect(await service.explain({ courseId: 'course-9', granularity: 'cohort' })).toEqual([]);
    expect(calls).toBe(1);
  });

  it('ELI-005 describes the cohort in aggregates only, suppressing groups too small to stay anonymous', async () => {
    const insights = await new ExplainLabInsightsService({ evidence: await cohort() }).explain({ courseId: 'course-1', granularity: 'cohort' });
    expect(insights.map((i) => i.labId)).not.toContain('lab-2');
    expect(JSON.stringify(insights)).not.toMatch(/"l\d"|learnerId/);
    expect(summarise([])).toEqual({ sequences: [], learners: 0, byType: {} });
  });

  it('ELI-006 refuses a student-level view', async () => {
    const service = new ExplainLabInsightsService({ evidence: await cohort() });
    await expect(service.explain({ courseId: 'course-1', granularity: 'student' })).rejects.toThrow(DomainRuleViolation);
    await expect(service.explain({ courseId: 'course-1', granularity: 'student' })).rejects.toMatchObject({ rule: 'ELI-006', message: expect.stringContaining('identity port') });
  });

  it('ELI-007 rejects a lab view without a lab, and limits a lab view to its lab', async () => {
    const evidence = await cohort(async (e) => {
      for (const learnerId of learners(5, 'z')) await e({ learnerId, labId: 'lab-0', type: 'lab-opened' });
    });
    const service = new ExplainLabInsightsService({ evidence });
    await expect(service.explain({ courseId: 'course-1', granularity: 'lab' })).rejects.toMatchObject({ rule: 'ELI-007', message: 'a lab view needs a lab id' });
    const lab0 = await service.explain({ courseId: 'course-1', labId: 'lab-0', granularity: 'lab' });
    expect(lab0.map((i) => [i.type, i.labId])).toEqual([['low-completion', 'lab-0']]);
    const all = await service.explain({ courseId: 'course-1', granularity: 'cohort' });
    expect(all.map((i) => i.labId)).toEqual(['lab-0', 'lab-1', 'lab-1', 'lab-1', 'lab-1']);
  });
});

describe('RecommendInterventions', () => {
  it('RI-001 recommends only from insights with evidence and a pedagogical rule', async () => {
    const insight = (type: string, sequences: number[]): Insight => ({
      id: type,
      type,
      courseId: 'c',
      labId: 'lab-1',
      stepId: '02',
      claim: type,
      producedBy: type === 'pacing' ? 'model' : 'rule',
      evidence: { sequences, learners: 5, byType: {} },
      reasoning: 'r',
    });
    const queries: unknown[] = [];
    const insights: ExplainLabInsights = {
      explain: async (q) => {
        queries.push(q);
        return [insight('stalled-step', [1]), insight('help-hotspot', []), insight('pacing', [2])];
      },
    };
    const service = new RecommendInterventionsService({ insights });
    expect((await service.recommend('c')).map((r) => r.insight.type)).toEqual(['stalled-step']);
    await service.recommend('c', 'lab-1');
    expect(queries).toEqual([
      { courseId: 'c', granularity: 'cohort' },
      { courseId: 'c', labId: 'lab-1', granularity: 'lab' },
    ]);
  });

  it('RI-002 names the insight, its evidence and the rule in every recommendation', async () => {
    const service = new RecommendInterventionsService({ insights: new ExplainLabInsightsService({ evidence: await cohort() }) });
    const recommendations = await service.recommend('course-1');
    expect(recommendations.map((r) => [r.id, r.rule.id, r.suggestion])).toEqual([
      ['PED-1:stalled-step:course-1:lab-1:02', 'PED-1', 'Review step 02 of lab-1: add a worked example or a checkpoint just before it.'],
      ['PED-2:help-hotspot:course-1:lab-1', 'PED-2', 'Recap the prerequisites of lab-1 at the start of the next session.'],
      ['PED-3:low-completion:course-1:lab-1', 'PED-3', 'Check that the outcome of lab-1 is achievable in the time allowed, and consider splitting the lab.'],
      ['PED-4:explanation-reliance:course-1:lab-1', 'PED-4', 'Add graded hints to lab-1 so learners need fewer full explanations.'],
    ]);
    expect(recommendations.map((r) => r.rule.statement)).toEqual([
      'When one step stops a large share of a cohort, scaffold that step rather than the whole lab.',
      'When most of a cohort asks for help in a lab, revisit the prerequisites the lab assumes.',
      "When few learners demonstrate a lab's outcome, check the outcome is reachable in the time given.",
      'When learners rely on full explanations, offer graded hints earlier so they can reach the answer themselves.',
    ]);
    for (const r of recommendations) {
      expect(r.rule.statement).toBe(PEDAGOGICAL_RULES[r.insight.type]?.statement);
      expect(r.insight.evidence.sequences.length).toBeGreaterThan(0);
    }
  });

  it('RI-003 reads evidence and changes nothing', async () => {
    const store = await cohort();
    const before = store.all.length;
    const calls: unknown[] = [];
    const readOnly: EvidenceStore = {
      read: (q) => (calls.push(q), store.read(q)),
      append: async () => {
        throw new Error('append');
      },
      expire: async () => {
        throw new Error('expire');
      },
    };
    const service = new RecommendInterventionsService({ insights: new ExplainLabInsightsService({ evidence: readOnly }) });
    expect(await service.recommend('course-1')).toHaveLength(4);
    expect(await service.recommend('course-1', 'lab-1')).toHaveLength(4);
    expect(calls).toStrictEqual([{ courseId: 'course-1' }, { courseId: 'course-1', labId: 'lab-1' }]);
    expect(store.all).toHaveLength(before);
  });
});
