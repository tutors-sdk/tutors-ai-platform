import type { AssistanceRequest, AssistanceResponse, LearnerContext, NewEvidence, GoldenSet, RetentionBoundary, RetentionResult } from '@tutors-ai/core';
import {
  AssistRequest,
  CONTRACT_VERSION,
  RecordEvidenceRequest,
  AssistResponse as AssistResponseSchema,
  GoldenSet as GoldenSetSchema,
  RetentionRequest,
  type AssistResponse,
  type RetentionResponse,
} from './schema.ts';

/** Drops keys whose value is undefined, so optional fields stay absent rather than undefined. */
function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as never;
}

export class ContractViolation extends Error {
  constructor(readonly issues: readonly { readonly path: string; readonly message: string }[]) {
    super(`request does not satisfy @tutors/ai-contract ${CONTRACT_VERSION}: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`);
    this.name = 'ContractViolation';
  }
}

function parse<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ContractViolation(result.error.issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message })));
}

/** Contract → core: validates a wire request and builds the domain request. */
export function toAssistanceRequest(input: unknown): AssistanceRequest {
  const dto = parse(AssistRequest, input);
  const learner: LearnerContext = defined(dto.learner);
  return { learner, question: dto.question };
}

/** Core → contract: the wire response. */
export function toAssistResponse(response: AssistanceResponse): AssistResponse {
  const trace = {
    policy:
      response.trace.bound === null
        ? null
        : {
            id: response.trace.bound.policyId,
            version: response.trace.bound.policyVersion,
            maxDepth: response.trace.bound.maxDepth,
            maxResponseChars: response.trace.bound.maxResponseChars,
            memory: { ...response.trace.bound.memory },
          },
    materialIds: [...response.trace.materialIds],
    model: response.trace.model === null ? null : { ...response.trace.model },
    promptVersion: response.trace.promptVersion,
  };
  return response.kind === 'answered'
    ? {
        contractVersion: CONTRACT_VERSION,
        kind: 'answered',
        depth: response.depth,
        text: response.text,
        citations: [...response.citations],
        truncated: response.truncated,
        trace,
      }
    : { contractVersion: CONTRACT_VERSION, kind: 'refused', reason: response.reason, trace };
}

/** Contract → core: validates a wire evidence record and builds the domain evidence. */
export function toNewEvidence(input: unknown): NewEvidence {
  const { contractVersion: _version, observedAt, ...rest } = parse(RecordEvidenceRequest, input);
  return { ...defined(rest), observedAt: new Date(observedAt) };
}

/** Contract → core: validates a wire retention request and builds the boundary. */
export function toRetentionBoundary(input: unknown): RetentionBoundary {
  return parse(RetentionRequest, input).boundary;
}

/** Core → contract: what a retention request removed. */
export function toRetentionResponse(result: RetentionResult): RetentionResponse {
  return { contractVersion: CONTRACT_VERSION, removed: { evidence: result.evidence, memory: result.memory } };
}

/** Contract → core: validates a wire response, for clients such as the evaluation harness. */
export function fromAssistResponse(input: unknown): AssistanceResponse {
  const wire = parse(AssistResponseSchema, input);
  const p = wire.trace.policy;
  const trace = {
    bound: p === null ? null : { policyId: p.id, policyVersion: p.version, maxDepth: p.maxDepth, maxResponseChars: p.maxResponseChars, memory: p.memory },
    materialIds: wire.trace.materialIds,
    model: wire.trace.model,
    promptVersion: wire.trace.promptVersion,
  };
  return wire.kind === 'answered'
    ? { kind: 'answered', depth: wire.depth, text: wire.text, citations: wire.citations, truncated: wire.truncated, trace }
    : { kind: 'refused', reason: wire.reason, trace };
}

/** Contract → core: validates a golden set file. */
export function toGoldenSet(input: unknown): GoldenSet {
  const wire = parse(GoldenSetSchema, input);
  return {
    id: wire.id,
    version: wire.version,
    cases: wire.cases.map((c) => ({ id: c.id, learner: defined(c.learner), question: c.question, expected: c.expected })),
  };
}
