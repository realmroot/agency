# 0001: Environment and sandbox lifecycle

- Status: Accepted
- Date: 2026-05-22

## Context

Enbor needs reusable execution configuration without conflating that
configuration with a running container. Cloud and self-hosted execution also
need one stable resource model and an explicit network-policy owner.

## Decision

- Separate reusable execution configuration from running execution state.
  Environment owns durable hosting, workspace, resource, and network policy;
  Sandbox is ephemeral execution infrastructure.
- Session owns the Sandbox lifecycle. Sandbox instances are isolated per
  Session rather than pooled as durable Environments.
- Hosting placement and runtime selection remain separate concerns so cloud and
  self-hosted execution share one Environment and Session model.
- Cloudflare Sandbox is the cloud execution substrate behind the product model,
  not a directly exposed public resource.

Observable Environment and Session behavior is specified in
`spec/environments.feature` and `spec/sessions.feature`.

## Consequences

- Reusable configuration no longer implies reusable execution state.
- Session orchestration must own allocation and cleanup across hosting modes.
- Runtime adapters cannot redefine workspace or network-policy ownership.
