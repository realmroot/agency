---
name: enbor-realmroot-toolbox
description: Operate Enbor using its Agent Identity, with Realmroot as the current identity provider, controller-approved scopes, and the published OpenAPI contract.
---

# Enbor Realmroot Toolbox

Use this skill for terminal automation against Enbor. Enbor Agent Identity has no
standard protocol today; Realmroot is its current identity provider. Enbor's
protected API otherwise uses standard OAuth 2.0, OpenID Connect, RFC 9728, and
RFC 9449 mechanisms. Raw tokens, manual authorization headers, generic OpenAPI
credentials, and user-identity fallback are forbidden.

## Setup

```bash
realmroot toolbox sync any-managed-agents
realmroot toolbox any-managed-agents --search agents
realmroot toolbox any-managed-agents context
```

Realmroot discovers the protected Resource and OpenAPI document, requests controller approval for the exact scope, attributes calls to the stable Agent identity, and signs every request with a fresh RFC 9449 DPoP proof.

## Discover operations

```bash
realmroot toolbox any-managed-agents --search '<capability or operation>'
```

Use the exact operation, scope, fields, and command published by discovery. For
mutations, confirm identifiers and inspect the generated request body before
sending it. Do not copy discovered operations into Markdown documentation.

Realmroot secret state and access tokens must never appear in notes, commits,
screenshots, or command output captured for audit. Do not treat this skill as API
documentation; RFC 9728 discovery and the live OpenAPI document are authoritative.

Discover runtime and control-plane operations from the live contract. Do not
define a second protocol in this skill.
