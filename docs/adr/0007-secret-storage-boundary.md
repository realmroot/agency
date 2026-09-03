# 0007: Secret storage boundary

- Status: Accepted
- Date: 2026-05-22

## Context

Agent configuration, runtime setup, and browser authentication need secret
material, while the control-plane database, APIs, event stream, logs, and UI are
durable or broadly observable surfaces.

## Decision

- Dedicated secret providers own raw secret material. Durable domain resources
  carry references or authenticated ciphertext only when a protocol requires
  server-side recovery.
- Product, transport, and observability layers operate on safe references rather
  than reusable credentials.

Observable secret validation, storage, projection, and redaction behavior is
specified in `spec/vaults.feature`, `spec/sessions.feature`, and
`spec/auth.feature`.

## Consequences

- Resource models carry safe references instead of reusable credentials.
- Secret rotation does not require rewriting ordinary domain rows.
- Features that require recoverable ciphertext must explicitly own encryption,
  key management, and lifetime policy.
