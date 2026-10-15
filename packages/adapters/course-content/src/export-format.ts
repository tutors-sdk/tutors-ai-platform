/**
 * The course export this adapter reads.
 *
 * ASSUMPTION (docs/adr/0002): the monorepo's planned export CLI will emit one
 * JSON document per course in roughly this shape: course → topics → labs →
 * steps, with step bodies as Markdown. When the CLI lands, this file and
 * `parseCourseExport` change; the CourseContent port and its kit do not.
 */
export interface CourseExport {
  readonly id: string;
  readonly title: string;
  readonly programmeId?: string;
  readonly topics: readonly TopicExport[];
}

export interface TopicExport {
  readonly id: string;
  readonly title: string;
  readonly labs: readonly LabExport[];
}

export interface LabExport {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly StepExport[];
}

export interface StepExport {
  readonly id: string;
  readonly title: string;
  readonly markdown: string;
}

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Structural validation; throws with the path of the first problem. */
export function parseCourseExport(input: unknown, path = 'course'): CourseExport {
  const obj = (v: unknown, at: string): Record<string, unknown> => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${at} must be an object`);
    return v as Record<string, unknown>;
  };
  const arr = (v: unknown, at: string): unknown[] => {
    if (!Array.isArray(v)) throw new Error(`${at} must be an array`);
    return v;
  };
  const str = (v: unknown, at: string): string => {
    if (!isString(v)) throw new Error(`${at} must be a non-empty string`);
    return v;
  };
  const c = obj(input, path);
  return {
    id: str(c.id, `${path}.id`),
    title: str(c.title, `${path}.title`),
    ...(c.programmeId === undefined ? {} : { programmeId: str(c.programmeId, `${path}.programmeId`) }),
    topics: arr(c.topics, `${path}.topics`).map((t, i) => {
      const at = `${path}.topics[${i}]`;
      const topic = obj(t, at);
      return {
        id: str(topic.id, `${at}.id`),
        title: str(topic.title, `${at}.title`),
        labs: arr(topic.labs, `${at}.labs`).map((l, j) => {
          const lat = `${at}.labs[${j}]`;
          const lab = obj(l, lat);
          return {
            id: str(lab.id, `${lat}.id`),
            title: str(lab.title, `${lat}.title`),
            steps: arr(lab.steps, `${lat}.steps`).map((s, k) => {
              const sat = `${lat}.steps[${k}]`;
              const step = obj(s, sat);
              return {
                id: str(step.id, `${sat}.id`),
                title: str(step.title, `${sat}.title`),
                markdown: typeof step.markdown === 'string' ? step.markdown : '',
              };
            }),
          };
        }),
      };
    }),
  };
}
