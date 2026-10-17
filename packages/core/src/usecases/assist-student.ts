import type { AssistanceRequest, AssistanceResponse, AssistanceTrace, RefusalReason } from '../domain/assistance.ts';
import { depthWithin, narrowestScope, type MemoryScopeKind } from '../domain/capability.ts';
import type { RecordedEvidence } from '../domain/evidence.ts';
import { PortError } from '../domain/errors.ts';
import type { LearnerContext } from '../domain/learner.ts';
import type { Material } from '../domain/material.ts';
import type { MemoryEntry } from '../domain/memory.ts';
import type { AssistanceBound } from '../domain/policy.ts';
import type { Clock } from '../ports/driven/clock.ts';
import type { CourseContent } from '../ports/driven/course-content.ts';
import type { EvidenceStore } from '../ports/driven/evidence-store.ts';
import type { Completion, LanguageModel } from '../ports/driven/language-model.ts';
import type { LearnerMemory } from '../ports/driven/learner-memory.ts';
import type { PolicyProvider } from '../ports/driven/policy-provider.ts';
import { NO_TELEMETRY, type Span, type Telemetry } from '../ports/driven/telemetry.ts';
import type { AssistStudent } from '../ports/driving/assist-student.ts';
import { traced } from './traced.ts';

export interface AssistStudentConfig {
  /** Name recorded as the source of evidence this use case writes. */
  readonly source: string;
  readonly modelTimeoutMs: number;
  readonly memoryRecallLimit: number;
}

export interface AssistStudentDeps {
  readonly policies: PolicyProvider;
  readonly content: CourseContent;
  readonly model: LanguageModel;
  readonly memory: LearnerMemory;
  readonly evidence: EvidenceStore;
  readonly clock: Clock;
  readonly telemetry?: Telemetry;
  readonly config: AssistStudentConfig;
}

/**
 * Evidence about an exchange is kept at least for the session, even when the
 * learner's assistant may remember nothing: memory and evidence are distinct.
 * Spec: AS-014.
 */
export function evidenceRetention(memory: MemoryScopeKind): Exclude<MemoryScopeKind, 'none'> {
  return memory === 'none' ? 'session' : memory;
}

/** The core decides what the model was allowed to generate and whether the result may be shown. */
export class AssistStudentService implements AssistStudent {
  readonly #deps: AssistStudentDeps;
  readonly #telemetry: Telemetry;

  constructor(deps: AssistStudentDeps) {
    this.#deps = deps;
    this.#telemetry = deps.telemetry ?? NO_TELEMETRY;
  }

