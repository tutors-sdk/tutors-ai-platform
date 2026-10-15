---
id: AR
port: ApplyRetention
kind: driving
status: implemented
---

# ApplyRetention

End retained evidence and memory at a session or course boundary, and erase a learner on request.
Retention follows the memory scope (docs/adr/0004).

- **AR-001** When a session ends, the ApplyRetention use case shall remove the `session`-retention evidence and memory of that session.
- **AR-002** When a course ends, the ApplyRetention use case shall remove the `session`- and `course`-retention evidence and memory of that course.
- **AR-003** When a learner asks for erasure, the ApplyRetention use case shall remove all of that learner's evidence and memory and report how many records of each were removed.
- **AR-004** If the boundary has an empty id, then the ApplyRetention use case shall reject it without removing anything.
- **AR-005** The ApplyRetention use case shall be idempotent: applying the same boundary again shall remove nothing more.
- **AR-006** The ApplyRetention use case shall remove memory before evidence, so an assistant never recalls an exchange whose evidence is gone.
