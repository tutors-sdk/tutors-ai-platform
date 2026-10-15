import type { InsightRun, InsightStore } from '@tutors-ai/core';

export class InMemoryInsightStore implements InsightStore {
  readonly #runs: InsightRun[] = [];

  async save(run: InsightRun): Promise<void> {
    this.#runs.push(structuredClone(run));
  }

  async latest(courseId: string): Promise<InsightRun | null> {
    const runs = this.#runs.filter((r) => r.courseId === courseId);
    if (runs.length === 0) return null;
    return structuredClone(runs.reduce((a, b) => (b.producedAt >= a.producedAt ? b : a)));
  }
}
