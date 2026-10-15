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
  testing/               contract-test kits, fakes and builders, written against ports
docs/
  adr/                   architecture decision records
  c4/                    the C4 model as code (Structurizr DSL)
scripts/                 the EARS gate, the dependency boundary check, the mutation gate
```

Still to come, per the roadmap: `adapters/otel`, `evaluation/`, `apps/inference-api`,
`apps/insights-worker` and `infra/` (OpenShift, AWS, staging). `adapters/keycloak` and the release
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
