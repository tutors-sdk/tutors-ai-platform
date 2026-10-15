# 0002. Couple the repositories only through a versioned contract package

Date: 2026-10-15 · Status: Accepted

## Context

The monorepo and the platform must agree on request and response shapes, capability levels, memory
scopes, evidence types and policies, and must be able to change them deliberately.

## Decision

A contract package (working name `@tutors/ai-contract`) holds the schemas, the capability levels,
`MemoryScope`, evidence types, the pedagogical policies and the golden sets. Both repositories pin
it by version; every change runs the contract suite on both sides before merge.

Policies and golden sets change by pull request to the contract package, reviewed by a lecturer, with
the evaluation harness as the check.

The contract lives in this repository, in `packages/contract`, and is published from here. The
design first proposed that the monorepo publish it, and a third repository was also considered;
keeping it here was decided on 2026-10-15. The monorepo consumes the published package and pins its
version. Its client adapter is the only code there that imports it.

## Why here

- The platform implements and contract-tests every change, so the schemas, policies and golden sets
  sit next to the kits and the evaluation harness that check them.
- A single repository holds everything a second institution needs to run the platform.
- The monorepo keeps no AI concern beyond its client adapter (ADR 0001).

## Assumptions

- The monorepo will expose a course export that the CourseContent adapter can read. The shape this
  repository assumes is in `packages/adapters/course-content/src/export-format.ts`; it changes when
  the export CLI lands, and only that adapter changes with it.
- The monorepo will add an assessment hook that emits `outcome-demonstrated` evidence.

## Consequences

- Pedagogical changes (policies, capability levels, golden sets) are pull requests to this
  repository, reviewed by a lecturer. The monorepo takes them up by moving its pinned version.
- A breaking contract change bumps `CONTRACT_VERSION` and needs a matching release of the
  monorepo's client adapter before the platform stops accepting the old version.

- The wire format is validated at the edge (`toAssistanceRequest`, `toNewEvidence`); unknown fields
  and other contract versions are rejected rather than ignored.
- Policy data is parsed when the provider loads; malformed or ambiguous policies fail at start-up,
  not at request time.
