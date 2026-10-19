# Testing

How the platform is tested: what each tier owns, where it lives, how to run it, where CI runs it,
and the signal that proves it can fail. The approach is ported from ESI.ts, adapted to a pnpm
workspace, Vitest and a hexagonal design. Resilience behaviour itself is in
[ADR 0007](adr/0007-model-resilience.md).

## The stance

1. **A tier that cannot fail manufactures confidence.** Each tier owns one class of failure and
   carries a signal that proves it can go red: a negative fixture, a known-bad implementation, a
   planted leak, a weak suite. A green run from a tier with no such signal says nothing.
2. **Every gate is a one-way ratchet.** Mutation floors only rise; the determinism baseline and the
   fault catalogue's known gaps only shrink. `pnpm ratchets` compares each with the base ref, so a
   pull request cannot exempt itself, and fails closed when it cannot read the base.
3. **The specification executes.** Behaviour is written as EARS requirements, one `shall` each, and
   `pnpm ears` fails until every implemented requirement is named by a test or cited by a fault.

## The tiers

| Tier | Location | Command | Where CI runs it | Signal that it can fail |
| --- | --- | --- | --- | --- |
| Static analysis | `scripts/check-*.ts`, `scripts/check-boundaries.mjs`, ESLint | `pnpm lint`, `pnpm lint:suite-health`, `pnpm lint:determinism` | PR and push (`check`) | Each lint runs against negative and compliant fixtures in `scripts/test/` |
| Specification (EARS) | `packages/core/spec/`, `packages/adapters/*/spec/` | `pnpm ears` | `check` | A requirement no test names or no fault cites fails the gate |
| Unit and use case | `packages/*/test/`, `apps/*/test/` | `pnpm test --project unit` | `check` | Mutation floors |
| Port contracts | `packages/testing/src/kits/` | inside the unit run | `check` | A fake or adapter that breaks a requirement fails its kit |
| Properties | `**/*.property.test.ts` | inside the unit run (100 runs); `pnpm test:properties` (10,000) | `check`; nightly | Each model-based property must find a counterexample against registered known-bad implementations |
| Fault injection | `packages/adapters/ollama/test/faults/` | inside the unit run | `check` | The weak fixture must be rejected on every count; the runner must report every broken invariant |
| Mutation | Stryker per package | `pnpm mutation`, `pnpm mutation:fixture` | `mutation`; nightly | The known-weak fixture in `scripts/mutation-fixture/` must keep survivors and lose some |
| Integration | `**/*.integration.test.ts` | `pnpm test:integration` | `integration` (Ollama CPU model, PostgreSQL) | Real services; skips only when their URL is unset |
| Heap soak | `apps/inference-api/test/heap.soak.test.ts` | `pnpm test:soak` | `soak` (10,000 requests); nightly (200,000) | A planted 2 KiB-per-request leak must be flagged |
| End to end and chaos | `compose.yaml`, `scripts/chaos.sh` | `scripts/dev-up.sh && scripts/chaos.sh` | `compose` | Asserts fail-fast, recovery and survival against a stopped Ollama and a restarted PostgreSQL |
| Order dependence | the unit run, shuffled | `pnpm vitest run --project unit --sequence.shuffle --sequence.seed=<n>` | nightly, three seeds, no retries | A test that depends on another's state fails under some order |

`ci-success` fans in every job in `ci.yml`; it is the one check branch protection needs.

## Static analysis

| Command | What it rejects | Baseline |
| --- | --- | --- |
| `pnpm lint` | ESLint rules, and imports that point the wrong way across the hexagon | none |
| `pnpm lint:suite-health` | `.only`, `.skip`, `.todo`, `.fails`, `skipIf`/`runIf` outside integration and soak tests, fake timers and console spies never restored | none: every finding fails |
| `pnpm lint:determinism` | `Date.now()`, `new Date()`, `Math.random`, `performance.now()`, `process.hrtime`, timers and `AbortSignal.timeout()` in production code outside the clock modules (`packages/adapters/system`, the resilience `Timer`) | `scripts/determinism-baseline.json`, shrink-only |

A test that makes no assertion fails at run time: `expect.requireAssertions` is on for every
project in `vitest.config.ts`. Comments, strings and regex literals are blanked before the lints
match, so a test may talk about `it.only(` without tripping them.

