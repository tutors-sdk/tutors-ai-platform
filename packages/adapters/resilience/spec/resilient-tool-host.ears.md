---
id: RTH
port: ToolHost
kind: adapter
status: implemented
---

# Resilient ToolHost

A decorator around any `ToolHost` adapter that keeps one failing or saturated tool server from
holding up the exchanges that use it, or the other servers (docs/adr/0008). It applies the
circuit breaker and bulkhead of ADR 0007 to each server separately, and never retries: a tool may
not be safe to run twice. Verified by `packages/adapters/resilience/test/resilient-tool-host.test.ts`.

"Fails as unavailable or timeout" means the wrapped host raised a `PortError` of that kind. Any
other outcome, including `invalid-response` and `rejected`, means the server answered.

- **RTH-001** While a server's circuit is closed, the resilient ToolHost shall pass each admitted listing and call for that server to the host it wraps.
- **RTH-002** When the configured number of consecutive listings or calls to one server fail as unavailable or timeout, the resilient ToolHost shall open that server's circuit and leave every other server's circuit as it was.
- **RTH-003** While a server's circuit is open, the resilient ToolHost shall fail each listing and call for that server with an `unavailable` port error without calling the host it wraps.
- **RTH-004** When the reset period has passed since a server's circuit opened, the resilient ToolHost shall admit exactly one probe to that server, closing the circuit if the server answers and opening it again if the probe fails as unavailable or timeout.
- **RTH-005** The resilient ToolHost shall count an `invalid-response` or `rejected` failure as an answer from the server, not as a failure of the server.
- **RTH-006** The resilient ToolHost shall not retry a listing or a call.
- **RTH-007** While the configured number of calls to a server are in flight, the resilient ToolHost shall queue further calls to that server in arrival order up to the configured queue length, fail a call that finds the queue full with an `unavailable` port error, and fail a queued call whose timeout passes with a `timeout` port error, giving an admitted call only the time that remains.
- **RTH-008** When a server's circuit changes state or a call to it is shed, the resilient ToolHost shall report the event, naming the server, to its observer.
