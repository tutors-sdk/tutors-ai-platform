# Contributing

The platform is a hexagon: a framework-free core, ports it owns, and adapters that plug into them.
Every change follows the same path, and CI checks each step. If you are here for a project, start
with its guide in `docs/projects/`.

## Setup

Node 22 and pnpm 10.

```sh
pnpm install
pnpm check      # typecheck, lint and dependency boundaries, EARS gate, unit and contract tests
pnpm mutation   # Stryker on the core, then: node scripts/check-mutation.mjs
```

`pnpm test:integration` needs real services; see the README.

## Adding a port

1. **Spec first.** Write `packages/core/spec/<driving|driven>/<name>.ears.md` with `status: planned`
   and requirements in EARS form (`packages/core/spec/README.md`). A port file without a spec fails
   CI.
2. **The interface.** `packages/core/src/ports/<driving|driven>/<name>.ts`, types only. Export it
   from `packages/core/src/index.ts`.
3. **For a driven port, the kit.** `packages/testing/src/kits/<name>.ts`: one `it(...)` per
   requirement, named with its id. Export it from `packages/testing/src/index.ts`.
4. **A fake that passes the kit.** `packages/testing/src/fakes/<name>.ts`, run in
   `packages/testing/test/fakes.contract.test.ts`. Use-case tests use the fake.
5. **For a driving port, the use case.** `packages/core/src/usecases/<name>.ts` and
   `packages/core/test/<name>.test.ts`, test names carrying requirement ids, mutation score 100%.
   It emits one span and traces every driven-port call ([docs/observability.md](docs/observability.md)).
6. **Flip the spec to `implemented`.** `pnpm ears` now fails until every requirement is traced.

## Adding an adapter

1. `packages/adapters/<name>/` with `package.json` named `@tutors-ai/adapter-<name>`, depending on
   `@tutors-ai/core` and its own client library only.
2. Run the port's kit against it. Tests that need the real service are `*.integration.test.ts`
   and read their endpoint from the environment.
3. Raise `PortError` for failures of the service; the core maps those to outcomes and its spans
   record the kind. Adapters create no spans of their own ([docs/observability.md](docs/observability.md)).
4. Wire it in the composition root (`apps/*/src/compose.ts`), the only place that names adapters,
   with its configuration in `apps/*/src/config.ts`.
5. Add it to the C4 model in `docs/c4/workspace.dsl`.
6. If it needs an in-cluster service, add the manifests to `infra/openshift/base` with a network
   policy, and pass `infra/ci/check.sh`.

## Changing the contract or a policy

The contract (`packages/contract`) is versioned and pinned by the monorepo (ADR 0002). Add fields
as optional; a breaking change bumps `CONTRACT_VERSION`. Policy changes are data, reviewed by a
lecturer.

## Decisions

A decision that changes the architecture gets an ADR in `docs/adr/`, numbered in order, with
context, decision and consequences.

## Pull requests

Small and spec first. Each one passes `pnpm check` and the mutation gate locally before it is
pushed. Never use real learner data; staging and tests use synthetic learners only (ADR 0005).