## Properties

Model-based properties drive the real implementation and a reference model of the specification
with the same random command sequence and require them to agree. Each has known-bad
implementations beside it, and `expectCounterexample` fails if the property cannot catch them.

| File | Invariant | Known-bad implementations it must catch |
| --- | --- | --- |
| `resilience/test/circuit-breaker.property.test.ts` | The breaker matches the closed/open/half-open model under any sequence of overlapping calls (RES-002 to RES-007) | counts every failure, lets every call through while half-open, acts on stale outcomes, never half-opens |
| `resilience/test/bulkhead.property.test.ts` | Admits, queues and refuses as the policy says, first come first served (RES-012 to RES-014) | LIFO queue, unbounded queue, a place lost when a queued call gives up |
| `resilience/test/deadline.property.test.ts` | A call settles within its timeout and retries only unavailable attempts, for any latencies and outcomes (RES-009 to RES-011) | a retry that gives every attempt the full timeout |
| `resilience/test/backoff.property.test.ts` | Every delay is a whole number between zero and a capped, non-decreasing ceiling | a backoff without a cap |

`FC_NUM_RUNS` (default 100), `FC_SEED` and `FC_PATH` fail closed: a malformed value stops the run.
A failure prints the seed and path; replay it with
`FC_SEED=<seed> FC_PATH=<path> pnpm vitest run --project unit <file>`. Commit a counterexample as a
named example test before fixing it; never weaken a generator or invariant to make one go away.

## Fault injection

The catalogue serves every way Ollama or the network can misbehave through a scripted `fetch` to
the adapter's `complete` and `stream`, and to `complete` behind the resilience decorator. Each
fault cites the requirement that specifies the answer (LM, OLL, RES) and states the whole outcome:
error kind and anchored message or the answer, the exact request count (derived from the target's
attempts, not from a run), an elapsed-time window of at most 1 s, and every resilience event.
How to write one, and what it has found, is in
[its README](../packages/adapters/ollama/test/faults/README.md).

## Mutation

| Package | Floor | Why |
| --- | --- | --- |
| `packages/core` | 100% | The domain and use cases |
| `packages/adapters/resilience` | 100% | Small, pure, and every branch is a resilience decision |
| `packages/adapters/ollama` | 80% | Measured 82.8% when it joined; the prompt text accounts for most survivors |

`pnpm mutation` runs Stryker in each package, one at a time; `node scripts/check-mutation.mjs`
scores the reports against `mutation-baseline.json`. `pnpm mutation:fixture` runs first in CI: a
gate that reports 100% for a weak suite, or 0% for any suite, measures nothing.

## The heap soak

`pnpm test:soak` drives `SOAK_REQUESTS` (default 20,000) requests, eight at a time, through the
real HTTP handler, use cases and resilience decorator, with stateless doubles behind the ports so
anything that accumulates is the code under test. It forces a collection at 40 sample points and
fails when a least-squares fit over the second half projects more than 4 MiB of growth, or when a
timer outlives the server. The same run with a planted leak must be flagged.

## Chaos

`scripts/chaos.sh` runs against the compose stack. With Ollama stopped, assist requests must come
back at once as `model-unavailable` refusals and the circuit must open; with Ollama back, a probe
must close it; with PostgreSQL restarted, the API process must survive, `/readyz` must go 503 and
then 200, and evidence must be recorded again.

## Nightly

`.github/workflows/nightly.yml` runs properties at 10,000 runs, the unit suite three times in
random order with no retries, the soak at 200,000 requests and the full mutation run. A failure
keeps one issue, "Nightly quality failing", open until a night passes.

## Not ported from ESI.ts, and why

- **Recorded replay and live contract tests against the upstream API.** ESI.ts consumes a public
  API with a published OpenAPI spec; here the contract is our own package, already tested in
  `packages/contract`.
- **Interleaving scheduler.** The bulkhead and breaker properties already explore overlapping
  calls; there is no cache or deduplication layer whose interleavings need a scheduler.
- **Benchmarks with A/B statistics, consumer tarball matrix, API surface diff, size budgets.**
  Nothing here is published as a library. Worth adding if `@tutors/ai-contract` is ever published.
