---
name: operate-enbor
description: Operate a live Enbor deployment using Agent Identity, controller-approved access, and current API discovery through Realmroot Toolbox.
---

# Operate Enbor

Use this skill for terminal automation against Enbor. Enbor Agent Identity has no
standard protocol today; Realmroot is its current identity provider. Enbor's
protected API otherwise uses standard OAuth 2.0, OpenID Connect, RFC 9728, and
RFC 9449 mechanisms. Raw tokens, manual authorization headers, generic OpenAPI
credentials, and user-identity fallback are forbidden.

## Route knowledge and operations

- Use Context7 library `/realmroot/enbor` to understand what Enbor is, choose
  an integration pattern, or write application code with an Enbor SDK.
- Use this Skill when the requested outcome requires reading or changing live
  Enbor resources.
- Use Realmroot Toolbox as the execution mechanism. It discovers the current
  Enbor contract and presents every request as the Agent identity.

For a task that includes both coding and live verification, use Context7 while
writing the integration, then return to this Skill before making live calls.
Context7 is not an Enbor credential provider and does not execute operations.

## Install

Install from the Agent Skill discovery endpoint published by an Enbor
deployment. For the public deployment and Codex:

```bash
npx skills add https://enbor.realmroot.dev \
  --skill operate-enbor \
  --agent codex \
  --global
```

Use the self-hosted Enbor origin instead when operating a different deployment.

## Setup

```bash
realmroot toolbox sync enbor
realmroot toolbox enbor --search agents
realmroot toolbox enbor context
```

Realmroot discovers the protected Resource and OpenAPI document, requests controller approval for the exact scope, attributes calls to the stable Agent identity, and signs every request with a fresh RFC 9449 DPoP proof.

## Discover operations

```bash
realmroot toolbox enbor --search '<capability or operation>'
```

Use the exact operation, scope, fields, and command published by discovery. For
mutations, confirm identifiers and inspect the generated request body before
sending it. Do not copy discovered operations into Markdown documentation.

Typical Agent requests are phrased as outcomes, for example: “Use the
`operate-enbor` Skill to list the Agents in this Project” or “Start a Session
for this Agent and verify its resulting state.” The Skill must translate the
outcome into live discovery; it must not guess an operation name from memory or
from Context7 snippets.

Realmroot secret state and access tokens must never appear in notes, commits,
screenshots, or command output captured for audit. Do not treat this skill as API
documentation; RFC 9728 discovery and the live OpenAPI document are authoritative.

Discover runtime and control-plane operations from the live contract. Do not
define a second protocol in this skill.
