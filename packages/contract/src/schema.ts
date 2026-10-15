/**
 * @tutors/ai-contract 0.1: the versioned, model-independent seam between
 * tutors-mono-repo and this platform. It lives and is published from this
 * repository; the monorepo pins it (docs/adr/0002).
 * Nothing in this file may name a model, a serving stack or a cloud.
 */
import { z } from 'zod';

export const CONTRACT_VERSION = '0.1.0';

const id = z.string().trim().min(1).max(200);

export const AssistanceDepth = z.enum(['redirect', 'hint', 'explanation']);
export const MemoryScopeKind = z.enum(['none', 'session', 'course', 'programme']);
export const MemorySharing = z.enum(['private', 'cohort']);
export const MemoryScope = z.object({ kind: MemoryScopeKind, sharing: MemorySharing }).strict();

/** Capability levels are data. 0.1 defines the two the CSEDU paper starts with. */
export const CapabilityLevel = z.string().regex(/^[a-z][a-z0-9-]*$/);
export const CAPABILITY_LEVELS_0_1 = ['first-year', 'final-year'] as const;

export const EvidenceType = z.enum([
  'lab-opened',
  'step-reached',
  'assistance-requested',
  'assistance-given',
  'outcome-demonstrated',
]);

export const LearnerContext = z
  .object({
    learnerId: id,
    sessionId: id,
    courseId: id,
    programmeId: id.optional(),
    topicId: id.optional(),
    labId: id.optional(),
    level: CapabilityLevel,
    memory: MemoryScope,
  })
  .strict();

export const AssistRequest = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    learner: LearnerContext,
    question: z.string().max(4000),
  })
  .strict();

const Trace = z.object({
  /** The bound the exchange was held to: the policy, and the depth, length and memory it allowed. */
  policy: z
    .object({ id: z.string(), version: z.string(), maxDepth: AssistanceDepth, maxResponseChars: z.number().int(), memory: MemoryScope })
    .nullable(),
  materialIds: z.array(z.string()),
  model: z.object({ name: z.string(), digest: z.string() }).nullable(),
  promptVersion: z.string().nullable(),
});

export const RefusalReason = z.enum([
  'empty-question',
  'no-policy',
  'no-material',
  'depth-exceeded',
  'citation-outside-material',
  'no-citation',
  'model-unavailable',
]);

export const AssistResponse = z.discriminatedUnion('kind', [
  z.object({
    contractVersion: z.literal(CONTRACT_VERSION),
    kind: z.literal('answered'),
    depth: AssistanceDepth,
    text: z.string(),
    citations: z.array(z.string()),
    truncated: z.boolean(),
    trace: Trace,
  }),
  z.object({
    contractVersion: z.literal(CONTRACT_VERSION),
    kind: z.literal('refused'),
    reason: RefusalReason,
    trace: Trace,
  }),
]);

export const RecordEvidenceRequest = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    type: EvidenceType,
    learnerId: id,
    sessionId: id,
    courseId: id,
    labId: id.optional(),
    stepId: id.optional(),
    observedAt: z.iso.datetime({ offset: true }),
    source: id,
    confidence: z.number().min(0).max(1),
    retention: MemoryScopeKind.exclude(['none']),
    depth: AssistanceDepth.optional(),
    detail: z.record(z.string(), z.string()).optional(),
  })
  .strict();

/**
 * A retention boundary: the end of a session or course, or a learner's
 * erasure request. Data kept for that scope ends (docs/adr/0004).
 */
export const RetentionRequest = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    boundary: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('session'), sessionId: id }).strict(),
      z.object({ kind: z.literal('course'), courseId: id }).strict(),
      z.object({ kind: z.literal('learner'), learnerId: id }).strict(),
    ]),
  })
  .strict();

export const RetentionResponse = z
  .object({ contractVersion: z.literal(CONTRACT_VERSION), removed: z.object({ evidence: z.number().int(), memory: z.number().int() }) })
  .strict();

/** A pedagogical policy as published in the contract package. */
export const Policy = z
  .object({
    id,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    level: CapabilityLevel,
    maxDepth: AssistanceDepth,
    memory: MemoryScope,
    maxResponseChars: z.number().int().positive(),
    maxMaterial: z.number().int().positive(),
    /** Optional course ids this policy overrides the level default for. */
    courses: z.array(id).optional(),
  })
  .strict();

/** A golden case, curated with lecturers and versioned in the contract package. */
export const GoldenCase = z
  .object({
    id,
    learner: LearnerContext,
    question: z.string().min(1),
    expected: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('answered'), maxDepth: AssistanceDepth, citations: z.array(z.string()) }).strict(),
      z.object({ kind: z.literal('refused') }).strict(),
    ]),
    notes: z.string().optional(),
  })
  .strict();

export const GoldenSet = z
  .object({ id, version: z.string(), level: CapabilityLevel, cases: z.array(GoldenCase) })
  .strict();

export type AssistRequest = z.infer<typeof AssistRequest>;
export type AssistResponse = z.infer<typeof AssistResponse>;
export type RecordEvidenceRequest = z.infer<typeof RecordEvidenceRequest>;
export type RetentionRequest = z.infer<typeof RetentionRequest>;
export type RetentionResponse = z.infer<typeof RetentionResponse>;
export type Policy = z.infer<typeof Policy>;
export type GoldenSet = z.infer<typeof GoldenSet>;
