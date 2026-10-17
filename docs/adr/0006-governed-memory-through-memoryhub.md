# 0006. Governed memory goes through ports, with MemoryHub as the first adapter

Date: 2026-10-17 · Status: Accepted (project lead, 2026-10-17)

## Context

A final-year project (S. Hayes, "Policy-Governed Shared Student Memory and Learning Continuity for
Tutors Using MemoryHub") builds on this platform. It adds private memory for learning continuity,
lecturer-approved memory shared with a course or cohort, learner correction and deletion, and an
append-only log of policy decisions, using Red Hat's MemoryHub over MCP. It evaluates three
conditions on synthetic data: no persistent memory, session-only context, and governed memory.

ADR 0004 already gives memory a typed scope, bound by policy and never widened. This ADR says how
the project extends that without breaking the hexagon. The student's own feature work is not built
here; only the seams are.

## Decision

**MemoryHub is an adapter, never a dependency of the core.** It lives in
`packages/adapters/memoryhub` and is the only package that imports an MCP client. It serves two
driven ports:

- `LearnerMemory` (implemented, ADR 0004) first. The adapter passes the existing `LMEM-*` kit before
  anything else, so private continuity works through the current `AssistStudent` unchanged.
- `GovernedMemoryStore` (planned, `GMEM-*`): scoped, versioned memories with provenance, semantic
  search, correction, deletion and promotion.

Two further driven ports may be served by MemoryHub or by PostgreSQL, whichever the student
chooses: `SharingCandidates` (`SC-*`) for memories waiting on a lecturer, and `DecisionLog`
(`DL-*`) for the append-only log.

**The three decisions are domain logic; their rules are policy data.** Which memory may be read,
which assistance tier is allowed (`refuse` to `explanation`), and whether something is kept or
proposed for sharing are decided in `packages/core`, from `GovernanceInputs` only. The rules extend
the pedagogical policy in the contract package, so changing them is a data change with a contract
test run, as ADR 0004 requires. The core keeps its invariant: a decision may narrow the bound scope
and depth, never widen them. The decisions are mutation tested like the rest of the core.

**Trusted inputs only.** Role comes from the `Identity` port; activity type, assessment status,
cohort and consent come from the monorepo in the contract; origin and policy version come from the
core. Nothing is derived from what the learner typed, so wording cannot escalate assistance or
sharing. These fields are not in contract 0.1, so the work needs contract 0.2 (ADR 0002): new
optional fields, with a matching change to the monorepo's client adapter.

**Course material is never memory.** It stays behind `CourseContent`. Memory holds reflections,
exchanges, deterministic Tutors events and (stretch) extracted candidates, each with provenance.

**The inference API is the only caller of MemoryHub and the model.** It is the composition root
for the new use cases too; a network policy lets only its pods reach MemoryHub, as with Ollama.

**Observed through the core, not the adapter.** Every driven-port call runs in a child span of its
use case's span (`AS-018`, `TEL-004`), so MemoryHub latency, errors and fail-closed behaviour show
up in traces, metrics and OpenShift alerts without instrumentation in the adapter
(docs/observability.md). Telemetry is lossy and is never the audit record; the decision log is.

**The decision log holds no content.** Decisions carry ids, inputs, outcomes and policy rule ids,
never question, answer or memory text, so a learner's erasure removes their memories and evidence
while the log stays append-only. Learner ids in the log are the monorepo's pseudonymous ids.

## Defaults the student may revisit by pull request, with a new ADR

- **Fail closed.** If the memory service is unavailable, `AssistStudent` answers without memory
  rather than refusing, and nothing is retained or proposed. Recalling nothing is the closed state
  for memory; refusing the whole answer would make memory an availability dependency. A change to
  this is a change to the `AS-*` spec.
- **Lecturer view.** ADR 0001 puts student and lecturer experiences in the monorepo, so the minimal
  lecturer view is a SvelteKit page there, calling `ReviewSharing` through the contract. A
  throwaway developer page in this repository is acceptable for the demonstration only if it is
  outside `apps/` and never deployed.
- **Identity.** ADR 0005 defers Keycloak. `ReviewSharing` takes a `Principal`, so the lecturer role
  is enforced in the core from day one. Until a Keycloak adapter exists the composition root may
  use a static, developer-only identity, staging holds synthetic learners only, and nothing is
  exposed outside the cluster, exactly as ADR 0005 already requires.
- **Python.** Platform code stays TypeScript so the boundary check, kits and mutation gate apply.
  Synthetic data generation and pytest scenarios may be Python, driving the platform over HTTP
  only, as the evaluation harness does.

## Consequences

- Six planned specs exist before any code: `GMEM`, `SC`, `DL` (driven) and `RR`, `CM`, `RS`
  (driving). Each moves to `implemented` only with a kit, a fake that passes it, and every
  requirement traced to a test.
- `AssistStudent` changes spec first: the read and assist decisions, recall through
  `GovernedMemoryStore`, the retain decision after answering, and the fail-closed rule.
- The three evaluation conditions are composition and policy variants of the same platform (memory
  `none`, memory `session`, governed memory), so the harness compares them without special code.
- The cohort is a new concept. `LearnerMemory`'s cohort sharing is course-wide today; promoted
  memories may name a cohort within the course.
