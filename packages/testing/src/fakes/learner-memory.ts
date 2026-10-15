import type { LearnerContext, LearnerMemory, MemoryEntry, MemoryScope, MemoryWrite } from '@tutors-ai/core';

export class InMemoryLearnerMemory implements LearnerMemory {
  #entries: MemoryEntry[] = [];

  get all(): readonly MemoryEntry[] {
    return this.#entries;
  }

  async recall(learner: LearnerContext, scope: MemoryScope, limit: number): Promise<readonly MemoryEntry[]> {
    if (scope.kind === 'none' || limit <= 0) return [];
    const visible = this.#entries.filter((e) => visibleTo(e, learner, scope));
    return visible.slice(-limit);
  }

  async remember(learner: LearnerContext, scope: MemoryScope, entry: MemoryWrite): Promise<void> {
    if (scope.kind === 'none') return;
    this.#entries.push({
      learnerId: learner.learnerId,
      sessionId: learner.sessionId,
      courseId: learner.courseId,
      ...(learner.programmeId === undefined ? {} : { programmeId: learner.programmeId }),
      sharing: scope.sharing,
      ...entry,
    });
  }

  async erase(learnerId: string): Promise<number> {
    const before = this.#entries.length;
    this.#entries = this.#entries.filter((e) => e.learnerId !== learnerId);
    return before - this.#entries.length;
  }
}

/** The visibility rule every LearnerMemory adapter must implement; the kit checks it. */
export function visibleTo(e: MemoryEntry, learner: LearnerContext, scope: MemoryScope): boolean {
  if (scope.kind === 'none') return false;
  const own = e.learnerId === learner.learnerId;
  const shared = scope.sharing === 'cohort' && e.sharing === 'cohort' && e.courseId === learner.courseId;
  if (!own && !shared) return false;
  if (!own) return true;
  switch (scope.kind) {
    case 'session':
      return e.sessionId === learner.sessionId;
    case 'course':
      return e.courseId === learner.courseId;
    case 'programme':
      return learner.programmeId === undefined
        ? e.courseId === learner.courseId
        : e.programmeId === learner.programmeId;
  }
}
