# 0007: Secret storage boundary

- Status: Accepted
- Date: 2026-05-22

## Context

Agent configuration, runtime setup, and browser authentication need secret
material, while the control-plane database, APIs, event stream, logs, and UI are
durable or broadly observable surfaces.

## Decision

- Secret values are stored in Cloudflare Secrets or an approved external Vault.
- D1 stores secret metadata, references, policy, snapshots, and authenticated
  ciphertext only where a protocol requires server-side persistence.
- Browser OAuth tokens are encrypted before D1 persistence.
- API responses, events, logs, and UI views never expose raw secret values.

## Consequences

- Resource models carry safe references instead of reusable credentials.
- Runtime setup must resolve secret references at the execution boundary.
- Secret rotation does not require rewriting ordinary domain rows.
- Features that require recoverable ciphertext must explicitly own encryption,
  key management, and lifetime policy.
