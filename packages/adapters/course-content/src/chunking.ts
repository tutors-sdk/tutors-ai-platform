import type { Material } from '@tutors-ai/core';
import type { CourseExport } from './export-format.ts';

/** Chunks longer than this are split at headings, then paragraphs. */
export const MAX_CHUNK_CHARS = 1500;

/**
 * One Material per step section, so a citation points at something a student
 * can find. Ids are stable: course/topic/lab/step#n.
 */
export function chunkCourse(course: CourseExport): Material[] {
  return course.topics.flatMap((topic) =>
    topic.labs.flatMap((lab) =>
      lab.steps.flatMap((step) =>
        split(step.markdown)
          .map((text, n) => ({
            id: `${course.id}/${topic.id}/${lab.id}/${step.id}#${n}`,
            courseId: course.id,
            topicId: topic.id,
            labId: lab.id,
            title: `${lab.title}: ${step.title}`,
            text,
          }))
          .filter((m) => m.text.trim().length > 0),
      ),
    ),
  );
}

function split(markdown: string): string[] {
  const sections = markdown.split(/\n(?=#{1,3} )/);
  return sections.flatMap((section) => {
    if (section.length <= MAX_CHUNK_CHARS) return [section.trim()];
    const out: string[] = [];
    let current = '';
    for (const para of section.split(/\n{2,}/)) {
      if (current.length > 0 && current.length + para.length + 2 > MAX_CHUNK_CHARS) {
        out.push(current.trim());
        current = '';
      }
      current += (current.length > 0 ? '\n\n' : '') + para;
    }
    if (current.trim().length > 0) out.push(current.trim());
    return out.flatMap((chunk) =>
      chunk.length <= MAX_CHUNK_CHARS
        ? [chunk]
        : Array.from({ length: Math.ceil(chunk.length / MAX_CHUNK_CHARS) }, (_, i) =>
            chunk.slice(i * MAX_CHUNK_CHARS, (i + 1) * MAX_CHUNK_CHARS),
          ),
    );
  });
}
