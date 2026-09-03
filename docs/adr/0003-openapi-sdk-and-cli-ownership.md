# 0003: OpenAPI, SDK, and CLI ownership

- Status: Accepted
- Date: 2026-05-22

## Context

External automation, generated SDKs, and the internal web console have different
transport and authentication needs. Maintaining separate hand-authored clients
would allow the public contract to drift.

## Decision

- This repository publishes the control-plane OpenAPI document and temporarily
  maintains generated SDK scaffolds under `sdk/typescript`, `sdk/go`, and
  `sdk/python` until SDK release ownership moves elsewhere.
- The TypeScript SDK is the only SDK pnpm workspace. Go and Python use their
  language-native package metadata.
- External SDKs are generated from or mechanically aligned with the
  Hono-generated OpenAPI document. Non-HTTP runtime helpers stay thin and do
  not redefine the public contract.
- The web console is an internal product entrypoint and uses the shared Hono RPC
  client for control-plane calls.
- This repository does not maintain a bespoke CLI protocol or API. Command-line
  and Agent automation discover the API through RFC 9728 protected-resource
  metadata and invoke operations described by OpenAPI.
- Agent-facing skills point clients to standard discovery, authorization, and
  OpenAPI mechanisms rather than copying the API into Markdown. Realmroot
  Toolbox is the currently supported client implementation, not part of the AMA
  protocol contract.

Observable SDK, client, and API behavior is specified in
`spec/api-contracts.feature` and `spec/auth.feature`.

## Consequences

- OpenAPI is the external source of truth for protocol shapes.
- Public API changes require regenerated artifacts.
- The web console keeps project-local type inference without redefining the
  external contract.
- CLI functionality evolves through the protected-resource and OpenAPI
  contracts rather than a second AMA command surface or a provider-specific
  protocol.
