---
id: EC
port: EvaluateCapability
kind: driving
status: implemented
---

# EvaluateCapability

Run a golden set against the current model and policy, through the same composition root as
production. `packages/evaluation` drives it against a running inference API over HTTP.

- **EC-001** When a golden set is evaluated, the EvaluateCapability use case shall drive every case through AssistStudent exactly as a student request would be.
- **EC-002** The EvaluateCapability use case shall record in every report the model name and digest, the prompt version, the policy versions and the golden set version.
- **EC-003** The EvaluateCapability use case shall apply deterministic judges for bound, citation, memory scope and latency as pass or fail.
- **EC-004** While a model judge is uncalibrated against lecturer ratings, the EvaluateCapability use case shall report its score without gating on it.
- **EC-005** When a previous accepted run exists, the EvaluateCapability use case shall report drift case by case against it.
