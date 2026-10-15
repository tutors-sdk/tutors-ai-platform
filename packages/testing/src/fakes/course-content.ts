import type { CourseContent, Material, MaterialQuery } from '@tutors-ai/core';

/** Ranks by the number of query words a material contains; ties keep insertion order. */
export class InMemoryCourseContent implements CourseContent {
  readonly #material: readonly Material[];

  constructor(material: readonly Material[]) {
    this.#material = material;
  }

  async retrieve(query: MaterialQuery): Promise<readonly Material[]> {
    const words = query.text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const score = (m: Material) => {
      const haystack = `${m.title} ${m.text}`.toLowerCase();
      return words.filter((w) => haystack.includes(w)).length;
    };
    return this.#material
      .filter((m) => m.courseId === query.courseId)
      .filter((m) => query.topicId === undefined || m.topicId === query.topicId)
      .filter((m) => query.labId === undefined || m.labId === query.labId)
      .map((m, index) => ({ m, index, score: score(m) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, Math.max(0, query.limit))
      .map(({ m }) => m);
  }
}
