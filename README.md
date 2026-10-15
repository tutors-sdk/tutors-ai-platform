# Tutors AI Platform

Contextual student assistance, evidence-driven learning analytics and AI-supported course
improvement for the [Tutors](https://github.com/tutors-sdk) ecosystem, served by open-weight models.
Everything here is open source and meant to be reproducible: another institution should be able to
clone this repository and stand the platform up from it alone.

The design commits to four things:

1. **The domain is the asset.** Pedagogical rules, outcomes and what counts as evidence live in a
   core that knows nothing about Ollama, OpenShift or AWS.
2. **Model independence is enforced.** Every model and every piece of infrastructure sits behind a
   port with a contract-test kit. Swapping one is an adapter change and a kit run.
3. **Testing is a first-class capability.** EARS requirements gate CI, mutation testing scores the
   core, and (from phase 3) an evaluation harness gates every model, prompt or policy change.
4. **Everything is open and reproducible.** Open-weight models and open-source components only.

## Status

Phase 1 (foundations) is in progress. It needs no cluster and no GPU.

| Phase 1 item | State |
| --- | --- |
| Workspace, dependency lint, CI on every PR | Done |
| `@tutors/ai-contract` 0.1: schemas, two capability levels, `MemoryScope`, evidence types | Done in `packages/contract`; the contract lives in this repository (ADR 0002) |
| EARS files for the five driving and eight driven ports, and the CI gate | Done |
| Core `AssistStudent` and `RecordEvidence` against fakes, mutation baseline | Done (core at 100%) |
| Contract kits for `LanguageModel`, `CourseContent`, `EvidenceStore`, `LearnerMemory` (and `PolicyProvider`) | Done, green against fakes |
| Ollama and course export adapters through their kits | Done against a wire stub and fixtures; real model in the CI integration job |
| First four ADRs and this README | Done |
| First golden set, ten cases per level, with a lecturer | Needs a lecturer |

## Layout

```
packages/
  core/                  domain, ports, use cases; zero runtime dependencies
    src/domain/          learner context, policy, memory scope, evidence, assistance
    src/ports/           driving and driven port interfaces
    src/usecases/        one file per driving port
    spec/                EARS files, one per port
  contract/              @tutors/ai-contract 0.1, policies, golden sets, the contract adapter
  adapters/
    ollama/              LanguageModel: prompts, structured output, streaming, digest pinning
    postgres/            EvidenceStore and LearnerMemory, scope and retention enforced in SQL
    course-content/      CourseContent over a Tutors course export
    otel/                Telemetry over OpenTelemetry: spans, per-level metrics, nothing per learner
    system/              the system Clock
  testing/               contract-test kits, fakes and builders, written against ports
docs/
  adr/                   architecture decision records
  c4/                    the C4 model as code (Structurizr DSL)
  evaluation/            the evaluation harness: golden sets through a running inference API, judges, drift
apps/
  inference-api/         composition root for the request path, over HTTP, and its Containerfile
  insights-worker/       composition root for the nightly insights run, and its Containerfile
scripts/                 the EARS gate, the dependency boundary check, the mutation gate
```

Still to come, per the roadmap: `infra/` (OpenShift, AWS, staging). `adapters/keycloak` and the release
gate are deferred (ADR 0005).

## Dependency rules

| From | May import | Must not import |
| --- | --- | --- |
| `core` | nothing outside itself | any package, Node built-in, adapter, app or infra |
| `contract` | `core` types, its own libraries | adapters, apps, testing |
| `adapters/*` | `core` ports, its own client library | other adapters, contract, apps |
| `apps/*` | `core`, `contract`, any adapter | `infra` |
| `evaluation` | `core`, `testing`, `contract` | adapters directly (it goes through the composition root) |
| `testing` | `core` | adapters (fakes are written against ports) |

`pnpm lint` enforces these through `scripts/check-boundaries.mjs`.

## Working on it

Requires Node 22 and pnpm 10.

```sh
pnpm install
pnpm check              # typecheck, lint + boundaries, EARS gate, unit and contract tests
pnpm mutation           # Stryker on core; then node scripts/check-mutation.mjs
pnpm test:integration   # needs a running Ollama and PostgreSQL, see below
```

To run the PostgreSQL adapter kits locally, point `PG_URL` at any PostgreSQL 16 you can create
schemas in; each test creates and drops its own schema:

```sh
PG_URL=postgres://postgres@localhost:5432/postgres pnpm test:integration
```

To run the adapter against a real model locally:

```sh
ollama pull qwen2.5:0.5b
export OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:0.5b
export OLLAMA_DIGEST=sha256:$(curl -s $OLLAMA_URL/api/tags | jq -r '.models[] | select(.name=="qwen2.5:0.5b") | .digest')
pnpm test:integration
```

### The inference API

`apps/inference-api` wires every adapter to the core and serves contract 0.1 over HTTP:

| Endpoint | Does |
| --- | --- |
| `POST /v0/assist` | `AssistStudent`: an `AssistRequest` in, an `AssistResponse` out |
| `POST /v0/evidence` | `RecordEvidence`: a `RecordEvidenceRequest` in, `201` with its sequence |
| `POST /v0/retention` | `ApplyRetention`: end a session or course, or erase a learner |
| `GET /v0/insights?courseId=` | the latest insights run for a course: cohort insights and recommendations |
| `GET /healthz`, `GET /readyz` | liveness; readiness checks PostgreSQL |

A request that breaks the contract or a domain rule gets `400` naming what was wrong. Bodies are
capped at 64 KB. There is no streaming endpoint on purpose: the core checks depth, citations and
length on the complete answer, so streaming would show learners text nobody has checked.

It reads `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_DIGEST` (required, a sha256: models are pinned),
`PG_URL`, `COURSE_EXPORT_DIR` (a folder of course export `*.json`), and optionally `PORT`,
`PG_SCHEMA`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `EVIDENCE_SOURCE`, `MODEL_TIMEOUT_MS`,
`MEMORY_RECALL_LIMIT` and `MAX_CLOCK_SKEW_MS`. It migrates its schema on start.

```sh
pnpm --filter @tutors-ai/app-inference-api build && node apps/inference-api/dist/main.mjs
podman build -f apps/inference-api/Containerfile -t inference-api .
```

### Insights

`apps/insights-worker` runs nightly. For each course in `COURSE_EXPORT_DIR` (or `COURSE_IDS`), it
reads the evidence, applies the insight rules (a stalled step, a help hotspot, low completion,
reliance on full explanations) and the pedagogical rules that turn them into recommendations, and
saves the run for `GET /v0/insights`. Insights are cohort aggregates. Any lab with fewer learners
than `INSIGHTS_MIN_COHORT` (default 5, never below 3) is not described at all. The student view
waits for the identity port (ADR 0005). A model may propose insights too, but its insight types
reach lecturers only after passing the evaluation harness, and every one is labelled as produced
by a model.

### The gates

- **EARS.** Every port has a spec in `packages/core/spec/` before it has code, every requirement
  is in an EARS pattern, and every requirement of an implemented port appears by id in a test name.
  A new port without a spec fails CI. See `packages/core/spec/README.md`.
- **Contract kits.** An adapter is accepted only when it passes its port's kit in
  `packages/testing/src/kits/`. The fakes pass the same kits, which is what makes a use-case test
  against a fake mean something.
- **Mutation.** `mutation-baseline.json` records the minimum score per package. It may rise; it may
  not fall.
- **Non-determinism.** Unit and contract tests never call a model. Integration tests pin
  temperature to zero and a seed, and assert on structure, never wording. Only the evaluation
  harness judges wording, over a set, with a tolerance.

Vitest is held at 4.x because the Stryker Vitest runner does not activate mutants under Vitest 5
yet; every mutant survives silently there. Re-check before upgrading.

## Design

The full design (boundary with the monorepo, the hexagon, C4 views, capability design, testing
regime, infrastructure and roadmap) is maintained as a Claude Doc by the project lead. The ADRs in
`docs/adr/` record the decisions it takes.

## Licence

GPL-3.0, see [LICENSE](LICENSE).
