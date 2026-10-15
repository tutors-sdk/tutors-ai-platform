import { ASSISTANCE_DEPTHS, MEMORY_SCOPE_KINDS } from '../domain/capability.ts';
import { DomainRuleViolation } from '../domain/errors.ts';
import { EVIDENCE_TYPES, type NewEvidence, type RecordedEvidence } from '../domain/evidence.ts';
import type { Clock } from '../ports/driven/clock.ts';
import type { EvidenceStore } from '../ports/driven/evidence-store.ts';
import type { RecordEvidence } from '../ports/driving/record-evidence.ts';

export interface RecordEvidenceDeps {
  readonly evidence: EvidenceStore;
  readonly clock: Clock;
  /** How far in the future an observation may be stamped, to tolerate clock skew. */
  readonly maxClockSkewMs: number;
}

/** Validates evidence against domain rules, then appends it. */
export class RecordEvidenceService implements RecordEvidence {
  readonly #deps: RecordEvidenceDeps;

  constructor(deps: RecordEvidenceDeps) {
    this.#deps = deps;
  }

  async record(evidence: NewEvidence): Promise<RecordedEvidence> {
    this.#validate(evidence);
    return this.#deps.evidence.append(evidence);
  }

  #validate(e: NewEvidence): void {
    // RE-001
    if (!(EVIDENCE_TYPES as readonly string[]).includes(e.type)) {
      throw new DomainRuleViolation('RE-001', `unknown evidence type "${e.type}"`);
    }
    // RE-002
    for (const field of ['learnerId', 'sessionId', 'courseId', 'source'] as const) {
      if (e[field].trim().length === 0) throw new DomainRuleViolation('RE-002', `${field} must not be empty`);
    }
    // RE-003
    if (!Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 1) {
      throw new DomainRuleViolation('RE-003', `confidence ${e.confidence} is outside 0..1`);
    }
    // RE-004
    const latest = this.#deps.clock.now().getTime() + this.#deps.maxClockSkewMs;
    if (Number.isNaN(e.observedAt.getTime()) || e.observedAt.getTime() > latest) {
      throw new DomainRuleViolation('RE-004', 'observedAt is invalid or in the future');
    }
    // RE-005
    if (!(MEMORY_SCOPE_KINDS as readonly string[]).includes(e.retention) || e.retention === 'none') {
      throw new DomainRuleViolation('RE-005', `retention "${e.retention}" is not a storable scope`);
    }
    // RE-006
    if (e.type === 'assistance-given') {
      if (!(ASSISTANCE_DEPTHS as readonly (string | undefined)[]).includes(e.depth)) {
        throw new DomainRuleViolation('RE-006', 'assistance-given evidence must carry the depth given');
      }
    } else if (e.depth !== undefined) {
      throw new DomainRuleViolation('RE-006', `${e.type} evidence must not carry a depth`);
    }
  }
}
