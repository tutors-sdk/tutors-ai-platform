---
id: TEL
port: Telemetry
kind: driven
status: planned
---

# Telemetry

Tracing, model metrics and the evidence-trail log (OpenTelemetry by default). Planned for phase 2.

- **TEL-001** When a span is started, the Telemetry adapter shall export it with its attributes and outcome once it ends.
- **TEL-002** The Telemetry adapter shall aggregate model metrics per capability level and never per learner.
- **TEL-003** If the telemetry backend is unreachable, then the Telemetry adapter shall drop data rather than fail or delay the request.
