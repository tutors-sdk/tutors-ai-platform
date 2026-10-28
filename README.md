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

The platform is built: every port has an adapter or a deliberate deferral, both apps have images,
and the infrastructure is code. It has not yet run on a real cluster.

| Area | State |
| --- | --- |
| Core: `AssistStudent`, `RecordEvidence`, `ApplyRetention`, `EvaluateCapability`, `ExplainLabInsights`, `RecommendInterventions` | Done; mutation score 100% |
| `@tutors/ai-contract` 0.1 (ADR 0002) | Done in `packages/contract` |
| Adapters: Ollama, course export, PostgreSQL (evidence, memory, insights), OpenTelemetry, system clock | Done, each through its contract kit; Ollama and PostgreSQL also against real services in CI |
| `apps/inference-api` and `apps/insights-worker` | Done, with Containerfiles; CI builds both images and pushes from `main` when registry credentials are set |
| Evaluation harness (`pnpm eval`) | Done; waits on golden sets |
| Infrastructure: OpenShift overlays, ROSA HCP Terraform, policy checks | Written and checked in CI; never applied to a cluster or an AWS account |
| Golden sets, ten cases per level | Need a lecturer |
| Production model pin (Qwen 3.8 27B, ADR 0005) | Needs a first pull in staging (`infra/openshift/pin-model.sh`) |
| Identity (Keycloak) and the release gate | Deferred (ADR 0005) |
| Tool harness for MCP capabilities (ADR 0008, proposed) | `ToolHarness`, `ToolHost` and `ToolAudit` ports, the MCP adapter and per-server resilience; no tool granted or wired yet |
| Governed memory with MemoryHub (final-year project) | Ports and planned specs ready (ADR 0006, accepted); guide in `docs/projects/governed-memory.md` |

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
    resilience/          circuit breaker, retry and bulkhead around the model and each tool server
    mcp/                 ToolHost over MCP Streamable HTTP, the only package that speaks MCP to tools
    postgres/            EvidenceStore and LearnerMemory, scope and retention enforced in SQL
    course-content/      CourseContent over a Tutors course export
    otel/                Telemetry over OpenTelemetry: spans, per-level metrics, nothing per learner
    system/              the system Clock
  testing/               contract-test kits, fakes and builders, written against ports
docs/
  adr/                   architecture decision records
  c4/                    the C4 model as code (Structurizr DSL)
  projects/              guides for project work built on the platform
  observability.md       spans, metrics, alerts and logs, and what new code must emit
  evaluation/            the evaluation harness: golden sets through a running inference API, judges, drift
apps/
  inference-api/         composition root for the request path, over HTTP, and its Containerfile
  insights-worker/       composition root for the nightly insights run, and its Containerfile
scripts/                 the EARS gate, the dependency boundary check, the mutation gate
infra/
  openshift/             kustomize base and staging/production overlays, network policies, model pin
  aws/                   ROSA HCP cluster, VPC, GPU pool and EFS in Terraform
  ci/                    check.sh and the conftest policies CI runs on every overlay
```

`adapters/keycloak` and the release gate are deferred (ADR 0005). See `infra/README.md` to stand
up staging.

## Dependency rules

| From | May import | Must not import |
| --- | --- | --- |
| `core` | nothing outside itself | any package, Node built-in, adapter, app or infra |
| `contract` | `core` types, its own libraries | adapters, apps, testing |
| `adapters/*` | `core` ports, its own client library | other adapters, contract, apps; the MCP SDK outside `adapters/mcp` and `adapters/memoryhub` |
| `apps/*` | `core`, `contract`, any adapter | `infra` |
| `evaluation` | `core`, `testing`, `contract` | adapters directly (it goes through the composition root) |
| `testing` | `core` | adapters (fakes are written against ports) |

`pnpm lint` enforces these through `scripts/check-boundaries.mjs`.

## Working on it

See [CONTRIBUTING.md](CONTRIBUTING.md) for how a port, an adapter or a contract change is added.

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

### In containers

`compose.yaml` runs the whole platform locally: PostgreSQL, Ollama, the OpenTelemetry collector,
the inference API and (on demand) the insights worker, each built from its Containerfile and
locked down as the cluster runs it. Course content is the synthetic fixtures. Works with
`docker compose` or `podman compose` (set `COMPOSE="podman compose"` to choose).

```sh
scripts/dev-up.sh                              # pulls the model, pins its digest in .env, starts the API on :8080
docker compose run --rm insights-worker        # one insights run, as the nightly CronJob does it
docker compose logs -f otel-collector          # the traces and metrics the API exports
docker compose --profile jobs down -v          # stop and delete the local data
```

`OLLAMA_MODEL=qwen3.8:27b scripts/dev-up.sh` uses the release model instead of the small CPU one.

The images are `quay.io/<org>/tutors-ai-inference-api` and `quay.io/<org>/tutors-ai-insights-worker`
(UBI 9 Node 22 minimal, non-root, one bundled file each). CI builds and smoke-tests both on every
pull request and starts the compose stack end to end. Pushes to `main` publish `main` and
`sha-<commit>`; a `v*` tag publishes the version (`v0.1.0` becomes `0.1.0`). Publishing needs the
repository secrets `QUAY_ROBOT_USERNAME` and `QUAY_ROBOT_TOKEN` (a quay.io robot account with
write access); without them CI builds but pushes nothing. The organisation is the repository
variable `QUAY_ORG` (default `tutors-sdk`, the name the OpenShift overlays use).

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

The model sits behind a circuit breaker, a bounded retry and a bulkhead (ADR 0007), tuned with
`MODEL_CIRCUIT_FAILURES` (5), `MODEL_CIRCUIT_RESET_MS` (30000), `MODEL_RETRIES` (1),
`MODEL_RETRY_BASE_MS` (250), `MODEL_RETRY_MAX_MS` (2000), `MODEL_MAX_CONCURRENT` (4) and
`MODEL_MAX_QUEUED` (32). PostgreSQL waits are bounded by `PG_CONNECT_TIMEOUT_MS` (5000) and
`PG_STATEMENT_TIMEOUT_MS` (10000). Each circuit change, retry and shed call is one JSON log line
(`"msg":"model resilience"`).

```sh
pnpm --filter @tutors-ai/app-inference-api build && node apps/inference-api/dist/main.mjs
podman build -f apps/inference-api/Containerfile -t tutors-ai-inference-api .
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
