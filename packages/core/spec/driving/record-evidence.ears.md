---
id: RE
port: RecordEvidence
kind: driving
status: implemented
---

# RecordEvidence

Append learning evidence after checking it against the domain's rules. Evidence is append-only.

- **RE-001** If the evidence type is not one of the first-release types, then the RecordEvidence use case shall reject it.
- **RE-002** If the learner, session, course or source is empty, then the RecordEvidence use case shall reject the evidence.
- **RE-003** If the confidence is not a finite number between 0 and 1 inclusive, then the RecordEvidence use case shall reject the evidence.
- **RE-004** If the observation time is invalid or later than the clock's time plus the allowed skew, then the RecordEvidence use case shall reject the evidence.
- **RE-005** If the retention is not one of `session`, `course` or `programme`, then the RecordEvidence use case shall reject the evidence.
- **RE-006** If `assistance-given` evidence carries no valid depth, or any other evidence type carries a depth, then the RecordEvidence use case shall reject the evidence.
- **RE-007** When evidence passes every rule, the RecordEvidence use case shall append it to the evidence store and return the stored record with its sequence.
