# Inbox Triggers

Agency owns the user-visible Trigger and its Trigger Runs. Inbox owns the
corresponding Subscription and Message data. The first integration is one
Trigger to one Subscription; there is no shared Subscription or Agency fan-out.

## Subscription management contract

Agency calls Inbox with its dedicated Realmroot M2M service identity and the
`subscriptions:read subscriptions:manage` scopes. The Inbox protected-resource base is configured as
`INBOX_RESOURCE`. Agency controls the stable Subscription id, composed of the
`sub_` prefix plus 32 lowercase hexadecimal characters, and uses these resource
operations with `API-Version: 2026-08-11`:

The M2M exchange uses a dedicated Realmroot machine Application configured by
`INBOX_CLIENT_ID` and the `INBOX_CLIENT_SECRET` Worker secret. The browser Web
Application configured by `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` is never
reused for Inbox provisioning. Agency sends the exact `INBOX_RESOURCE` as the
OAuth 2.0 Resource Indicator (`resource`), never as an `audience` parameter.

- `PUT {INBOX_RESOURCE}/subscriptions/{subscriptionId}` with `If-None-Match: *`
  when creating or the current `If-Match` ETag when replacing
- `GET {INBOX_RESOURCE}/subscriptions/{subscriptionId}` to recover the current
  ETag after an uncertain or concurrent transition
- `DELETE {INBOX_RESOURCE}/subscriptions/{subscriptionId}` with the current
  `If-Match` ETag

The PUT JSON representation is:

```json
{
  "agentId": "<Realmroot stable OIDC subject UUIDv7>",
  "events": ["message.created"],
  "delivery": {
    "url": "<OIDC_RESOURCE>/v1/inbox-notifications",
    "authorization": {
      "scheme": "bearer",
      "token": "<one-time high-entropy token>"
    }
  }
}
```

Inbox names this wire field `agentId`, but its value is the Realmroot
`IdentityDescriptor.subject`: the Agent's stable OIDC subject. It is not the
Realmroot internal Identity resource id from `IdentityDescriptor.agentId`.
Those UUIDv7 values may differ, and Inbox public Agent discovery is keyed by the
stable subject.

Agency persists the remote-confirmed registered subject and the target subject
for the current PUT transition. Before every PUT, Agency reads the Inbox
Subscription representation and treats its UUIDv7 `agentId` as the only
authoritative registered subject. A successful PUT advances the registered
subject atomically with local `active` state and clears the target. Failed PUTs
retain both subjects. If a PUT succeeded but the local active-state write failed,
the next GET observes the target remotely and completes locally without another
PUT.

The versioned D1 migration uses the canonical `IdentityDescriptor.subject` only
as a transition candidate, changes legacy active rows to `pending`, and leaves
the registered subject unknown until Inbox GET calibrates it. It never guesses
remote state from the internal `IdentityDescriptor.agentId`. Subscription ids,
callback credentials, ETags, child Trigger Runs, pending HTTP dispatches, and
Session routes are preserved by the constraint-compatible table rebuild.

The callback token is never placed in a URL, API response, or log. Agency stores
its SHA-256 hash for admission and an AES-GCM ciphertext for reliable idempotent
Subscription retries. Retries reuse the same token, so an uncertain PUT cannot
make Inbox and Agency disagree about which callback credential is current.
Agency also stores the current Subscription ETag.
Provisioning state is `pending`, `active`, `inactive`, or `error`; the scheduled
reconciler retries pending and failed transitions with the same callback token.
Only classified Inbox gateway failures become provisioning errors. Every
unknown error at the Inbox credential and HTTP boundary is converted into a
classified error whose raw cause is retained only outside serializable Error
properties. Failed
transitions persist a safe gateway classification and HTTP status when available,
and emit structured diagnostics with the operation and a static allowlisted
message. Unknown exceptions and local persistence failures propagate unchanged;
their arbitrary messages, stacks, response bodies, callback credentials,
ciphertext, and service credentials are not included in gateway diagnostics.

## Notification contract

Inbox creates a notification receipt through
`POST <Agency OIDC_RESOURCE>/v1/inbox-notifications` with
`Authorization: Bearer <registered-token>` and `Content-Type: application/json`:

```json
{
  "eventId": "evt_123",
  "type": "message.created",
  "subscriptionId": "sub_0123456789abcdef0123456789abcdef",
  "agentId": "019ff41a-7da6-708f-8b05-49a4cc6d5300",
  "messageId": "msg_123",
  "routingKey": "optional opaque value",
  "occurredAt": "2026-08-30T12:00:00.000Z"
}
```

The callback `agentId` carries the stable OIDC subject registered on the
Subscription. While provisioning is `pending` or `error`, Agency accepts the
registered subject and the persisted transition target because the Subscription
id and callback Bearer token already bind the delivery. This covers
the non-atomic window where Inbox accepted a PUT but the local active-state write
failed. Once provisioning is `active`, Agency accepts only the registered subject.

An Agent with a live, enabled Inbox Trigger cannot replace or remove its
Realmroot Identity; the Agent update returns `409 Conflict`. This ensures new
mailbox messages remain readable by the same identity. For a historical A-to-B
rebind, remote GET temporarily admits A alongside target B; after B is confirmed
active, A notifications are rejected because identity B cannot correctly read
mailbox A's queued messages.

Agency validates the Subscription token and Agent identity, then persistently
deduplicates on `(subscriptionId, eventId)` by creating one Trigger Run. A `202`
means that receipt is durable; it does not mean the Agent completed processing.
The notification contains no Message body. Inbox retries timeouts, network
errors, `429`, and `5xx` responses; other non-`2xx` responses are permanent.

## Session routing

Agency hashes an optional routing key and atomically binds
`(agentId, triggerId, routingKeyHash)` to a Session id through a D1 unique
constraint. The binding is reserved before Session creation, so concurrent first
events cannot create multiple Sessions. Equal keys reuse the bound Session,
different keys create different Sessions, and a missing key always creates a
fresh Session.

The Session prompt contains only event and Message references plus the Trigger's
instructions. The Realmroot-bound Agent uses Toolbox and its own identity to
read the complete Message from Inbox.
