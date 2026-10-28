---
id: TH
port: ToolHost
kind: driven
status: implemented
---

# ToolHost

The servers that run tools, addressed by configured name (docs/adr/0008). Only the ToolHarness
calls it. Verified by the kit in `packages/testing/src/kits/tool-host.ts`.

- **TH-001** When asked to list a server's tools, the ToolHost adapter shall return every tool the server offers, each naming that server, with its name, description, input schema and whether the server declares it read-only.
- **TH-002** The ToolHost adapter shall give each definition the digest `sha256:` followed by the SHA-256 of its canonical definition in hex, so that an unchanged definition keeps its digest and a changed one does not.
- **TH-003** When asked to call a tool, the ToolHost adapter shall send the arguments unchanged and return the text content joined in order, whether the tool reported an error, and how many non-text parts were dropped.
- **TH-004** If the server is not configured or cannot be reached, then the ToolHost adapter shall fail with an `unavailable` port error.
- **TH-005** If the timeout passes before the server answers, then the ToolHost adapter shall fail with a `timeout` port error.
- **TH-006** If the server refuses a call, for example for a tool it does not offer, then the ToolHost adapter shall fail with a `rejected` port error.
