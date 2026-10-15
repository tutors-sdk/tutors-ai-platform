import type { CourseContent } from '@tutors-ai/core';
import { describe, expect, it } from 'vitest';

export interface CourseContentSubject {
  readonly content: () => CourseContent | Promise<CourseContent>;
  /** A course the subject holds, with a lab inside it that has at least two items. */
  readonly courseId: string;
  readonly topicId: string;
  readonly labId: string;
  /** Another course the subject holds, so leakage across courses can be detected. */
  readonly otherCourseId: string;
  /** A query whose best match is known. */
  readonly probe: { readonly text: string; readonly expectedFirstId: string };
}

/** The CourseContent contract. An adapter may be wired only when this passes. */
export function courseContentContract(name: string, subject: CourseContentSubject): void {
  describe(`CourseContent contract: ${name}`, () => {
    it('CC-001 returns only material from the requested course', async () => {
      const content = await subject.content();
      const found = await content.retrieve({ courseId: subject.courseId, text: 'lab', limit: 50 });
      expect(found.length).toBeGreaterThan(0);
      for (const m of found) expect(m.courseId).toBe(subject.courseId);
      const other = await content.retrieve({ courseId: subject.otherCourseId, text: 'lab', limit: 50 });
      for (const m of other) expect(m.courseId).toBe(subject.otherCourseId);
    });

    it('CC-002 never returns more items than the limit', async () => {
      const content = await subject.content();
      expect(await content.retrieve({ courseId: subject.courseId, text: 'lab', limit: 1 })).toHaveLength(1);
      expect(await content.retrieve({ courseId: subject.courseId, text: 'lab', limit: 0 })).toHaveLength(0);
    });

    it('CC-003 narrows to the topic and lab when they are named', async () => {
      const content = await subject.content();
      const inLab = await content.retrieve({
        courseId: subject.courseId,
        topicId: subject.topicId,
        labId: subject.labId,
        text: 'lab',
        limit: 50,
      });
      expect(inLab.length).toBeGreaterThanOrEqual(2);
      for (const m of inLab) {
        expect(m.labId).toBe(subject.labId);
        expect(m.topicId).toBe(subject.topicId);
      }
    });

    it('CC-004 returns an empty list for an unknown course rather than failing', async () => {
      const content = await subject.content();
      expect(await content.retrieve({ courseId: 'no-such-course', text: 'lab', limit: 5 })).toEqual([]);
    });

    it('CC-005 gives every item a unique id, a title and non-empty text', async () => {
      const found = await (await subject.content()).retrieve({ courseId: subject.courseId, text: 'lab', limit: 50 });
      expect(new Set(found.map((m) => m.id)).size).toBe(found.length);
      for (const m of found) {
        expect(m.id.length).toBeGreaterThan(0);
        expect(m.title.length).toBeGreaterThan(0);
        expect(m.text.trim().length).toBeGreaterThan(0);
      }
    });

    it('CC-006 ranks the best match first', async () => {
      const found = await (await subject.content()).retrieve({
        courseId: subject.courseId,
        text: subject.probe.text,
        limit: 3,
      });
      expect(found[0]?.id).toBe(subject.probe.expectedFirstId);
    });
  });
}
