---
id: LMEM
port: LearnerMemory
kind: driven
status: implemented
---

# LearnerMemory

What a learner's assistant remembers, bounded by memory scope and sharing. Verified by the kit in
`packages/testing/src/kits/learner-memory.ts`.

- **LMEM-001** While the scope is `none`, the LearnerMemory adapter shall store nothing and recall nothing.
- **LMEM-002** While the scope is `session`, the LearnerMemory adapter shall recall only the learner's entries from the same session.
- **LMEM-003** While the scope is `course`, the LearnerMemory adapter shall recall the learner's entries from any session of the same course and none from other courses.
- **LMEM-004** While the scope is `programme`, the LearnerMemory adapter shall recall the learner's entries from any course of the same programme and none from other programmes.
- **LMEM-005** The LearnerMemory adapter shall never recall one learner's private entries for another learner.
- **LMEM-006** Where both the writer's and the reader's scope share with the cohort, the LearnerMemory adapter shall recall cohort-shared entries for other learners in the same course.
- **LMEM-007** The LearnerMemory adapter shall recall at most the requested number of entries, keeping the most recent, oldest first.
- **LMEM-008** When a learner asks for erasure, the LearnerMemory adapter shall remove every entry the learner wrote and report how many were removed.
- **LMEM-009** When a session ends, the LearnerMemory adapter shall remove entries written under `session` scope in that session only.
- **LMEM-010** When a course ends, the LearnerMemory adapter shall remove entries written under `session` or `course` scope in that course and keep `programme` entries.
- **LMEM-011** The LearnerMemory adapter shall keep with every entry the scope kind it was written under.
