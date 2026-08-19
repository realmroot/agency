# Realmroot Agent integration

AMA binds an Agent directly to one Realmroot Agent. There is no identity broker
and no AMA-issued Realmroot token: the Realmroot CLI uses the enrolled Agent
identity to obtain controller-approved authority from Realmroot.

## Enroll and store the identity

Enroll the identity outside an AMA Session with the stable AMA runtime name:

```bash
export AGENT=ama
export REALMROOT_STATE_DIR="$(mktemp -d)"
realmroot agent enroll --origin https://realmroot.example.com
```

Locate the resulting `ama.json` below
`$REALMROOT_STATE_DIR/identities/<issuer>/`. Create an AMA Vault credential with
type `ama.dev/realmroot-agent-state` and put the complete JSON document in the
single `state.json` data key. Never place the document itself in an Agent spec,
API log, event, or environment variable.

AMA validates the pinned Realmroot v0.4.2 state contract before storage,
including state version 18, protocol identifiers, enrollment idempotency key,
and the encoded Ed25519 Agent private key. Hand-authored or partial JSON is
rejected; use the file produced by `realmroot agent enroll`.

Bind the AMA Agent using its Realmroot Agent id, Realmroot origin, and the
credential-scoped reference:

```json
{
  "realmroot": {
    "agentId": "agt_example",
    "origin": "https://realmroot.example.com",
    "credentialRef": "ama://vaults/vault_example/credentials/vaultcred_example"
  }
}
```

Version-pinned references are rejected. Credential rotation therefore changes
the active Vault version without creating a new Agent version. Revoking the
credential prevents new Sessions from starting. Existing Sessions retain only
their already-materialized, session-local copy until that Session workspace is
destroyed.

## Session behavior

At Session creation AMA resolves only the bound credential and mounts its
`state.json` read-only. Runtime setup checks that the state Agent id, origin,
and runtime (`ama`) match the binding, then copies it to a private writable
Session state directory with directory mode `0700` and file mode `0600`.
Repeated preparation validates and preserves that working copy so pending
approval and short-lived credential updates survive later turns in the same
Session.

The runtime receives `AGENT=ama`, `REALMROOT_ORIGIN`, and
`REALMROOT_STATE_DIR`. It can use `realmroot toolbox` to discover private
Resources and follow normal Realmroot controller approval. AMA never injects a
user/controller token and never proxies Realmroot Resource Server traffic.
Realmroot authorization denials and pending controller approval remain ordinary
tool output in the Session transcript; AMA does not silently retry with broader
authority or translate them into a different identity.

Cloud images include the pinned Realmroot CLI. Self-hosted runners must provide
it on `PATH`; otherwise only Realmroot-bound Session startup fails with a clear
runtime error.
