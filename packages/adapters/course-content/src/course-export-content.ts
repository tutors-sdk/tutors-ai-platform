import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CourseContent, Material, MaterialQuery } from '@tutors-ai/core';
import { chunkCourse } from './chunking.ts';
import { parseCourseExport, type CourseExport } from './export-format.ts';
import { rank } from './ranking.ts';

/** CourseContent over one or more Tutors course exports, held in memory. */
export class CourseExportContent implements CourseContent {
  readonly #byCourse: ReadonlyMap<string, readonly Material[]>;

  constructor(courses: readonly CourseExport[]) {
    const map = new Map<string, Material[]>();
    for (const course of courses) {
      if (map.has(course.id)) throw new Error(`course ${course.id} is exported twice`);
      map.set(course.id, chunkCourse(course));
    }
    this.#byCourse = map;
  }

  /** Loads every `*.json` course export in a directory. */
  static async fromDirectory(dir: string): Promise<CourseExportContent> {
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    const courses = await Promise.all(
      files.map(async (f) => parseCourseExport(JSON.parse(await readFile(join(dir, f), 'utf8')), f)),
    );
    return new CourseExportContent(courses);
  }

  async retrieve(query: MaterialQuery): Promise<readonly Material[]> {
    if (query.limit <= 0) return [];
    const candidates = (this.#byCourse.get(query.courseId) ?? []).filter(
      (m) => (query.topicId === undefined || m.topicId === query.topicId) && (query.labId === undefined || m.labId === query.labId),
    );
    return rank(candidates, query.text).slice(0, query.limit);
  }
}
