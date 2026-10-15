---
id: ID
port: Identity
kind: driven
status: planned
---

# Identity

Token validation and role resolution (OIDC; Keycloak on OpenShift by default). Planned for phase 2.

- **ID-001** When given a token issued by the configured realm and unexpired, the Identity adapter shall return the principal with its roles and capability level.
- **ID-002** If a token is invalid, expired, or issued by another realm, then the Identity adapter shall return null.
- **ID-003** If a token lacks the role an endpoint requires, then the Identity adapter shall resolve a principal without that role so the caller can refuse it.
