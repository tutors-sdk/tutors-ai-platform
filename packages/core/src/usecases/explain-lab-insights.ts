import { DomainRuleViolation } from '../domain/errors.ts';
import type { EvidenceType, RecordedEvidence } from '../domain/evidence.ts';
import type { EvidenceStore } from '../ports/driven/evidence-store.ts';
import type {
  EvidenceSummary,
  ExplainLabInsights,
  Insight,
  InsightQuery,
  LabAggregate,
  ModelInsightSource,
} from '../ports/driving/explain-lab-insights.ts';

export interface InsightThresholds {
  /** Fewest learners an aggregate may describe; smaller groups are suppressed (ELI-005). */
  readonly minCohort: number;
  /** Share of a lab's learners whose furthest step is one step, to call it a stall. */
  readonly stallShare: number;
  /** Share of a lab's learners asking for help, to call the lab a hotspot. */
  readonly helpShare: number;
  /** Share of a lab's learners demonstrating its outcome, below which completion is low. */
  readonly completionShare: number;
  /** Share of assistance given as full explanations, to call it reliance. */
  readonly explanationShare: number;
}

export const DEFAULT_INSIGHT_THRESHOLDS: InsightThresholds = {
  minCohort: 5,
  stallShare: 0.4,
  helpShare: 0.5,
  completionShare: 0.5,
  explanationShare: 0.5,
};

export interface ExplainLabInsightsDeps {
  readonly evidence: EvidenceStore;
  readonly thresholds?: InsightThresholds;
  /** Optional model-produced insights; only types that passed the evaluation harness reach lecturers. */
  readonly model?: { readonly source: ModelInsightSource; readonly passedTypes: readonly string[] };
}

export function summarise(records: readonly RecordedEvidence[]): EvidenceSummary {
  const byType: Partial<Record<EvidenceType, number>> = {};
  for (const r of records) byType[r.type] = (byType[r.type] ?? 0) + 1;
  return {
    sequences: records.map((r) => r.sequence).sort((a, b) => a - b),
    learners: new Set(records.map((r) => r.learnerId)).size,
    byType,
  };
}

const learnersOf = (records: readonly RecordedEvidence[]) => new Set(records.map((r) => r.learnerId));
const pct = (share: number) => `${Math.round(share * 100)}%`;

/** Each learner's furthest step reached, by step id order. */
function furthestSteps(records: readonly RecordedEvidence[]): Map<string, string> {
  const reached = new Map<string, string[]>();
  for (const r of records) {
    if (r.type === 'step-reached' && r.stepId !== undefined) reached.set(r.learnerId, [...(reached.get(r.learnerId) ?? []), r.stepId]);
  }
  return new Map([...reached].map(([learner, steps]) => [learner, steps.sort().at(-1) as string]));
}

/**
 * Rule-based insights over stored evidence, cohort first. Every insight
 * carries the evidence it rests on and the reasoning that produced it.
 */
export class ExplainLabInsightsService implements ExplainLabInsights {
  readonly #deps: ExplainLabInsightsDeps;
  readonly #t: InsightThresholds;

  constructor(deps: ExplainLabInsightsDeps) {
    this.#deps = deps;
    this.#t = deps.thresholds ?? DEFAULT_INSIGHT_THRESHOLDS;
  }

