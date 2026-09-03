# 0005: Agent identity provider contract

- Status: Accepted
- Date: 2026-08-19

## Context

There is no adopted, provider-neutral standard protocol for enrolling and
operating an autonomous Agent identity. AMA still needs one Agent to retain a
stable identity across concrete runtimes without leaking private identity state
into resource rows, snapshots, events, or responses.

## Decision

- AMA defines a provider-neutral Agent identity contract. An Identity has an AMA
  identity resource id, provider Agent id, issuer, stable subject, username,
  runtime binding, and credential reference.
- The issuer and subject identify the Agent at the identity-provider boundary.
  The provider Agent id is opaque provider data and is not substituted for the
  stable subject unless a provider explicitly guarantees they are identical.
- One AMA Agent may bind to one enrolled Agent Identity. That same identity is
  preserved when the Agent executes through `ama`, `codex`, `claude-code`, or
  `copilot`; a runtime adapter does not create a new identity.
- Private identity state and private keys remain secret material in an AMA Vault.
  Identity and Agent rows, version rows, Session snapshots, API responses,
  events, and audit records store only the safe descriptor and secret reference.
- Session creation attaches only the bound identity credential, never its
  containing Vault or unrelated credentials. Runtime setup may create a private,
  Session-local working copy when required by the provider client and deletes it
  with the Session workspace.
- AMA does not proxy identity-provider business API traffic, issue provider
  authority, or inject a controller's OIDC credentials into a runtime. The
  provider client obtains and refreshes short-lived Agent authority directly.
- Realmroot is the first Agent identity provider adapter. Its enrollment state,
  Toolbox client, runtime identity value, and credential format implement this
  contract; they do not define a universal Agent identity protocol.

## Consequences

- Agent identity is stable across runtime implementations and attributable to
  the Agent rather than borrowed from its controller.
- Provider-specific identifiers and credential formats stay behind an Agent
  identity adapter.
- Secret Agent state is isolated from durable product and audit records.
- Supporting another provider requires an adapter that satisfies the common
  identity descriptor, enrollment, credential materialization, and authority
  lifecycle semantics; it does not require pretending that a standard Agent
  identity protocol exists.
