import { DomainRuleViolation } from '../domain/errors.ts';
import type { RetentionBoundary } from '../domain/retention.ts';
import type { EvidenceStore } from '../ports/driven/evidence-store.ts';
import type { LearnerMemory } from '../ports/driven/learner-memory.ts';
import type { ApplyRetention, RetentionResult } from '../ports/driving/apply-retention.ts';

export interface ApplyRetentionDeps {
  readonly evidence: EvidenceStore;
  readonly memory: LearnerMemory;
}

/** Retention follows the memory scope (docs/adr/0004); erasure removes everything. */
export class ApplyRetentionService implements ApplyRetention {
  readonly #deps: ApplyRetentionDeps;

  constructor(deps: ApplyRetentionDeps) {
    this.#deps = deps;
  }

  async apply(boundary: RetentionBoundary): Promise<RetentionResult> {
    // AR-004
    const id = boundary.kind === 'session' ? boundary.sessionId : boundary.kind === 'course' ? boundary.courseId : boundary.learnerId;
    if (id.trim().length === 0) throw new DomainRuleViolation('AR-004', `${boundary.kind} boundary needs an id`);
    // AR-001..AR-003: memory first, so an assistant never recalls what evidence no longer supports.
    const memory = await this.#deps.memory.expire(boundary);
    const evidence = await this.#deps.evidence.expire(boundary);
    return { evidence, memory };
  }
}
