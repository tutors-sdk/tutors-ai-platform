---
id: PP
port: PolicyProvider
kind: driven
status: implemented
---

# PolicyProvider

Versioned pedagogical policy lookup. Policies are data from the contract package. Verified by the
kit in `packages/testing/src/kits/policy-provider.ts`.

- **PP-001** When asked for a known capability level, the PolicyProvider adapter shall return a policy for exactly that level.
- **PP-002** If no policy exists for the course and level, then the PolicyProvider adapter shall return null.
- **PP-003** The PolicyProvider adapter shall return policies with an id, a version, a known maximum depth, a known memory scope and positive length and material limits.
