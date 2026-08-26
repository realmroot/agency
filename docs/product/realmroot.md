# Realmroot Agent integration

An AMA Agent owns exactly one Realmroot identity. Identity is an Agent lifecycle
concern, never a Profile/version field, and callers never create or bind it as a
separate user action.

## Creation

`POST /api/v1/agents` accepts an immutable Realmroot `username` plus the first
Profile. Before contacting Realmroot, AMA creates the Agent's managed Vault,
generates the Agent installation key and opaque protocol identifiers, and stores
the initialization checkpoint as AES-GCM ciphertext. The same synchronous creation request then
uses AMA's confidential Realmroot Application to call `POST /api/agents` with the
public installation material and the authorization-code grant's User subject.
The downstream request uses the confidential Application's unbound Bearer token
for the Realmroot `/api` audience; it never uses an Application-only client-credentials
identity. Realmroot returns the active stable identity
directly; no registration, approval, or self-enrollment endpoint participates.
Realmroot keeps one internal identity-materialization path behind both this
management API and its unchanged self-enrollment flow.

The request must possess management authority before AMA creates any Vault or
Realmroot state. AMA stores no caller token. It completes identity creation and
atomically commits the Agent and first Profile before returning `201 Created`
with the Agent representation and canonical `Location`. `Idempotency-Key` retries
reuse stable internal Vault identifiers and the encrypted initialization checkpoint,
so concurrent or interrupted requests replay the same Realmroot request. No
provisioning operation or polling API is exposed. Only ready Agents with non-empty
issuer and subject appear in the schedulable directory.

The human caller is authorized and audited by AMA. AMA lazily exchanges the
confidential-web session's rotating grant for the Realmroot management audience,
validates that the returned Bearer still represents the signed-in User, and never
persists an access token outside the encrypted BFF session. DPoP is reserved for
the created Agent's own token and Resource calls. A trusted upstream BFF may send
the same secondary credential in `X-AMA-Realmroot-Authorization`; AMA accepts it
only with a primary Bearer and verifies an exact Realmroot `/api` audience,
`agents:write`, the same User subject, and the same Application `client_id` as the
primary AMA token. The secondary header is request-scoped and never enters logs,
audit metadata, Vault state, or resource representations.

## Storage and Session behavior

Realmroot private state exists only in encrypted managed Vault credential
versions. D1 Agent rows contain issuer/subject and credential references—never
state JSON, private keys, assertions, access
tokens, or refresh tokens.

Session creation accepts the AMA `agentId` and ordinary runtime inputs. AMA resolves
the Agent's stable Realmroot identity and current Profile internally, then projects only that Agent's
credential. The Vault snapshot seeds a Session-isolated writable ephemeral
volume with `0700` directories and `0600` files. The runtime and cloud/runner
adapters see only generic volume and environment contracts. Updates remain in
the Session copy, never flow back to Vault, and disappear with workspace cleanup.

## Retirement

Deleting an Agent permanently stops new scheduling, ends active Sessions,
calls `DELETE /api/agents/{identity.id}` with Realmroot management authority,
destroys the managed Vault and all credential versions, removes ephemeral
workspaces, and retains a non-schedulable tombstone. Each stage is durable;
failure never returns successful retirement and scheduled reconciliation resumes
from the last safe checkpoint.
