# Governed memory with MemoryHub: a guide for the project

This is the starting point for the final-year project "Policy-Governed Shared Student Memory and
Learning Continuity for Tutors Using MemoryHub". Read [ADR 0006](../adr/0006-governed-memory-through-memoryhub.md)
first; it records how the project fits the platform and which defaults you may revisit. Then read
[CONTRIBUTING.md](../../CONTRIBUTING.md) for the workflow every change follows.

## What already exists

| You need | It is here | State |
| --- | --- | --- |
| Memory scope (`none`, `session`, `course`, `programme`; `private` or `cohort`), never widened | `packages/core/src/domain/capability.ts`, ADR 0004 | Implemented |
| A memory port with a contract kit your adapter can pass on day one | `LearnerMemory`, kit in `packages/testing/src/kits/learner-memory.ts`, spec `LMEM-*` | Implemented |
| Assistance depth tiers and the refusal path | `AssistStudent`, spec `AS-*` | Implemented |
| Versioned policy as data | `packages/contract/src/policies/*.json`, `PolicyProvider` | Implemented |
| Retention boundaries and erasure | `ApplyRetention`, spec `AR-*` | Implemented |
| Roles (`student`, `lecturer`, `evaluator`) | `Identity` port, spec `ID-*` | Planned (ADR 0005) |
| An Ollama model, pinned by digest | `packages/adapters/ollama` | Implemented |
| OpenShift manifests, network policies and policy checks | `infra/openshift`, `infra/ci` | Written, never applied |
| An evaluation harness over the HTTP API | `packages/evaluation`, `pnpm eval` | Implemented |

## What this project adds, and where

Everything below exists as types and planned EARS specs. Nothing is implemented; that is the
project.

| Proposal | Port or type | Spec |
| --- | --- | --- |
| Trusted inputs: role, activity type, assessment status, source type, consent, policy version | `GovernanceInputs` in `packages/core/src/domain/governance.ts` | (domain) |
| Three decisions: read scope, assistance tier, retain or propose | `GovernanceOutcome`, decided in the core | `AS-*` changes, `RR-*` |
| Scoped, versioned memories with provenance and semantic search (MemoryHub) | `GovernedMemoryStore` | `GMEM-*` |
| Lecturer-approved sharing: approve, edit or reject, then promote | `SharingCandidates` (driven), `ReviewSharing` (driving) | `SC-*`, `RS-*` |
| Explicit student reflections | `RecordReflection` | `RR-*` |
| Students correct or delete their memories | `CurateMemory` | `CM-*` |
| Append-only policy decision log, audit reconstruction | `DecisionLog` | `DL-*` |
| Tutors events as memories | `MemoryOrigin` `tutors-event`, derived from `RecordEvidence` evidence | to write |
| Opt-in conversation extraction (stretch) | `MemoryOrigin` `extracted`, `status: 'candidate'`, `Consent.extract` | to write |

The shapes are a proposal. If the work shows a port is wrong, change it: edit the spec, then the
type, in the same pull request.

## Suggested order

The proposal builds private memory first, then sharing, then deployment. In this repository that
becomes:

1. **MemoryHub behind `LearnerMemory`.** Create `packages/adapters/memoryhub` (copy the shape of
   `packages/adapters/postgres`: `package.json` named `@tutors-ai/adapter-memoryhub`, `src/`,
   `test/`). Run the existing kit against it: `learnerMemoryContract('MemoryHub', ...)` in an
   integration test, and add a MemoryHub service to the `integration` job in
   `.github/workflows/ci.yml` next to Ollama and PostgreSQL. Wire it in `apps/inference-api/src/compose.ts` behind a config switch. Private
   continuity now works with no core change.
2. **Contract 0.2.** Add the trusted inputs (activity, assessment status, cohort, consent) as
   optional fields in `packages/contract/src/schema.ts`, with tests in
   `packages/contract/test/contract.test.ts`. Extend `Policy` with the governance rules.
3. **The decisions in the core.** Write them as pure functions over `GovernanceInputs` and the
   policy, with mutation testing at 100%. Write the `DL` kit and an in-memory fake, then change
   `AssistStudent` spec first (read and assist decisions, fail closed, retain after answering).
4. **`GovernedMemoryStore` and `RecordReflection`, `CurateMemory`.** Kit, fake, MemoryHub adapter,
   use cases, HTTP endpoints.
5. **Sharing.** `SharingCandidates` kit and adapter, `ReviewSharing` use case and endpoints, then
   the lecturer page (in the monorepo, see ADR 0006).
6. **Deployment.** Add MemoryHub to `infra/openshift/base`, with a network policy that admits only
   the inference API, and pass `infra/ci/check.sh`.
7. **Evaluation.** The three conditions are configurations: memory `none`, memory `session`, and
   governed memory. Add synthetic learners, cohorts and interactions as fixtures; never real learner
   data (ADR 0005).

## Observability

The deployment is judged on OpenShift, so observe it the way the rest of the platform is observed
([docs/observability.md](../observability.md)):

- Each new use case emits one root span (`RecordReflection`, `CurateMemory`, `ReviewSharing`) and
  calls every port through `traced`, so MemoryHub latency and failures appear as
  `GovernedMemoryStore.<operation>` and `LearnerMemory.<operation>` spans and metrics with no
  adapter code.
- Decisions get outcome attributes such as `governance.point` and `governance.outcome`, and the
  policy version. Add them to the metric label allow list only with a test.
- Fail-closed behaviour is visible: a MemoryHub outage shows as error spans with `port.error`
  while `AssistStudent` keeps answering, and the `TutorsAiPortErrors` alert fires.
- Telemetry is lossy, so audit reconstruction reads the `DecisionLog`, never traces.
- No learner ids and no memory or reflection text in any span, metric or log.

## Rules that will bite

- `packages/core` imports nothing: no MCP client, no Node built-ins. `pnpm lint` fails otherwise.
- An adapter imports only `@tutors-ai/core` and its own client library. The MCP SDK goes in
  `adapters/memoryhub/package.json`, nowhere else.
- A port file without a spec fails `pnpm ears`. A spec marked `implemented` fails unless every
  requirement id appears in a test name, e.g. `it('GMEM-003 never returns a candidate memory', ...)`.
- `mutation-baseline.json` keeps the core at 100%. New decision logic needs tests that kill every
  mutant.
- Unit and contract tests never call a model or MemoryHub. Use fakes; the real services belong in
  `*.integration.test.ts`.
- The decision log holds no question, answer or memory text (`DL-005`), so erasure and an
  append-only log do not conflict.

## Your evaluation, mapped to requirements

| Proposal measures | Requirements |
| --- | --- |
| Private or rejected memories stay inaccessible | `LMEM-005`, `GMEM-003`, `RS-003`, `RS-006` |
| Approved memories reach only the intended cohort | `GMEM-005`, `RS-002` |
| Cross-user isolation | `LMEM-005`, `CM-001`, `CM-005` |
| Correction and deletion | `GMEM-006`, `GMEM-008`, `CM-002`, `CM-004` |
| Policy compliance; wording cannot escalate | `RR-003`, `RR-007`, `AS-003`, `AS-008` |
| Audit-log reconstruction | `DL-001` to `DL-005`, `RR-003`, `RS-007` |
| Fail closed when MemoryHub is unavailable | `GMEM-011`, `RR-008`, the `AS-*` change in step 3 |
| Retrieval relevance, reduced repetition | `GMEM-004`, measured by the evaluation harness |
