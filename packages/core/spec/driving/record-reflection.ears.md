---
id: RR
port: RecordReflection
kind: driving
status: planned
---

# RecordReflection

A learner writes a reflection for their assistant to remember. The retain decision says whether it
is kept and whether it becomes a sharing candidate (docs/adr/0006).

- **RR-001** If the reflection is empty or only whitespace, then the RecordReflection use case shall not keep it and shall consult nothing.
- **RR-002** If no pedagogical policy exists for the learner's course and capability level, then the RecordReflection use case shall not keep the reflection.
- **RR-003** When a reflection is submitted, the RecordReflection use case shall take the retain decision from trusted inputs only and append it to the decision log before writing anything.
- **RR-004** If the learner has not consented to retention, then the RecordReflection use case shall not keep the reflection.
- **RR-005** When the retain decision keeps the reflection, the RecordReflection use case shall write it as a private memory within the bound memory scope with provenance naming the decision.
- **RR-006** When the retain decision proposes the reflection for sharing and the learner has consented to sharing, the RecordReflection use case shall create a pending sharing candidate and shall not make the reflection visible to anyone else.
- **RR-007** The RecordReflection use case shall reach the same retain decision whatever the reflection's wording.
- **RR-008** If the memory store fails with a port error, then the RecordReflection use case shall report the reflection as not kept and create no sharing candidate.
