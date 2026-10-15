import { courseContentContract } from '@tutors-ai/testing';
import { fileURLToPath } from 'node:url';
import { CourseExportContent } from '../src/index.ts';

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url));

courseContentContract('CourseExportContent', {
  content: () => CourseExportContent.fromDirectory(fixtures),
  courseId: 'full-stack-1',
  topicId: 'topic-01-javascript',
  labId: 'lab-01-loops',
  otherCourseId: 'databases-1',
  probe: { text: 'my while loop never ends', expectedFirstId: 'full-stack-1/topic-01-javascript/lab-01-loops/01#0' },
});
