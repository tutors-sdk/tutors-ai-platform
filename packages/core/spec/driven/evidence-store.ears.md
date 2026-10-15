---
id: ES
port: EvidenceStore
kind: driven
status: implemented
---

# EvidenceStore

Append-only learning evidence with retention by memory scope. Verified by the kit in
`packages/testing/src/kits/evidence-store.ts`.

- **ES-001** When evidence is appended, the EvidenceStore adapter shall assign it a sequence number greater than any assigned before.
- **ES-002** The EvidenceStore adapter shall return stored evidence exactly as appended, in ascending sequence order.
- **ES-003** When read, the EvidenceStore adapter shall filter by course and, when given, by learner, lab and a sequence to read after.
- **ES-004** The EvidenceStore adapter shall leave earlier records unchanged when later records are appended.
- **ES-005** When a session ends, the EvidenceStore adapter shall remove evidence with `session` retention for that session only.
- **ES-006** When a course ends, the EvidenceStore adapter shall remove evidence with `session` or `course` retention for that course and keep `programme` retention.
- **ES-007** When a learner asks for erasure, the EvidenceStore adapter shall remove all of that learner's evidence whatever its retention.
