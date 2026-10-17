---
id: DL
port: DecisionLog
kind: driven
status: planned
---

# DecisionLog

The append-only log of governance decisions, from which any exchange's read, assist and retain
decisions can be reconstructed. It holds identifiers and policy references, never question, answer
or memory text (docs/adr/0006).

- **DL-001** When a decision is appended, the DecisionLog adapter shall assign it a sequence number greater than any assigned before.
- **DL-002** The DecisionLog adapter shall return decisions exactly as appended, in ascending sequence order.
- **DL-003** When read, the DecisionLog adapter shall filter by course and, when given, by learner, decision point and a sequence to read after.
- **DL-004** The DecisionLog adapter shall offer no operation that changes or removes a single decision.
- **DL-005** The DecisionLog adapter shall store only the fields of a governance decision, so that no question, answer or memory text reaches the log.
