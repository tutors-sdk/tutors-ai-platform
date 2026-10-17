---
id: SC
port: SharingCandidates
kind: driven
status: planned
---

# SharingCandidates

Memories proposed for sharing with a course or cohort, waiting on a lecturer's review.

- **SC-001** When a candidate is proposed, the SharingCandidates adapter shall store it as `pending` and return it with a new id.
- **SC-002** The SharingCandidates adapter shall list only the pending candidates of the requested course, oldest first.
- **SC-003** When a pending candidate is settled, the SharingCandidates adapter shall record the decision, the reviewer, the time and any edited text, and return the settled candidate.
- **SC-004** If a candidate is already settled or does not exist, then the SharingCandidates adapter shall change nothing and return null.
- **SC-005** When a memory's candidates are withdrawn, the SharingCandidates adapter shall remove every candidate made from that memory and report how many were removed.
