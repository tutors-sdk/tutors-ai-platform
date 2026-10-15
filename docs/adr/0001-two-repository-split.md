# 0001. Separate the AI platform from the monorepo

Date: 2026-10-15 · Status: Accepted

## Context

Tutors gains contextual student assistance, learning analytics and lecturer support served by
open-weight models on OpenShift. The monorepo owns the learning experience and must keep working,
anonymous model intact, when no AI is present. Model behaviour is non-deterministic and would make
the monorepo's own test suite flaky if it leaked in.

## Decision

`tutors-ai-platform` is its own repository. The monorepo owns student and lecturer experiences,
learning outcomes and pedagogical policy; the platform owns prompting, retrieval, model selection,
evaluation, infrastructure and operations.

- No AI concern crosses into the monorepo beyond one client adapter and one feature flag per capability.
- No pedagogy crosses into the platform core; policies arrive as versioned data.
- The platform core is framework-free TypeScript. Dependency direction is enforced by
  `scripts/check-boundaries.mjs`, which fails the build when `core` imports anything outside itself.

## Consequences

- The monorepo can ship without the platform, and the platform can serve a learning system other
  than Tutors. That is the test of domain and model independence.
- Changes that span both repositories go through the contract package (ADR 0002) and run its suite
  on both sides.
- Two CI pipelines, two release processes; the platform's release gate follows the monorepo's
  release harness pattern.
