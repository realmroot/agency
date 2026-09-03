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
- External SDK behavior is generated from or mechanically aligned with the
  Hono-generated OpenAPI document and accepts request-aware DPoP authorization,
  never a raw Bearer-token shortcut.
- External runtime helpers delegate to AMA runtime endpoints. This repository
  does not accumulate bespoke SDK behavior that can drift from OpenAPI.
- The web console is an internal product entrypoint and uses the shared Hono RPC
  client for control-plane calls.
- This repository does not maintain a bespoke CLI protocol or API. Command-line
  and Agent automation discover the API through RFC 9728 protected-resource
  metadata and invoke operations described by OpenAPI.
- CLI clients obtain OAuth access tokens through their configured authorization
  server and create a fresh RFC 9449 DPoP proof when the selected client profile
  requires sender-constrained access.
- Agent-facing skills describe standard discovery, authorization, and OpenAPI
  operations. They do not introduce raw-token workflows or a separate runtime
  protocol. Realmroot Toolbox is the currently supported client implementation,
  not part of the AMA protocol contract.

## Consequences

- OpenAPI is the external source of truth for operations, fields, scopes, and
  response shapes.
- Public API changes must keep schemas, generated artifacts, and SDK behavior in
  sync.
- The web console keeps project-local type inference without redefining the
  external contract.
- CLI functionality evolves through the protected-resource and OpenAPI
  contracts rather than a second AMA command surface or a provider-specific
  protocol.
