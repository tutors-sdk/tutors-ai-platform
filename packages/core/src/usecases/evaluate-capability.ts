import type { AssistanceResponse } from '../domain/assistance.ts';
import { depthWithin, scopeRank } from '../domain/capability.ts';
import type { Clock } from '../ports/driven/clock.ts';
import type { AssistStudent } from '../ports/driving/assist-student.ts';
import type {
  AnswerJudge,
  CaseDrift,
  CaseResult,
  DriftReport,
  EvaluateCapability,
  EvaluationReport,
  Failure,
  GoldenCase,
  GoldenSet,
} from '../ports/driving/evaluate-capability.ts';

export interface EvaluateCapabilityDeps {
  /** The same AssistStudent a student request reaches, through the composition root. */
  readonly assist: AssistStudent;
  readonly clock: Clock;
  readonly judges?: readonly AnswerJudge[];
  readonly config: { readonly maxLatencyMs: number };
}

/** Deterministic judges, per EC-003. Each returns its failures for one case. */
export function judgeBound(c: GoldenCase, r: AssistanceResponse): Failure[] {
  if (r.kind !== 'answered' || c.expected.kind !== 'answered') {
    return r.kind === c.expected.kind ? [] : [{ judge: 'bound', message: `expected ${c.expected.kind}, got ${r.kind}` }];
  }
  const failures: Failure[] = [];
  if (!depthWithin(r.depth, c.expected.maxDepth)) failures.push({ judge: 'bound', message: `depth ${r.depth} exceeds expected ${c.expected.maxDepth}` });
  const bound = r.trace.bound;
  if (bound === null) return [...failures, { judge: 'bound', message: 'answered without a bound' }];
  if (!depthWithin(r.depth, bound.maxDepth)) failures.push({ judge: 'bound', message: `depth ${r.depth} exceeds policy ${bound.maxDepth}` });
  if (r.text.length > bound.maxResponseChars) failures.push({ judge: 'bound', message: `${r.text.length} chars exceeds ${bound.maxResponseChars}` });
  return failures;
}

export function judgeCitation(c: GoldenCase, r: AssistanceResponse): Failure[] {
  if (r.kind !== 'answered' || c.expected.kind !== 'answered') return [];
  const failures: Failure[] = [];
  for (const id of r.citations) {
    if (!r.trace.materialIds.includes(id)) failures.push({ judge: 'citation', message: `cites ${id}, which was not retrieved` });
  }
  for (const id of c.expected.citations) {
    if (!r.citations.includes(id)) failures.push({ judge: 'citation', message: `does not cite expected ${id}` });
  }
  return failures;
}

export function judgeMemory(c: GoldenCase, r: AssistanceResponse): Failure[] {
  const bound = r.trace.bound;
  if (bound === null) return [];
  const requested = c.learner.memory;
  const failures: Failure[] = [];
  if (scopeRank(bound.memory.kind) > scopeRank(requested.kind)) {
    failures.push({ judge: 'memory', message: `memory ${bound.memory.kind} is wider than requested ${requested.kind}` });
  }
  if (requested.sharing === 'private' && bound.memory.sharing !== 'private') {
    failures.push({ judge: 'memory', message: 'shares memory the learner kept private' });
  }
  return failures;
}

export function judgeLatency(latencyMs: number, maxLatencyMs: number): Failure[] {
  return latencyMs > maxLatencyMs ? [{ judge: 'latency', message: `${latencyMs}ms exceeds ${maxLatencyMs}ms` }] : [];
}

/** Case-by-case comparison with a previous accepted run (EC-005). */
export function drift(current: EvaluationReport, previous: EvaluationReport): DriftReport {
  const before = new Map(previous.results.map((r) => [r.caseId, r.passed]));
  const now = new Set(current.results.map((r) => r.caseId));
  const cases: { caseId: string; drift: CaseDrift }[] = current.results.map((r) => {
    const was = before.get(r.caseId);
    const d: CaseDrift =
      was === undefined ? 'new' : was ? (r.passed ? 'still-passing' : 'regressed') : r.passed ? 'fixed' : 'still-failing';
    return { caseId: r.caseId, drift: d };
  });
  for (const r of previous.results) if (!now.has(r.caseId)) cases.push({ caseId: r.caseId, drift: 'removed' });
  const changed: DriftReport['changed'][number][] = [];
  if (current.model?.digest !== previous.model?.digest) changed.push('model');
  if (current.promptVersion !== previous.promptVersion) changed.push('prompt');
  if (current.policyVersions.join() !== previous.policyVersions.join()) changed.push('policy');
  if (current.goldenSet.version !== previous.goldenSet.version) changed.push('golden-set');
  return { changed, cases, regressions: cases.filter((c) => c.drift === 'regressed').length };
}

/** Runs a golden set through AssistStudent and judges every case. */
export class EvaluateCapabilityService implements EvaluateCapability {
  readonly #deps: EvaluateCapabilityDeps;

  constructor(deps: EvaluateCapabilityDeps) {
    this.#deps = deps;
  }

  async evaluate(set: GoldenSet, previous?: EvaluationReport): Promise<EvaluationReport> {
    const startedAt = this.#deps.clock.now().toISOString();
    const results: CaseResult[] = [];
    const responses: AssistanceResponse[] = [];
    // Sequential, so latency is measured one request at a time.
    for (const c of set.cases) {
      const { result, response } = await this.#run(c);
      results.push(result);
      if (response !== undefined) responses.push(response);
    }
    // EC-002
    const traced = responses.find((r) => r.trace.model !== null)?.trace;
    const policyVersions = [
      ...new Set(responses.flatMap((r) => (r.trace.bound === null ? [] : [`${r.trace.bound.policyId}@${r.trace.bound.policyVersion}`]))),
    ].sort();
    const report: EvaluationReport = {
      goldenSet: { id: set.id, version: set.version },
      model: traced?.model ?? null,
      promptVersion: traced?.promptVersion ?? null,
      policyVersions,
      startedAt,
      passed: results.every((r) => r.passed),
      results,
      drift: null,
    };
    // EC-005
    return previous === undefined ? report : { ...report, drift: drift(report, previous) };
  }

  async #run(c: GoldenCase): Promise<{ result: CaseResult; response?: AssistanceResponse }> {
    const started = this.#deps.clock.now().getTime();
    let response: AssistanceResponse;
    try {
      // EC-001
      response = await this.#deps.assist.assist({ learner: c.learner, question: c.question });
    } catch (error) {
      const latencyMs = this.#deps.clock.now().getTime() - started;
      const message = error instanceof Error ? error.message : String(error);
      return { result: { caseId: c.id, passed: false, outcome: 'error', latencyMs, failures: [{ judge: 'error', message }], scores: [] } };
    }
    const latencyMs = this.#deps.clock.now().getTime() - started;
    // EC-003
    const failures: Failure[] = [
      ...judgeBound(c, response),
      ...judgeCitation(c, response),
      ...judgeMemory(c, response),
      ...judgeLatency(latencyMs, this.#deps.config.maxLatencyMs),
    ];
    // EC-004
    const scores: CaseResult['scores'][number][] = [];
    for (const judge of this.#deps.judges ?? []) {
      const score = await judge.score(c, response);
      const gating = judge.calibrated && judge.threshold !== undefined;
      scores.push({ judge: judge.id, score, gating });
      if (gating && score < (judge.threshold as number)) {
        failures.push({ judge: `answer:${judge.id}`, message: `scored ${score}, below ${judge.threshold}` });
      }
    }
    return { result: { caseId: c.id, passed: failures.length === 0, outcome: response.kind, latencyMs, failures, scores }, response };
  }
}
