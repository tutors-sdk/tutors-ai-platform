---
id: RES
port: LanguageModel
kind: adapter
status: implemented
---

# Resilient LanguageModel

A decorator around any `LanguageModel` adapter that keeps a failing or saturated model server
from taking the request path down with it (ADR 0007). It fails fast while the server is down,
retries a call only when the server could not be reached, never lets a call outlive its own
timeout, and bounds how many calls wait on the server at once. Verified by
`packages/adapters/resilience/test/`, including the model-based properties, and by the fault
catalogue in `packages/adapters/ollama/test/faults/`.

"Fails as unavailable or timeout" means the wrapped model raised a `PortError` of that kind.
Any other outcome, including `invalid-response` and `rejected`, means the server answered.

- **RES-001** While the circuit is closed, the resilient LanguageModel shall pass each admitted call to the model it wraps.
- **RES-002** When the configured number of consecutive calls fail as unavailable or timeout, the resilient LanguageModel shall open the circuit.
- **RES-003** While the circuit is open, the resilient LanguageModel shall fail each call with an `unavailable` port error without calling the model it wraps.
- **RES-004** When the reset period has passed since the circuit opened, the resilient LanguageModel shall admit exactly one probe call and refuse every other call while the probe is in flight.
- **RES-005** When a probe call gets an answer from the model, the resilient LanguageModel shall close the circuit.
- **RES-006** If a probe call fails as unavailable or timeout, then the resilient LanguageModel shall open the circuit again for another reset period.
- **RES-007** The resilient LanguageModel shall ignore the outcome of a call admitted before the circuit last changed state.
- **RES-008** The resilient LanguageModel shall count an `invalid-response` or `rejected` failure as an answer from the model, not as a failure of the server.
- **RES-009** If a call fails as unavailable, then the resilient LanguageModel shall retry it up to the configured number of retries, each after a delay drawn uniformly between zero and the backoff ceiling for that retry.
- **RES-010** If a call fails in any way other than unavailable, then the resilient LanguageModel shall not retry it.
- **RES-011** The resilient LanguageModel shall keep each call, with its queueing, retries and backoff, within the request's timeout, giving each attempt only the time that remains.
- **RES-012** While the configured number of calls are in flight, the resilient LanguageModel shall queue further calls in arrival order, up to the configured queue length.
- **RES-013** If a call arrives while the queue is full, then the resilient LanguageModel shall fail it at once with an `unavailable` port error.
- **RES-014** If a queued call's timeout passes before it is admitted, then the resilient LanguageModel shall fail it with a `timeout` port error and remove it from the queue.
- **RES-015** When asked to stream, the resilient LanguageModel shall apply the circuit and the bulkhead, and shall not retry a stream.
- **RES-016** When the circuit changes state, a call is retried, or a call is shed, the resilient LanguageModel shall report the event to its observer.
