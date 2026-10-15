import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chunkCourse, CourseExportContent, MAX_CHUNK_CHARS, parseCourseExport, rank, tokens } from '../src/index.ts';

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url));

describe('course export', () => {
  it('rejects malformed exports with the path of the problem', () => {
    expect(() => parseCourseExport({ id: 'c', title: 't', topics: [{ id: 't1', title: 'T', labs: [{ id: '', title: 'L', steps: [] }] }] })).toThrow(
      'course.topics[0].labs[0].id must be a non-empty string',
    );
    expect(() => parseCourseExport([])).toThrow('course must be an object');
    expect(() => parseCourseExport({ id: 'c', title: 't', topics: {} })).toThrow('course.topics must be an array');
  });

  it('refuses the same course twice', () => {
    const course = parseCourseExport({ id: 'c', title: 't', topics: [] });
    expect(() => new CourseExportContent([course, course])).toThrow('exported twice');
  });

  it('chunks long steps at headings and paragraphs, drops empty steps, and keeps stable ids', () => {
    const para = 'word '.repeat(200).trim();
    const course = parseCourseExport({
      id: 'c',
      title: 'C',
      topics: [
        {
          id: 't',
          title: 'T',
          labs: [
            {
              id: 'l',
              title: 'L',
              steps: [
                { id: 's', title: 'S', markdown: `# A\n\n${para}\n\n${para}\n\n${'x'.repeat(MAX_CHUNK_CHARS * 2)}\n# B\n\nshort` },
                { id: 'e', title: 'E', markdown: '' },
              ],
            },
          ],
        },
      ],
    });
    const chunks = chunkCourse(course);
    expect(chunks.every((c) => c.text.length <= MAX_CHUNK_CHARS)).toBe(true);
    expect(chunks.map((c) => c.id)).toEqual(chunks.map((_, n) => `c/t/l/s#${n}`));
    expect(chunks.at(-1)?.text).toBe('# B\n\nshort');
    expect(chunks[0]).toMatchObject({ courseId: 'c', topicId: 't', labId: 'l', title: 'L: S' });
  });

  it('ranks by query terms, ignoring stop words, and keeps order on ties', () => {
    expect(tokens('How do I use the for...of loop?')).toEqual(['use', 'for', 'of', 'loop']);
    const m = (id: string, text: string) => ({ id, courseId: 'c', title: id, text });
    const ranked = rank([m('a', 'nothing here'), m('b', 'arrays and push'), m('c', 'push push push length')], 'push');
    expect(ranked.map((x) => x.id)).toEqual(['c', 'b', 'a']);
    expect(rank([m('a', 'x'), m('b', 'y')], 'zzz').map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('loads every export in a directory and narrows by topic', async () => {
    const content = await CourseExportContent.fromDirectory(fixtures);
    const node = await content.retrieve({ courseId: 'full-stack-1', topicId: 'topic-02-node', text: 'import', limit: 10 });
    expect(node.map((x) => x.id)).toEqual(['full-stack-1/topic-02-node/lab-03-modules/00#0']);
  });
});
