# 0005: Agent identity provider contract

- Status: Accepted
- Date: 2026-08-19

## Context

There is no adopted, provider-neutral standard protocol for enrolling and
operating an autonomous Agent identity. AMA still needs one Agent to retain a
stable identity across concrete runtimes without leaking private identity state
into resource rows, snapshots, events, or responses.

## Decision

- AMA defines a provider-neutral Agent Identity port because no adopted standard
  protocol owns this boundary.
- The port separates stable identity and issuer semantics from opaque
  provider-specific enrollment data.
- Runtime adapters preserve the selected Agent Identity rather than minting a
  runtime-specific identity.
- Private identity state and private keys remain secret material in an AMA Vault.
- AMA does not proxy identity-provider business API traffic, issue provider
  authority, or inject a controller's identity into the Agent runtime.
- Realmroot is the first Agent identity provider adapter. Its enrollment state,
  Toolbox client, runtime identity value, and credential format implement this
  contract; they do not define a universal Agent identity protocol.

Observable Identity lifecycle and Session materialization behavior is specified
in `spec/identities.feature` and `spec/sessions.feature`.

## Consequences

- Agent identity is stable across runtime implementations and attributable to
  the Agent rather than borrowed from its controller.
- Provider-specific identifiers and credential formats stay behind an Agent
  identity adapter.
- Secret Agent state is isolated from durable product and audit records.
- Supporting another provider requires an adapter to the common port; it does
  not require pretending that a standard Agent identity protocol exists.
