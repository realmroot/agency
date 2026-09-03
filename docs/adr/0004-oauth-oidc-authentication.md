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
- The verified OAuth `client_id` selects the permitted credential profile.
  Direct clients use OAuth access tokens as Bearer credentials or as
  sender-constrained credentials with RFC 9449 DPoP. A credential presented
  through the wrong client profile is rejected without fallback.
- Browser clients use the authorization code flow with PKCE. The server-side
  application owns the callback and client authentication and must keep OAuth
  credentials out of URLs and ordinary logs. Browser JavaScript receives only
  the credential form defined by the selected web-client profile.
- JWT access tokens follow the RFC 9068 profile where JWT access tokens are
  used. AMA validates issuer, audience, expiry, client binding, and exact scopes
  before producing one normalized authorization context.
- Console Session WebSockets exchange the authenticated browser session for an
  opaque 30-second, single-use ticket bound to the exact Session and browser
  Origin. Agent SDK WebSockets continue to use DPoP.
- Native runner daemons use the authorization code flow with PKCE and an exact
  loopback redirect URI, short-lived access tokens, rotating refresh
  credentials, exact audience validation, and least-privilege scopes. Static
  runner tokens are unsupported.
- The protected Resource is `https://ama.tftt.cc/api`. Missing scopes grant no
  implicit owner authority.
- The HTTP authentication wall maps `GET` and `HEAD` to `<resource>:read` and
  mutations to `<resource>:write`; the exact scope authorizes the operation.
  Runner credentials remain limited to their registered runner workflow.
- Realmroot is the currently configured OAuth/OIDC provider. Provider-specific
  endpoints, claims, and client registration are adapter and deployment
  concerns, not AMA authentication semantics.

## Consequences

- OAuth 2.0, OpenID Connect, RFC 7636 PKCE, RFC 9068, RFC 9449, RFC 9700, and
  resource scopes define the authentication and authorization boundary.
- Replacing the provider does not require a new AMA authentication protocol.
- Every credential profile converges on one authorization context while
  retaining profile-specific transport protections.
- Clients cannot recover from a wrong credential profile through an implicit
  fallback.
