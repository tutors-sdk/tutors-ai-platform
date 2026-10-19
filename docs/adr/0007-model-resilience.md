# 0007. Resilience around the model and the database

Date: 2026-10-19 · Status: Proposed

## Context

The request path has two dependencies that fail in different ways. Ollama on one GPU worker
answers a handful of calls at a time and can disappear for minutes while a node drains or a model
reloads. Before this change every call waited out its full `MODEL_TIMEOUT_MS` (30 s) against a
server that was down, nothing bounded how many calls piled onto a slow server, and the PostgreSQL
pool had neither connection nor statement timeouts nor an `error` listener, so a database restart
could crash the API process outright.

ESI.ts, which we use as the reference for client resilience and testing, solves the same class of
problem with a per-endpoint circuit breaker, jittered retry inside a budget, and a fault catalogue
that proves each behaviour.

## Decision

- **A decorator, not a core concern.** `@tutors-ai/adapter-resilience` wraps any `LanguageModel`
  in a `ResilientLanguageModel`. The core keeps mapping a `PortError` to a `model-unavailable`
  refusal (AS-006); it never learns that a circuit exists. Its behaviour is specified in
  `packages/adapters/resilience/spec/resilient-language-model.ears.md` (RES-001 to RES-016).
- **Circuit breaker.** Five consecutive `unavailable` or `timeout` failures open it; while open,
  calls fail at once without reaching Ollama; after 30 s one probe is let through and its answer
  closes or reopens the circuit. `invalid-response` and `rejected` mean the server answered and do
  not count. Outcomes of calls admitted before a state change are ignored.
- **Retry only what can help.** One retry, only for `unavailable` (the server could not be
  reached), after a full-jitter delay between 0 and 250 ms doubling to at most 2 s. A timeout is
  never retried: it would double the wait for a server that is already too slow.
- **One budget.** Queueing, every attempt and every backoff share the request's
  `MODEL_TIMEOUT_MS`; each attempt is given only the time that remains.
- **Bulkhead.** At most 4 calls in flight and 32 queued, first come first served. A call that
  finds the queue full is shed at once; one still queued at its timeout fails as `timeout`.
- **PostgreSQL.** 5 s to get a connection, 10 s per statement, and an `error` listener on every
  pool.
- All of it is tunable per environment (`MODEL_CIRCUIT_*`, `MODEL_RETRY_*`, `MODEL_MAX_*`,
  `PG_*_TIMEOUT_MS`), and every circuit change, retry and shed call is logged as one JSON line.

## Consequences

- During an Ollama outage learners get an immediate "assistant unavailable" refusal instead of a
  30 s hang, and the API stops adding load to a server that is trying to recover.
- `/readyz` still checks only PostgreSQL. An open circuit must not take pods out of the Service:
  every replica would open together and the API would vanish instead of refusing politely.
- The circuit is per process. With several replicas each learns of an outage on its own, which
  costs at most `MODEL_CIRCUIT_FAILURES` slow calls per replica.
- The defaults suit one GPU worker; a larger serving tier raises `MODEL_MAX_CONCURRENT`.
- These behaviours are verified by unit tests, model-based properties, the Ollama fault catalogue
  and a chaos step in the containerised end-to-end job ([docs/testing.md](../testing.md)).
