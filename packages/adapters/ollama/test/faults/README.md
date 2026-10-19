# The fault tier

What the Ollama adapter, alone and behind the resilience decorator, does when the server or the
network in front of it misbehaves. Only `fetch` is replaced, by the scripted transport
(`transport.ts`); everything above it is the real code. Run it with
`pnpm vitest run packages/adapters/ollama/test/faults`. The canonical description of every tier
is [docs/testing.md](../../../../../docs/testing.md).

| File | What it is |
| --- | --- |
| `catalogue.ts` | The faults. Each has an id, the EARS requirement it checks and the whole expected outcome |
| `targets.ts` | `complete`, `stream`, and `resilient complete` (the decorator as the inference API wires it) |
| `transport.ts` | The scripted `fetch`: refused connections, statuses, chunked bodies, resets, stalls, slow headers |
| `runner.ts` | Serves a fault, observes settlement, request count, elapsed time and resilience events, and diffs them |
| `validate.ts` | The gate on the catalogue itself |
| `catalogue.selftest.test.ts` | The gate at zero, the weak fixture rejected on every count, the runner shown to fail |
| `transport-faults.test.ts` | Every fault on every target it applies to |
| `known-gaps.json` | Faults that expose an unfixed bug. Empty; it may only shrink (`scripts/check-ratchets.mjs`) |
| `fixtures/weak-fault.ts` | A fault that asserts too little. The self-test fails if the gate accepts it |

## The signal

A fault is worth having only if it can fail, so the tier proves it three ways:

1. **The gate.** `catalogueProblems()` rejects a fault whose requirement id is not defined in any
   `*.ears.md`, whose outcome leaves anything open (the error kind and an anchored message, or the
   answer; the exact request count; an elapsed-time window of at most 1 s; every resilience event),
   or whose exchange is the good one or another fault's. The weak fixture must be rejected on every
   count, and every `OLL-` requirement must be cited.
2. **The runner.** The self-test serves a real fault with wrong expectations and requires every
   broken invariant to be reported, then with the right ones and requires none.
3. **Mutation.** Stryker mutates the adapter with the catalogue among its tests
   (`mutation-baseline.json`).

## Writing a fault

- Start from the good exchange (`GOOD_EXCHANGE`) and change one thing.
- Cite the requirement that says what should happen. If none does, that is a specification gap:
  add the requirement to `packages/adapters/ollama/spec/ollama.ears.md` first.
- State the whole outcome, and derive counts from the target (`target.attempts`), not from a run:
  the expectation is what the requirement says, not what the code happens to do.
- A fault that fails because the adapter is wrong is a bug: fix it. Only a fix that is not yours
  to make goes in `known-gaps.json`, with the reason. A listed fault that starts passing fails the
  run until its entry is removed.

## What the catalogue found

Writing it turned up three behaviours that are now fixed and pinned: a body cut off cleanly before
Ollama's final line was reported as the model's bad JSON (`invalid-response`) instead of a broken
connection (`unavailable`, OLL-006); a non-JSON model list surfaced as "could not be reached"
(OLL-003); and a 400 was retried like an outage instead of being rejected (OLL-002).
