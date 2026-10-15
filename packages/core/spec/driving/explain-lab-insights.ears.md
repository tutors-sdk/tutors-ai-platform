---
id: ELI
port: ExplainLabInsights
kind: driving
status: implemented
---

# ExplainLabInsights

Produce explainable insights for a lab or cohort. The cohort and lab views ship first; the
student view waits for the identity port, which is deferred (docs/adr/0005). Insights are rule
based; a model source is optional and gated by the evaluation harness.

- **ELI-001** The ExplainLabInsights use case shall attach to every insight the evidence it rests on and the reasoning that produced it.
- **ELI-002** If an insight carries no evidence, then the ExplainLabInsights use case shall reject it.
- **ELI-003** When an insight is produced by a model, the ExplainLabInsights use case shall label it as model-produced.
- **ELI-004** Where a model-produced insight type has not passed the evaluation harness, the ExplainLabInsights use case shall withhold insights of that type from lecturers.
- **ELI-005** When asked for a cohort view, the ExplainLabInsights use case shall return only aggregates that identify no individual learner.
- **ELI-006** If a student-level view is requested, then the ExplainLabInsights use case shall refuse it until an identity port authorises who may see it.
- **ELI-007** If a lab view is requested without a lab, then the ExplainLabInsights use case shall reject the query.
