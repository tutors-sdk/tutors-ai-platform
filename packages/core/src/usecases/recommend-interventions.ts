import type { ExplainLabInsights, Insight } from '../ports/driving/explain-lab-insights.ts';
import type { InterventionRecommendation, RecommendInterventions } from '../ports/driving/recommend-interventions.ts';

interface PedagogicalRule {
  readonly id: string;
  readonly statement: string;
  readonly suggest: (insight: Insight) => string;
}

/** The pedagogical rules linking an insight type to a suggestion. Model insight types have none yet. */
export const PEDAGOGICAL_RULES: Readonly<Record<string, PedagogicalRule>> = {
  'stalled-step': {
    id: 'PED-1',
    statement: 'When one step stops a large share of a cohort, scaffold that step rather than the whole lab.',
    suggest: (i) => `Review step ${i.stepId} of ${i.labId}: add a worked example or a checkpoint just before it.`,
  },
  'help-hotspot': {
    id: 'PED-2',
    statement: 'When most of a cohort asks for help in a lab, revisit the prerequisites the lab assumes.',
    suggest: (i) => `Recap the prerequisites of ${i.labId} at the start of the next session.`,
  },
  'low-completion': {
    id: 'PED-3',
    statement: "When few learners demonstrate a lab's outcome, check the outcome is reachable in the time given.",
    suggest: (i) => `Check that the outcome of ${i.labId} is achievable in the time allowed, and consider splitting the lab.`,
  },
  'explanation-reliance': {
    id: 'PED-4',
    statement: 'When learners rely on full explanations, offer graded hints earlier so they can reach the answer themselves.',
    suggest: (i) => `Add graded hints to ${i.labId} so learners need fewer full explanations.`,
  },
};

/**
 * Recommendations for lecturers, derived only from verified insights. It
 * reads and suggests; it holds nothing that could change a course, a grade
 * or a learner's experience (RI-003).
 */
export class RecommendInterventionsService implements RecommendInterventions {
  readonly #insights: ExplainLabInsights;

  constructor(deps: { readonly insights: ExplainLabInsights }) {
    this.#insights = deps.insights;
  }

  async recommend(courseId: string, labId?: string): Promise<readonly InterventionRecommendation[]> {
    const insights = await this.#insights.explain(
      labId === undefined ? { courseId, granularity: 'cohort' } : { courseId, labId, granularity: 'lab' },
    );
    const out: InterventionRecommendation[] = [];
    for (const insight of insights) {
      const rule = PEDAGOGICAL_RULES[insight.type];
      // RI-001: only insights with evidence and a rule that links them to a suggestion.
      if (rule === undefined || insight.evidence.sequences.length === 0) continue;
      out.push({
        id: `${rule.id}:${insight.id}`,
        suggestion: rule.suggest(insight),
        insight,
        rule: { id: rule.id, statement: rule.statement },
      });
    }
    return out;
  }
}
