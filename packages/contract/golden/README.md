# Golden sets

Golden sets are versioned data, curated with lecturers, and validated by the `GoldenSet` schema in
`../src/schema.ts`. Each case is a learner context, a question and the expected outcome: an answer at
or below a depth with expected citations, or a refusal.

Phase 1 records the first ten cases per capability level with a lecturer, before the harness can run
them (the harness arrives in phase 3). Add them here as `<level>.json`; none are committed yet,
because they need a lecturer's judgement rather than an engineer's guess.
