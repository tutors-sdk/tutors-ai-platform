# EARS specifications

Every driving and driven port in `src/ports/` has a specification here before it has code.
`pnpm ears` (run in CI) enforces three rules:

1. **Coverage.** Each file in `src/ports/driving/` and `src/ports/driven/` has a matching
   `spec/<driving|driven>/<name>.ears.md`. A new port without a spec fails the build.
2. **Form.** Each requirement is written in one of the EARS patterns:
   - Ubiquitous: `The <system> shall <response>.`
   - Event-driven: `When <trigger>, the <system> shall <response>.`
   - State-driven: `While <state>, the <system> shall <response>.`
   - Unwanted behaviour: `If <condition>, then the <system> shall <response>.`
   - Optional feature: `Where <feature>, the <system> shall <response>.`
3. **Traceability.** When a spec's `status` is `implemented`, every requirement id appears in at
   least one test name (a `*.test.ts` file or a contract kit under `packages/testing/src/kits/`).
   `planned` specs are linted for form only.

Requirement lines are written as `- **ID** text`, where `ID` starts with the spec's `id` prefix.
