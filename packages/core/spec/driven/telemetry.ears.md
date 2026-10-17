---
id: TEL
port: Telemetry
kind: driven
status: implemented
---

# Telemetry

Tracing, model metrics and the evidence-trail log (OpenTelemetry by default).

- **TEL-001** When a span is started, the Telemetry adapter shall export it with its attributes and outcome once it ends.
- **TEL-002** The Telemetry adapter shall aggregate model metrics per capability level and never per learner.
- **TEL-003** If the telemetry backend is unreachable, then the Telemetry adapter shall drop data rather than fail or delay the request.
- **TEL-004** When a span is started with a parent, the Telemetry adapter shall export it as a child of that parent in the same trace.
