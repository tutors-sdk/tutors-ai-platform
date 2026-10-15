import type { Material, MaterialQuery } from '../../domain/material.ts';

/** Driven port: retrieval of course material by course, topic and lab. */
export interface CourseContent {
  /**
   * Material matching the query, most relevant first, never more than
   * `query.limit` items, and never from a course other than `query.courseId`.
   */
  retrieve(query: MaterialQuery): Promise<readonly Material[]>;
}
