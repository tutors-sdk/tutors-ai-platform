# 0002. Couple the repositories only through a versioned contract package

Date: 2026-10-15 · Status: Accepted; where the package lives is open

## Context

The monorepo and the platform must agree on request and response shapes, capability levels, memory
scopes, evidence types and policies, and must be able to change them deliberately.

## Decision

A contract package (working name `@tutors/ai-contract`) holds the schemas, the capability levels,
`MemoryScope`, evidence types, the pedagogical policies and the golden sets. Both repositories pin
it by version; every change runs the contract suite on both sides before merge.

Policies and golden sets change by pull request to the contract package, reviewed by a lecturer, with
the evaluation harness as the check.

## Open question

The design proposes the monorepo publishes the package. It could instead live in this repository or
in a third small repository both pin. Until that is decided, the 0.1 draft lives here in
`packages/contract/src/schema.ts` with the two first policies in `packages/contract/src/policies/`,
so it can be reviewed and exercised. Moving it is a package rename and an import change; the core
does not depend on it.

## Assumptions

- The monorepo will expose a course export that the CourseContent adapter can read. The shape this
  repository assumes is in `packages/adapters/course-content/src/export-format.ts`; it changes when
  the export CLI lands, and only that adapter changes with it.
- The monorepo will add an assessment hook that emits `outcome-demonstrated` evidence.

## Consequences

- The wire format is validated at the edge (`toAssistanceRequest`, `toNewEvidence`); unknown fields
  and other contract versions are rejected rather than ignored.
- Policy data is parsed when the provider loads; malformed or ambiguous policies fail at start-up,
  not at request time.
