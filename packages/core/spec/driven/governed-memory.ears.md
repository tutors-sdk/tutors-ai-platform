---
id: GMEM
port: GovernedMemoryStore
kind: driven
status: planned
---

# GovernedMemoryStore

Scoped, versioned memory with provenance, searched by meaning. The intended adapter is MemoryHub
over MCP (docs/adr/0006). Course material never becomes memory; it stays behind `CourseContent`.
A kit in `packages/testing/src/kits/governed-memory.ts` must exist, and the in-memory fake must pass
it, before this spec moves to `implemented`.

- **GMEM-001** When a memory is written, the GovernedMemoryStore adapter shall return it with a new id, version 1 and its provenance unchanged.
- **GMEM-002** The GovernedMemoryStore adapter shall apply the LearnerMemory visibility rules (LMEM-001 to LMEM-006) to every search.
- **GMEM-003** The GovernedMemoryStore adapter shall never return a `candidate` memory from a search.
- **GMEM-004** When searching, the GovernedMemoryStore adapter shall return at most the requested number of memories, most relevant to the text first.
- **GMEM-005** The GovernedMemoryStore adapter shall return a promoted memory only to learners within its sharing target's course and, when the target names a cohort, that cohort.
- **GMEM-006** When an owner revises a memory, the GovernedMemoryStore adapter shall keep its id, increase its version, keep its provenance and return only the latest version from then on.
- **GMEM-007** If a revision or removal names a memory the owner does not own, then the GovernedMemoryStore adapter shall change nothing and report that there was no such memory.
- **GMEM-008** When an owner removes a memory, the GovernedMemoryStore adapter shall remove every version of it so that no search or listing returns it again.
- **GMEM-009** The GovernedMemoryStore adapter shall leave a promoted memory in place when the private memory it was promoted from is removed.
- **GMEM-010** When a retention boundary is applied, the GovernedMemoryStore adapter shall remove memories as the LearnerMemory adapter does (LMEM-008 to LMEM-010) and report how many were removed.
- **GMEM-011** If the memory service cannot be reached or answers outside the protocol, then the GovernedMemoryStore adapter shall raise a port error of kind `unavailable`, `timeout` or `invalid-response` and return no partial result.