  async explain(query: InsightQuery): Promise<readonly Insight[]> {
    // ELI-006
    if (query.granularity === 'student') {
      throw new DomainRuleViolation('ELI-006', 'student-level insights wait for the identity port (docs/adr/0005)');
    }
    // ELI-007
    if (query.granularity === 'lab' && query.labId === undefined) {
      throw new DomainRuleViolation('ELI-007', 'a lab view needs a lab id');
    }
    const records = await this.#deps.evidence.read({ courseId: query.courseId, ...(query.labId === undefined ? {} : { labId: query.labId }) });
    const byLab = new Map<string, RecordedEvidence[]>();
    for (const r of records) {
      if (r.labId === undefined) continue;
      byLab.set(r.labId, [...(byLab.get(r.labId) ?? []), r]);
    }
    const insights: Insight[] = [];
    const aggregates: LabAggregate[] = [];
    for (const [labId, lab] of [...byLab].sort(([a], [b]) => a.localeCompare(b))) {
      // ELI-005: a lab with too few learners to stay anonymous is not described at all.
      if (learnersOf(lab).size < this.#t.minCohort) continue;
      aggregates.push(this.#aggregate(labId, lab));
      insights.push(...this.#rules(query.courseId, labId, lab));
    }
    insights.push(...(await this.#modelInsights(query.courseId, records, aggregates)));
    return insights;
  }

  #aggregate(labId: string, lab: readonly RecordedEvidence[]): LabAggregate {
    const furthestStep: Record<string, number> = {};
    for (const step of furthestSteps(lab).values()) furthestStep[step] = (furthestStep[step] ?? 0) + 1;
    return { labId, learners: learnersOf(lab).size, byType: summarise(lab).byType, furthestStep };
  }

  #rules(courseId: string, labId: string, lab: readonly RecordedEvidence[]): Insight[] {
    const t = this.#t;
    const out: Insight[] = [];
    const learners = learnersOf(lab).size;
    const insight = (type: string, claim: string, reasoning: string, evidence: readonly RecordedEvidence[], stepId?: string): Insight => ({
      id: [type, courseId, labId, ...(stepId === undefined ? [] : [stepId])].join(':'),
      type,
      courseId,
      labId,
      ...(stepId === undefined ? {} : { stepId }),
      claim,
      producedBy: 'rule',
      evidence: summarise(evidence),
      reasoning,
    });

    // Stalled step: many learners' furthest step is the same step, short of the last one.
    const furthest = furthestSteps(lab);
    const steps = [...new Set(furthest.values())].sort();
    const last = steps.at(-1);
    for (const step of steps) {
      if (step === last) continue;
      const stuck = [...furthest].filter(([, s]) => s === step).map(([l]) => l);
      const share = stuck.length / furthest.size;
      if (stuck.length < t.minCohort || share < t.stallShare) continue;
      const evidence = lab.filter((r) => r.type === 'step-reached' && r.stepId === step && stuck.includes(r.learnerId));
      out.push(
        insight(
          'stalled-step',
          `${stuck.length} of ${furthest.size} learners stopped at step ${step} of ${labId}`,
          `${pct(share)} of learners who reached any step got no further than ${step}, against a threshold of ${pct(t.stallShare)}; the lab goes on to step ${last}.`,
          evidence,
          step,
        ),
      );
    }

    // Help hotspot: most of the lab's learners asked for assistance.
    const asks = lab.filter((r) => r.type === 'assistance-requested');
    const askers = learnersOf(asks).size;
    if (askers >= t.minCohort && askers / learners >= t.helpShare) {
      out.push(
        insight(
          'help-hotspot',
          `${askers} of ${learners} learners asked for help in ${labId}`,
          `${pct(askers / learners)} of the lab's learners requested assistance (${asks.length} requests), against a threshold of ${pct(t.helpShare)}.`,
          asks,
        ),
      );
    }

    // Low completion: few learners demonstrated the lab's outcome.
    const outcomes = lab.filter((r) => r.type === 'outcome-demonstrated');
    const completed = learnersOf(outcomes).size;
    if (completed / learners < t.completionShare) {
      const opened = lab.filter((r) => r.type === 'lab-opened' || r.type === 'outcome-demonstrated');
      out.push(
        insight(
          'low-completion',
          `${completed} of ${learners} learners demonstrated the outcome of ${labId}`,
          `${pct(completed / learners)} of the lab's learners demonstrated its outcome, below a threshold of ${pct(t.completionShare)}.`,
          opened.length === 0 ? lab : opened,
        ),
      );
    }

    // Explanation reliance: assistance given is mostly full explanations.
    const given = lab.filter((r) => r.type === 'assistance-given');
    const explained = given.filter((r) => r.depth === 'explanation');
    if (learnersOf(given).size >= t.minCohort && explained.length / given.length >= t.explanationShare) {
      out.push(
        insight(
          'explanation-reliance',
          `${explained.length} of ${given.length} answers in ${labId} were full explanations`,
          `${pct(explained.length / given.length)} of assistance given in the lab was at explanation depth, against a threshold of ${pct(t.explanationShare)}.`,
          given,
        ),
      );
    }
    return out;
  }

  async #modelInsights(courseId: string, records: readonly RecordedEvidence[], labs: readonly LabAggregate[]): Promise<Insight[]> {
    const model = this.#deps.model;
    if (model === undefined || labs.length === 0) return [];
    const { source, passedTypes } = model;
    let candidates;
    try {
      candidates = await source.propose(courseId, labs);
    } catch {
      return [];
    }
    const bySequence = new Map(records.map((r) => [r.sequence, r]));
    const out: Insight[] = [];
    for (const c of candidates) {
      // ELI-004
      if (!passedTypes.includes(c.type)) continue;
      const evidence = c.evidenceSequences.map((s) => bySequence.get(s));
      // ELI-002: no evidence, or evidence that does not exist, means no insight.
      if (evidence.length === 0 || evidence.some((e) => e === undefined)) continue;
      const summary = summarise(evidence as RecordedEvidence[]);
      // ELI-005
      if (summary.learners < this.#t.minCohort) continue;
      out.push({
        id: ['model', c.type, courseId, ...(c.labId === undefined ? [] : [c.labId]), ...(c.stepId === undefined ? [] : [c.stepId])].join(':'),
        type: c.type,
        courseId,
        ...(c.labId === undefined ? {} : { labId: c.labId }),
        ...(c.stepId === undefined ? {} : { stepId: c.stepId }),
        claim: c.claim,
        // ELI-003: labelled by the use case, whatever the source says.
        producedBy: 'model',
        evidence: summary,
        reasoning: c.reasoning,
      });
    }
    return out;
  }
}
