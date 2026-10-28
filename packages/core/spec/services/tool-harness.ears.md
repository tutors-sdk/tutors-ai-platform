---
id: HAR
port: ToolHarness
kind: service
status: implemented
---

# ToolHarness

The only way the platform reaches a tool (docs/adr/0008). A use case opens a session for one
exchange; the session offers the model only what policy grants, as the definition was reviewed,
and checks every call before it leaves the platform. Nothing the model or a tool server says can
widen what is granted. Verified by `packages/core/test/tool-harness.test.ts` and the model-based
property in `packages/core/test/tool-harness.property.test.ts`.

"Refuse" means the call returns a `refused` outcome with the reason named, without calling the
ToolHost. Each refusal's detail is written by the harness, never copied from a tool or server.

- **HAR-001** If the exchange's policy has no tool policy or grants no tools, then the ToolHarness shall open a session with no tools without contacting any tool server.
- **HAR-002** When a session is opened, the ToolHarness shall list the tools of each server a grant names, once per server, within the call timeout or the time left in the exchange budget, whichever is shorter, and if a listing fails with a port error, then the ToolHarness shall exclude that server's grants as `server-unavailable` and continue with the others.
- **HAR-003** The ToolHarness shall offer the model only tools that a grant names, ignoring every other tool a server offers and every definition that names a different server.
- **HAR-004** If a granted tool is not offered by its server, then the ToolHarness shall exclude it as `not-offered`, and if it is offered but with a digest other than the grant's, then the ToolHarness shall exclude it as `definition-changed`.
- **HAR-005** If a granted tool's definition does not declare it read-only, then the ToolHarness shall exclude it as `not-read-only`.
- **HAR-006** If a granted tool's input schema is not an object schema within the enforceable subset, then the ToolHarness shall exclude it as `unsupported-schema`.
- **HAR-007** If a call names a tool the session does not offer, then the ToolHarness shall refuse it with reason `not-granted`.
- **HAR-008** If a call is beyond the policy's maximum number of calls per exchange, counting refused calls, then the ToolHarness shall refuse it with reason `budget-exhausted`.
- **HAR-009** If the exchange's time budget has been spent, then the ToolHarness shall refuse a call with reason `budget-exhausted`; otherwise it shall give the call the call timeout or the time left, whichever is shorter.
- **HAR-010** If a call's arguments are not a JSON object, are longer as JSON than the policy allows, or break the tool's input schema, then the ToolHarness shall refuse it with reason `invalid-arguments` and a detail naming the first problem; otherwise it shall send a JSON copy of exactly the arguments it checked.
- **HAR-011** If the tool server fails with a port error, then the ToolHarness shall return a `failed` outcome with the port error's kind; any other error shall propagate.
- **HAR-012** When a tool answers, the ToolHarness shall return its text truncated to the policy's maximum result length, marked as truncated when it was cut, with the tool's error flag and the count of dropped non-text parts.
- **HAR-013** When a call's outcome is decided, the ToolHarness shall append exactly one record to the ToolAudit naming the learner, session, course, policy, server, tool (at most 200 characters of each), pinned digest, outcome, reason, argument and result sizes, and elapsed time, and no argument or result text.
- **HAR-014** If the audit record cannot be appended, then the ToolHarness shall fail the call rather than return an outcome it could not record.
- **HAR-015** The ToolHarness shall open each session and make each call in its own span under the exchange's span, carrying the outcome, the refusal reason or port error kind, and the server and tool only when the session offers that tool, and shall make every driven-port call within a child span named `<Port>.<operation>`.
