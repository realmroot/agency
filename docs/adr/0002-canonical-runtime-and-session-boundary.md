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
- Agent owns persona, instructions, policy, provider, model, skills, tools, and
  MCP connector configuration. Environment owns hosting mode, workspace,
  secrets, network, resource limits, and runtime configuration. Session owns
  runtime selection and immutable Agent and Environment snapshots.
- First-party and external runtime implementations sit behind the same runtime
  port and canonical event vocabulary.
- Self-hosted runners own host execution while AMA retains Session lifecycle,
  dispatch, authorization, and event ownership.
- Browsers, SDKs, and command-line helpers use AMA Session endpoints rather than
  connecting directly to sandbox- or runner-owned processes.
- Every runtime adapter translates provider, model, tool, workspace, policy,
  lifecycle, usage, and error activity into the canonical AMA Session event
  protocol before clients observe it.
- Model providers sit behind adapters and are normalized before their activity
  crosses the canonical Session boundary.
- AMA does not define an incompatible runtime SDK or protocol. The Cloudflare
  Agents SDK is not the v1.0 runtime contract, though it may be added later as
  an adapter.

Observable runtime, runner, and Session behavior is specified in
`spec/runtime.feature`, `spec/runners.feature`, and `spec/sessions.feature`.

## Consequences

- Clients integrate with one Session contract while runtime adapters absorb
  provider and host differences.
- Adding a runtime requires translation into the canonical event protocol.
