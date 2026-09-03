# 0002: Canonical runtime and session boundary

- Status: Accepted
- Date: 2026-05-22

## Context

Enbor supports a first-party Pi-based runtime and external coding-agent
runtimes. Clients need one durable Session model and event stream regardless of
where or how execution occurs.

## Decision

- All agent products run as Session-selected runtimes behind the same AMA
  control plane and canonical Session event surface.
- `ama` is the first-party AMA/Pi runtime owned by the cloud control plane.
  `claude-code`, `codex`, and `copilot` are external runtimes launched, managed,
  observed, and translated by self-hosted `ama-runner` processes.
- Agent owns persona, instructions, policy, provider, model, skills, tools, and
  MCP connector configuration. Environment owns hosting mode, workspace,
  secrets, network, resource limits, and runtime configuration. Session owns
  runtime selection and immutable Agent and Environment snapshots.
- Session creation validates the exact runtime, provider, and model combination
  before allocating a workspace.
- `cloud` Environments execute through AMA-managed Cloudflare infrastructure;
  `self_hosted` Environments execute through registered self-hosted runners.
- Self-hosted runners heartbeat safe capability and load metadata, claim and
  renew leases, and use one outbound WebSocket per claimed Session for runtime
  and tool traffic. HTTP queue and lease APIs own dispatch, ownership, expiry,
  recovery, and audit.
- A self-hosted Session becomes active only after AMA authenticates and accepts
  its runner WebSocket. Duplicate, stale, or mismatched channels cannot submit
  results.
- Browsers, SDKs, and command-line helpers use AMA Session endpoints rather than
  connecting directly to sandbox- or runner-owned processes.
- Every runtime adapter translates provider, model, tool, workspace, policy,
  lifecycle, usage, and error activity into the canonical AMA Session event
  protocol before clients observe it.
- Workers AI is first-class. Other configured providers use adapters and are
  normalized for usage, policy, errors, and audit records.
- AMA does not define an incompatible runtime SDK or protocol. The Cloudflare
  Agents SDK is not the v1.0 runtime contract, though it may be added later as
  an adapter.

## Consequences

- Clients integrate with one Session contract while runtime adapters absorb
  provider and host differences.
- Runtime compatibility failures occur before workspace allocation.
- Runner lease ownership and live channel ownership remain explicit and
  auditable.
- Adding a runtime requires translation into the canonical event protocol.
