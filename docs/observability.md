# Observability

How the platform is observed, and what every new use case and adapter must do so that it is. The
`Telemetry` port (spec `TEL-*`) is the only way the core emits signals; `packages/adapters/otel`
turns them into OpenTelemetry, and the collector in `infra/openshift/base` hands them to OpenShift.

## Signals and where they go

| Signal | Emitted by | On OpenShift |
| --- | --- | --- |
| Traces | Use cases, through `Telemetry.startSpan` | Collector, debug exporter until a trace backend is chosen (see below) |
| Metrics | The OTel adapter, derived from spans | Collector `:8889`, scraped by user workload monitoring (`observability.yaml`) |
| Alerts | `PrometheusRule` `tutors-ai-platform` | OpenShift alerting |
| Logs | Apps, one JSON object per line on stdout | Cluster logging, if installed; the collector's log pipeline is reserved for OTLP logs |

Telemetry is lossy by design: an unreachable collector drops data rather than slow a learner
(`TEL-003`). It is therefore never audit evidence. What must be reconstructable (evidence, policy
decisions) goes through `EvidenceStore` or `DecisionLog`, which fail the request when they cannot
write.

## Spans

- **One root span per driving-port call**, named after the port: `AssistStudent`,
  `RecordReflection`. It carries the outcome (`assist.outcome`, a refusal reason or depth) and the
  policy version.
- **One child span per driven-port call**, named `<Port>.<operation>`: `LanguageModel.complete`,
  `LearnerMemory.recall`, `GovernedMemoryStore.search`. Use `traced(telemetry, span, name, call)`
  from `@tutors-ai/core`; it ends the span with `error` and records `port.error` (the
  `PortError` kind) when the call fails (`AS-018`).
- The clock is not traced.
- **Tools** ([ADR 0008](adr/0008-mcp-tool-harness.md)): `ToolHarness.open` and one
  `ToolHarness.call` per call attempt are children of the exchange's span. The open span carries
  `tools.offered` and `tools.excluded` (`server/tool:reason`, so a `definition-changed` tool is
  visible); a call span carries `tool.outcome` and `tool.refusal` or `port.error`, and
  `tool.server` and `tool.name` only for a granted tool, since a name the model made up is its
  text. `ToolHost.listTools`, `ToolHost.callTool` and `ToolAudit.append` are their
  children. Never arguments or results.
- Adapters do not create spans or take a `Telemetry`. They raise `PortError` with the right kind
  (`unavailable`, `timeout`, `invalid-response`, `rejected`), and the core's span records it. That
  keeps every adapter observable the same way, MemoryHub included, with no code of its own.

Because the root span and its children are one trace, a slow exchange shows which port spent the
time, and a failed one shows which port failed.

## Attributes

Allowed: `learner.level`, `course.id`, `policy.id`, `policy.version`, `model.digest`,
`model.tokens.in`, `model.tokens.out`, `port.error`, `tools.offered`, `tools.excluded`, `tool.server`
and `tool.name` (granted tools only), and `<capability>.<field>` outcome keys such as
`assist.outcome`, `assist.depth`, `assist.refusal`.

Never: learner, session or programme ids, cohort ids smaller than a course, and any text a learner
or the model wrote (questions, answers, reflections, memories). The OTel adapter drops per-learner
keys as a backstop (`TEL-002`), but it cannot recognise text; the rule is that the core never sets
it.

## Metrics

Derived from spans, so a new use case or port call gets them for free:

| Metric (Prometheus name) | Labels | Gives |
| --- | --- | --- |
| `tutors_ai.span.duration` (`tutors_ai_span_duration_milliseconds`) | `name`, `outcome`, and the allowed outcome labels | latency and error rate per use case and per port call |
| `tutors_ai.model.tokens` (`tutors_ai_model_tokens_total`) | `name`, `learner.level`, `direction` | model load by capability level |

Metric labels are an allow list (`METRIC_LABELS` in `packages/adapters/otel/src/telemetry.ts`).
Add a label only if it has a small, fixed set of values, and add a test beside `TEL-002` for it.

## Alerts

`infra/openshift/base/observability.yaml` alerts when any `<Port>.<operation>` span fails for more
than 5% of calls over ten minutes, and when `AssistStudent` p95 exceeds 20 s. Thresholds are
starting points; tune them in that file once staging has a baseline.

## Logs

One JSON object per line on stdout with a `msg` key, as `apps/*/src/main.ts` do. Start-up, shutdown
and batch summaries only: per-request detail belongs in spans. The same rule on learner data
applies.

## Adding a trace or log backend

The collector config in `infra/openshift/base/otel-collector.yaml` is the only place to change.
For traces on OpenShift, install the Red Hat build of Tempo, create a `TempoStack`, add an `otlp`
exporter pointing at its distributor to the `traces` pipeline, and allow the collector's egress to
it. For logs, add the matching exporter to the `logs` pipeline. Nothing in the apps changes.

## Checklist for a new use case or adapter

1. The use case's EARS spec has a span requirement (copy `AS-017` and `AS-018`), traced to tests
   that use `RecordingTelemetry` from `@tutors-ai/testing`.
2. Every driven-port call goes through `traced`.
3. Outcome attributes use the allowed keys; anything new is checked against the rules above.
4. A new adapter raises `PortError` with an accurate kind for every service failure.
5. A new in-cluster service gets a network policy and, if it exposes metrics, a `ServiceMonitor`.

## Known gaps

- `AssistStudent` and the insights worker (`InsightsRun`, one `InsightsRun.course` child per
  course) emit spans. `RecordEvidence` and `ApplyRetention` do not yet.
- The inference API does not continue a caller's `traceparent`, so a trace starts at the platform.
- Traces and logs still go to the collector's debug exporter.
- None of this has run on a cluster; check the Prometheus metric names on first deploy.
