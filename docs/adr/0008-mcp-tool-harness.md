# 0008. Tools reach a model only through a harness, with MCP as the first tool adapter

Date: 2026-10-28 · Status: Proposed

## Context

The platform will act as a harness for MCP capabilities: models answering students will be able
to use tools served by Model Context Protocol servers (a documentation search, a code runner, a
course glossary). No model uses a tool yet and no tool server is wired. That is the moment to
decide how tools are governed, because every later tool arrives into whatever seams exist.

Tools bring risks the request path does not have today:

- **Excess capability.** A model offered a tool will use it. Which tools a first-year student's
  assistant may touch is a pedagogical decision, like the depth of an answer (ADR 0004), not
  something a server or a model should decide.
- **Tool poisoning and silent change.** A tool's description and schema are text the model reads.
  A server can change them after the tool was reviewed, so the reviewed tool and the one in use
  differ without anyone noticing.
- **Untrusted output.** A tool's result is third-party content. Treated as instructions, it is a
  prompt-injection channel; treated as material, it would let the model cite something a lecturer
  never published (AS-010).
- **Leakage through arguments.** Arguments are written by the model and may carry what the
  learner typed to a server outside the platform.
- **Runaway cost and latency.** A model can call tools in a loop, and a slow server holds the
  exchange open.
- **Reverse requests.** MCP lets a server ask its client for model sampling, filesystem roots or
  user input. A platform that granted these would let a tool server drive our model.
- **Side effects.** A tool that writes can do harm that a refused answer cannot.

## Decision

**Tools are a driven port; the harness is in the core; MCP is an adapter.** The core gains a
`ToolHost` port (`TH-*`): list a server's tools, call one. `ToolHarness`, a core service
(`HAR-*`, specified in `packages/core/spec/services/`), is the only caller of `ToolHost`. A use
case opens a session for one exchange and offers the model only what the session offers. The core
never learns the transport. `@tutors-ai/adapter-mcp` implements `ToolHost` with the official MCP
TypeScript SDK; it and the planned MemoryHub adapter (ADR 0006) are the only packages allowed to
import the SDK, and `pnpm lint` enforces it.

**Deny by default; grants are policy data.** A pedagogical policy in the contract package may
carry a `tools` section: grants of `server`, `tool` and `digest`, and the exchange's limits. A
policy without one gives an exchange no tools, and the harness contacts no server. Grants are
per capability level, as everything else in a policy is. Nothing the model asks for or a server
offers can add a tool that no grant names (HAR-003, HAR-007).

**Definitions are pinned.** Each definition is identified by the SHA-256 of its canonical JSON
(name, title, description, input schema, read-only declaration). A grant names the digest that
was reviewed, and a tool whose definition has changed is withheld as `definition-changed` until
someone reviews it again and updates the grant (HAR-004). The digest is computed the same way by
every adapter, from `canonicalToolDefinition` in the core.

**Read-only tools only, for now.** A granted tool whose server does not declare it read-only is
withheld (HAR-005). The declaration is the server's hint, and the grant is the decision: both are
needed. A tool with side effects needs its own ADR, with human confirmation in the loop and the
real identity that ADR 0005 defers.

**Arguments are checked before they leave.** The harness enforces a declared subset of JSON
Schema (types, properties, required, additional properties, enum, items, lengths and bounds). A
tool whose schema uses anything else is withheld as `unsupported-schema` (HAR-006), so there is no
constraint the harness silently fails to enforce. Every call's arguments must be a JSON object,
within the policy's size limit, and valid against the schema; what is sent is a JSON copy of
exactly what was checked (HAR-010). The validator is property-tested against Ajv.

**Every exchange has a budget.** A maximum number of call attempts, refused ones included; a
wall-clock budget for all tool work from opening the session; a timeout per listing and call; and
a maximum result length, beyond which output is truncated and marked (HAR-008, HAR-009, HAR-012).

**Output is data.** A result is a typed `ToolCallOutcome`; its text is untrusted. The model
adapter must present it as a tool result, never as instructions, as prompts are already
adapter-owned (AS-006). Tool output is never material: citations stay material ids, so AS-010
still holds. Nothing a tool returns is kept as learner memory except through the governance
decisions of ADR 0006. Only text content is passed on; other parts are counted and dropped.

**Every attempt is audited, without content.** `ToolAudit` (`TA-*`) is an append-only record of
each call attempt: learner, session, course, policy, server, tool, pinned digest, outcome, reason,
sizes and time. Never arguments or results. If the record cannot be written, the call fails rather
than return what could not be recorded (HAR-013, HAR-014), as AS-016 does for evidence. Telemetry
is not the audit: each open and call is a span under the exchange's span (HAR-015).

**One failing server does not take an exchange down.** `ResilientToolHost` applies ADR 0007's
circuit breaker and bulkhead per server, sharing the `Guard` the model decorator now uses (`RTH-*`).
A listing that fails excludes that server's tools and keeps the rest. Tool calls are never
retried: the harness cannot know that a tool is safe to run twice.

**Transport.** Streamable HTTP only: no stdio servers, so no subprocesses in a pod. The platform
declares no client capabilities, so a server cannot ask it for sampling, roots or elicitation.
Credentials are per-server headers from mounted secrets. As with Ollama and MemoryHub, a network
policy will admit the inference API's egress to configured tool servers only.

## Defaults

| Setting | Where | Default |
| --- | --- | --- |
| Grants, `maxCalls`, `callTimeoutMs`, `exchangeBudgetMs`, `maxArgumentChars`, `maxResultChars` | the policy's `tools` | none: no policy grants a tool today |
| Circuit per server | `ResilientToolHost` | opens after 3 consecutive unavailable or timeout failures, probes after 30 s |
| Bulkhead per server | `ResilientToolHost` | 4 calls in flight, 16 queued |
| Pages followed when listing | `McpToolHost` | 10 |

## Not decided here

- **The agent loop.** How `AssistStudent` asks the model, offers it the session's tools and
  feeds results back changes the `LanguageModel` port and the `AS-*` spec. That is the first
  tool's pull request, written spec first.
- **MCP resources and prompts.** Prompts conflict with adapter-owned prompt templates; resources
  overlap `CourseContent`. Either can come through the same harness with its own ADR.
- **The platform as an MCP server.** Exposing the platform's own capabilities over MCP is a
  separate driving adapter.

## Consequences

- Before the first tool is wired, three things are still needed: a PostgreSQL `ToolAudit`
  adapter that passes the kit (the composition root must not wire the harness without a durable
  audit), configuration of servers in the inference API, and the network policy.
- Adding a tool is a data change: list the server's tools to read the digest, add a grant to the
  policy, run the contract tests, and add golden cases, including an injected instruction in a
  tool result that the answer must not follow.
- A server that changes a tool's description stops that tool until the grant is updated. That is
  the point, and it will be noticed as `definition-changed` in the `ToolHarness.open` span.
- Pinning a definition does not pin behaviour: a server can answer differently under the same
  description. Read-only grants, budgets, untrusted output and the audit bound what that can do.
- Circuits are per process, as in ADR 0007.
- MemoryHub stays outside the harness. It serves memory ports, governed by ADR 0006, and is never
  offered to a model as tools.
