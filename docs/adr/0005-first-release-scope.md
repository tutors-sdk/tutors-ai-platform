# 0005. Scope of the first release

Date: 2026-10-15 · Status: Accepted

## Context

The design left five questions open for the project lead. Four of them shape what gets built next.

## Decision

- **First model candidate:** Qwen 3.8 27B, served by Ollama on the GPU worker. The exact Ollama
  name and its digest are pinned in the composition root's configuration when the infrastructure
  lands (ADR 0003); CI keeps a small CPU model for adapter integration tests.
- **insights-worker ships in the first release**, alongside student assistance and evidence
  recording. `ExplainLabInsights` and the batch worker are therefore in scope, cohort view first.
- **The release gate is deferred** until the platform is built. Neither reusing the monorepo's
  release harness nor building a new one on its pattern is started yet.
- **Authentication is deferred.** The `Identity` port and its EARS spec stay as they are, but no
  Keycloak adapter, realm or lecturer role is built for now, and golden-set sign-off is by pull
  request review.

## Consequences

- PostgreSQL (`EvidenceStore`, `LearnerMemory`) and the insights path move ahead of Keycloak.
- Until auth exists, `inference-api` must not be reachable from outside the cluster or a developer
  machine, and must not hold real student data. Staging stays on synthetic learners.
- A 27B model will not fit the CI runners, so its behaviour is measured only by the evaluation
  harness against the GPU worker, never by the per-PR integration job.
