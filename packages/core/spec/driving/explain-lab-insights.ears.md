---
id: ELI
port: ExplainLabInsights
kind: driving
status: planned
---

# ExplainLabInsights

Produce explainable insights for a lab or cohort. Planned for phase 4; the cohort view ships first.

- **ELI-001** The ExplainLabInsights use case shall attach to every insight the evidence it rests on and the reasoning that produced it.
- **ELI-002** If an insight carries no evidence, then the ExplainLabInsights use case shall reject it.
- **ELI-003** When an insight is produced by a model, the ExplainLabInsights use case shall label it as model-produced.
- **ELI-004** Where a model-produced insight type has not passed the evaluation harness, the ExplainLabInsights use case shall withhold insights of that type from lecturers.
- **ELI-005** When asked for a cohort view, the ExplainLabInsights use case shall return only aggregates that identify no individual learner.
