---
id: RS
port: ReviewSharing
kind: driving
status: planned
---

# ReviewSharing

A lecturer approves, edits or rejects memories proposed for sharing before anything is promoted to a
course or cohort.

- **RS-001** If the reviewer does not hold the lecturer role, then the ReviewSharing use case shall refuse with reason `not-a-lecturer` and change nothing.
- **RS-002** When a lecturer approves a candidate, the ReviewSharing use case shall promote its text, or the lecturer's edited text, to its sharing target with provenance naming the private memory and the candidate.
- **RS-003** When a lecturer rejects a candidate, the ReviewSharing use case shall record the rejection and promote nothing.
- **RS-004** If the candidate's memory has changed or been deleted since it was proposed, then the ReviewSharing use case shall refuse with reason `memory-changed` and promote nothing.
- **RS-005** If the candidate does not exist or is already settled, then the ReviewSharing use case shall refuse and promote nothing.
- **RS-006** The ReviewSharing use case shall leave the private memory a candidate came from private, whatever the decision.
- **RS-007** When a candidate is settled, the ReviewSharing use case shall append the decision to the decision log.
