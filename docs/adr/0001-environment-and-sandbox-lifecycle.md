# 0001: Environment and sandbox lifecycle

- Status: Accepted
- Date: 2026-05-22

## Context

Enbor needs reusable execution configuration without conflating that
configuration with a running container. Cloud and self-hosted execution also
need one stable resource model and an explicit network-policy owner.

## Decision

- `Environment` is long-lived sandbox hosting and workspace configuration, not
  a running sandbox.
- `Environment.hostingMode` is exactly `cloud` or `self_hosted`.
- Session and Trigger `runtime` is exactly `ama`, `claude-code`, `codex`, or
  `copilot`.
- Environments own hosting mode, workspace setup, safe secret references,
  network policy, resource limits, and runtime configuration.
- The Environment API exposes `hostingMode` and `runtimeConfig`; compatibility
  aliases for hosting or runtime image fields are not part of the public
  contract.
- `Sandbox` is an ephemeral workspace and runtime instance created from an
  Environment snapshot when the selected hosting mode and Session runtime
  require Cloudflare Sandbox.
- Every running `cloud` Session that requires Cloudflare Sandbox owns exactly
  one sandbox. Sandboxes follow the Session lifecycle and are never reused
  across Sessions.
- Cloudflare Sandbox owns filesystem, shell, process isolation, and the
  per-Session execution environment. It does not expose public ports or preview
  URLs as a product surface.
- Environment network policy is authoritative: `unrestricted` permits outbound
  network subject to governance policy, `restricted` requires explicit allowed
  hosts, and `offline` denies outbound sandbox network operations.

## Consequences

- Environments can be reused while every Session receives isolated runtime
  state.
- Session creation and teardown own sandbox allocation and cleanup.
- Network behavior is reviewable before execution and is not a runtime-specific
  side channel.
- Sandbox reuse and direct sandbox endpoints are intentionally unsupported.
