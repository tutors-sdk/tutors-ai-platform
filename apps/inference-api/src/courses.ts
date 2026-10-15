import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCourseExport, type CourseExport } from '@tutors-ai/adapter-course-content';

/** Loads every `*.json` course export in a directory, failing on the first malformed one. */
export async function loadCourseExports(dir: string): Promise<CourseExport[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const courses: CourseExport[] = [];
  for (const file of files) {
    const path = join(dir, file);
    courses.push(parseCourseExport(JSON.parse(await readFile(path, 'utf8')), path));
  }
  return courses;
}
