# Golden sets

Golden sets are versioned data, curated with lecturers, and validated by the `GoldenSet` schema in
`../src/schema.ts`. Each case is a learner context, a question and the expected outcome: an answer at
or below a depth with expected citations, or a refusal.

Record the first ten cases per capability level with a lecturer and add them here as `<level>.json`.
None are committed yet, because they need a lecturer's judgement rather than an engineer's guess.

Run a set against a running inference API with the harness in `packages/evaluation`:

```sh
pnpm eval --api http://localhost:8080 --golden packages/contract/golden/first-year.json \
  --previous accepted/first-year.json --out reports/first-year.json
```

It exits 0 only when every case passes the deterministic judges (bound, citation, memory, latency)
and nothing regressed against the previous accepted run. Model judges report scores without gating
until they are calibrated against lecturer ratings.
