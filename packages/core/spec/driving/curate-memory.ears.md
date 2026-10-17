---
id: CM
port: CurateMemory
kind: driving
status: planned
---

# CurateMemory

A learner sees, corrects and deletes what their assistant remembers about them.

- **CM-001** When a learner lists their memories, the CurateMemory use case shall return every memory they own in the course, active or candidate, and nothing anyone else owns.
- **CM-002** When a learner corrects a memory they own, the CurateMemory use case shall store the corrected text as a new version and recall only that version from then on.
- **CM-003** When a learner corrects a memory that has a pending sharing candidate, the CurateMemory use case shall leave the candidate pending so that a lecturer's review of it is refused as `memory-changed` (RS-004).
- **CM-004** When a learner deletes a memory, the CurateMemory use case shall remove it, withdraw its pending sharing candidates, and recall it for no one.
- **CM-005** If a learner corrects or deletes a memory they do not own, then the CurateMemory use case shall change nothing and report that there was no such memory.
