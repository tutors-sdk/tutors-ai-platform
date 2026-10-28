---
id: TA
port: ToolAudit
kind: driven
status: implemented
---

# ToolAudit

The append-only record of every tool call an exchange attempted, from which any call can be
traced to a learner, a policy and a pinned tool definition. It holds identifiers and sizes, never
arguments or results (docs/adr/0008). Verified by the kit in `packages/testing/src/kits/tool-audit.ts`.

- **TA-001** When a record is appended, the ToolAudit adapter shall assign it a sequence number greater than any assigned before.
- **TA-002** The ToolAudit adapter shall return records exactly as appended, in ascending sequence order.
- **TA-003** When read, the ToolAudit adapter shall filter by course and, when given, by learner and a sequence to read after.
- **TA-004** The ToolAudit adapter shall leave every earlier record unchanged when another is appended.
- **TA-005** The ToolAudit adapter shall store only the fields of a tool call record, so that no argument or result text reaches the audit.
