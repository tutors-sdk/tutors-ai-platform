---
id: CC
port: CourseContent
kind: driven
status: implemented
---

# CourseContent

Retrieval of course material by course, topic and lab. Verified by the kit in
`packages/testing/src/kits/course-content.ts`.

- **CC-001** The CourseContent adapter shall return only material from the requested course.
- **CC-002** The CourseContent adapter shall return no more items than the requested limit.
- **CC-003** When a topic and lab are named, the CourseContent adapter shall return only material from that topic and lab.
- **CC-004** If the course is unknown, then the CourseContent adapter shall return an empty list.
- **CC-005** The CourseContent adapter shall give every item a unique id, a title and non-empty text.
- **CC-006** The CourseContent adapter shall rank the material that best matches the query text first.
