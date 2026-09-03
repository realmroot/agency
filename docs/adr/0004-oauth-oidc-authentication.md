# 0004: OAuth 2.0 and OpenID Connect authentication

- Status: Accepted
- Date: 2026-05-22

## Context

Browser users, direct API clients, Agents, and runner daemons require different
credential delivery mechanisms, but they must share one identity, tenancy,
scope, and audit model. The architecture must describe that boundary through
standard protocols rather than making one identity provider part of the product
contract.

## Decision

- AMA delegates authentication to a configured OAuth 2.0 authorization server
  and OpenID Connect identity provider. It follows the OAuth 2.0 Security Best
  Current Practice in RFC 9700 and does not implement a parallel authentication
  system or local user and organization directories.
- Browser, native, and Agent clients use standard OAuth profiles appropriate to
  their execution environment. Sender-constrained Agent access uses RFC 9449
  DPoP, and JWT access tokens use RFC 9068 when selected by the provider.
- All credential profiles normalize into one authorization context before AMA
  applies tenant and resource authorization.
- Realmroot is the currently configured OAuth/OIDC provider. Provider-specific
  endpoints, claims, and client registration are adapter and deployment
  concerns, not AMA authentication semantics.

Observable authentication and authorization behavior is specified in
`spec/auth.feature`.

## Consequences

- OAuth 2.0, OpenID Connect, RFC 7636 PKCE, RFC 9068, RFC 9449, RFC 9700, and
  resource scopes define the authentication and authorization boundary.
- Replacing the provider does not require a new AMA authentication protocol.
- Every credential profile converges on one authorization context while
  retaining profile-specific transport protections.
- Clients cannot recover from a wrong credential profile through an implicit
  fallback.
