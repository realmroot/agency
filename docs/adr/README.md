# Architecture Decision Records

This directory records consequential, hard-to-reverse decisions whose context
and trade-offs need to survive beyond the implementation that introduced them.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-environment-and-sandbox-lifecycle.md) | Accepted | Environment and sandbox lifecycle |
| [0002](0002-canonical-runtime-and-session-boundary.md) | Accepted | Canonical runtime and session boundary |
| [0003](0003-openapi-sdk-and-cli-ownership.md) | Accepted | OpenAPI, SDK, and CLI ownership |
| [0004](0004-oauth-oidc-authentication.md) | Accepted | OAuth 2.0 and OpenID Connect authentication |
| [0005](0005-agent-identity-provider-contract.md) | Accepted | Agent identity provider contract |
| [0006](0006-governance-policy-hierarchy.md) | Accepted | Governance policy hierarchy |
| [0007](0007-secret-storage-boundary.md) | Accepted | Secret storage boundary |
| [0008](0008-specification-format-and-traceability.md) | Accepted | Specification format and traceability |
| [0009](0009-runner-object-model.md) | Accepted | Runner object model |

## Conventions

- Use a four-digit, monotonically increasing number. Numbers are never reused.
- Use one ADR for one decision or one tightly coupled decision set.
- Every ADR contains `Status`, `Context`, `Decision`, and `Consequences`.
- Valid statuses are `Proposed`, `Accepted`, `Deprecated`, and `Superseded`.
- Accepted ADRs are immutable historical records. A changed decision gets a new
  ADR; the old ADR links to its replacement and becomes `Superseded`.
- Product and API behavior belongs exclusively in `spec/*.feature`. Exact API
  shapes belong in generated OpenAPI. ADRs record rationale and trade-offs, not
  endpoint catalogs, request/response documentation, or acceptance criteria.

## Template

```md
# NNNN: Decision title

- Status: Proposed
- Date: YYYY-MM-DD

## Context

What forces and constraints require a decision?

## Decision

What was decided?

## Consequences

What becomes easier, harder, required, or intentionally unsupported?
```
