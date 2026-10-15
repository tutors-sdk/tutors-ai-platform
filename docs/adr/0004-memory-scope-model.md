# 0004. Agent memory is a typed scope selected with the capability level

Date: 2026-10-15 · Status: Accepted

## Context

The CSEDU paper's agent-memory idea needs a concrete, enforceable form. Student questions and memory
are personal data. What an assistant may do and what it may remember should be one policy decision,
not two that can drift apart.

## Decision

`MemoryScope` is `{ kind: none | session | course | programme, sharing: private | cohort }`.

- The monorepo decides a learner's scope and sends it in the learner context.
- The capability level's policy carries the widest scope it permits.
- The platform applies the narrower of the two, kind and sharing independently. It never widens
  memory.
- Cohort-shared entries are visible to another learner only when both the writer's and the reader's
  scopes share with the cohort, and only within the same course.
- Evidence retention follows the bound scope, except that evidence about an exchange is kept at
  least for the session even when memory is `none`: memory and evidence are distinct.
- Session evidence and memory end with the session, course with the course, and a learner can ask
  for erasure of everything.

## Consequences

- Changing what a level may remember is a data change in the contract package with a contract-test
  run, never a code change here.
- Every `LearnerMemory` and `EvidenceStore` adapter must pass kits that check these visibility and
  retention rules (`LMEM-*`, `ES-*`).