  async assist(request: AssistanceRequest): Promise<AssistanceResponse> {
    const span = this.#telemetry.startSpan('AssistStudent', {
      'learner.level': request.learner.level,
      'course.id': request.learner.courseId,
    });
    try {
      const response = await this.#assist(request, span);
      span.setAttribute('assist.outcome', response.kind);
      if (response.kind === 'refused') span.setAttribute('assist.refusal', response.reason);
      else span.setAttribute('assist.depth', response.depth);
      span.end('ok');
      return response;
    } catch (error) {
      span.end('error');
      throw error;
    }
  }

  async #assist({ learner, question }: AssistanceRequest, span: Span): Promise<AssistanceResponse> {
    const trace: { -readonly [K in keyof AssistanceTrace]: AssistanceTrace[K] } = {
      bound: null,
      materialIds: [],
      model: null,
      promptVersion: null,
    };
    const call = <T>(name: string, run: () => Promise<T>) => traced(this.#telemetry, span, name, run);
    const refuse = async (reason: RefusalReason, retention: MemoryScopeKind): Promise<AssistanceResponse> => {
      await call('EvidenceStore.append', () => this.#recordRequest(learner, retention, { outcome: 'refused', reason }));
      return { kind: 'refused', reason, trace: { ...trace } };
    };

    // AS-001
    if (question.trim().length === 0) return { kind: 'refused', reason: 'empty-question', trace };

    // AS-002
    const policy = await call('PolicyProvider.policyFor', () => this.#deps.policies.policyFor(learner.courseId, learner.level));
    if (policy === null) return refuse('no-policy', learner.memory.kind);

    // AS-003
    const bound: AssistanceBound = {
      policyId: policy.id,
      policyVersion: policy.version,
      maxDepth: policy.maxDepth,
      maxResponseChars: policy.maxResponseChars,
      memory: narrowestScope(learner.memory, policy.memory),
    };
    trace.bound = bound;
    span.setAttribute('policy.version', policy.version);

    // AS-004
    const material = await call('CourseContent.retrieve', () => this.#retrieve(learner, question, policy.maxMaterial));
    trace.materialIds = material.map((m) => m.id);
    if (material.length === 0) return refuse('no-material', bound.memory.kind);

    // AS-005
    const memory: readonly MemoryEntry[] =
      bound.memory.kind === 'none'
        ? []
        : await call('LearnerMemory.recall', () => this.#deps.memory.recall(learner, bound.memory, this.#deps.config.memoryRecallLimit));

    // AS-006, AS-007
    let completion: Completion;
    try {
      completion = await call('LanguageModel.complete', () =>
        this.#deps.model.complete({
          question,
          material,
          bound,
          memory,
          timeoutMs: this.#deps.config.modelTimeoutMs,
        }),
      );
    } catch (error) {
      if (PortError.is(error)) return refuse('model-unavailable', bound.memory.kind);
      throw error;
    }
    trace.model = completion.model;
    trace.promptVersion = completion.promptVersion;
    span.setAttribute('model.digest', completion.model.digest);
    span.setAttribute('model.tokens.in', completion.usage.inputTokens);
    span.setAttribute('model.tokens.out', completion.usage.outputTokens);

    // AS-008
    if (!depthWithin(completion.depth, bound.maxDepth)) return refuse('depth-exceeded', bound.memory.kind);
    // AS-009
    if (completion.citations.length === 0) return refuse('no-citation', bound.memory.kind);
    // AS-010
    const retrieved = new Set(trace.materialIds);
    if (completion.citations.some((id) => !retrieved.has(id))) {
      return refuse('citation-outside-material', bound.memory.kind);
    }

    // AS-011
    const truncated = completion.text.length > bound.maxResponseChars;
    const text = truncated ? completion.text.slice(0, bound.maxResponseChars) : completion.text;

    // AS-013
    await call('EvidenceStore.append', () => this.#recordRequest(learner, bound.memory.kind, { outcome: 'answered' }));
    await call('EvidenceStore.append', () =>
      this.#deps.evidence.append({
        ...this.#evidenceBase(learner, bound.memory.kind),
        type: 'assistance-given',
        depth: completion.depth,
        detail: { policyVersion: bound.policyVersion, modelDigest: completion.model.digest },
      }),
    );

    // AS-015
    if (bound.memory.kind !== 'none') {
      await call('LearnerMemory.remember', () =>
        this.#deps.memory.remember(learner, bound.memory, {
          question,
          answer: text,
          recordedAt: this.#deps.clock.now(),
        }),
      );
    }

    return { kind: 'answered', depth: completion.depth, text, citations: completion.citations, truncated, trace };
  }

  async #retrieve(learner: LearnerContext, question: string, limit: number): Promise<readonly Material[]> {
    const material = await this.#deps.content.retrieve({
      courseId: learner.courseId,
      ...(learner.topicId === undefined ? {} : { topicId: learner.topicId }),
      ...(learner.labId === undefined ? {} : { labId: learner.labId }),
      text: question,
      limit,
    });
    // Never trust an adapter to respect the course boundary or the limit.
    return material.filter((m) => m.courseId === learner.courseId).slice(0, limit);
  }

  #recordRequest(
    learner: LearnerContext,
    memory: MemoryScopeKind,
    detail: Readonly<Record<string, string>>,
  ): Promise<RecordedEvidence> {
    return this.#deps.evidence.append({
      ...this.#evidenceBase(learner, memory),
      type: 'assistance-requested',
      detail,
    });
  }

  #evidenceBase(learner: LearnerContext, memory: MemoryScopeKind) {
    return {
      learnerId: learner.learnerId,
      sessionId: learner.sessionId,
      courseId: learner.courseId,
      ...(learner.labId === undefined ? {} : { labId: learner.labId }),
      observedAt: this.#deps.clock.now(),
      source: this.#deps.config.source,
      confidence: 1,
      retention: evidenceRetention(memory),
    } as const;
  }
}
