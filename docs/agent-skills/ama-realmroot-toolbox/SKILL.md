---
name: ama-realmroot-toolbox
description: Operate Any Managed Agents through Realmroot Agent identity, controller-approved scopes, and the published OpenAPI contract.
---

# AMA Realmroot Toolbox

Use this skill for terminal automation against Any Managed Agents. AMA is the Realmroot native Resource Server `https://ama.tftt.cc/api`; raw tokens, manual authorization headers, generic OpenAPI credentials, and user-identity fallback are forbidden.

## Setup

```bash
realmroot toolbox sync any-managed-agents
realmroot toolbox any-managed-agents --search agents
realmroot toolbox any-managed-agents context
```

Realmroot discovers the protected Resource and OpenAPI document, requests controller approval for the exact scope, attributes calls to the stable Agent identity, and signs every request with a fresh RFC 9449 DPoP proof.

## Common operations

```bash
realmroot toolbox get any-managed-agents/api/v1/agents --scope agents:read --output json
realmroot toolbox get any-managed-agents/api/v1/environments --scope environments:read --output json
realmroot toolbox get any-managed-agents/api/v1/sessions --scope sessions:read --output json
realmroot toolbox get any-managed-agents/api/v1/vaults --scope vaults:read --output json
realmroot toolbox get any-managed-agents/api/v1/audit-records --scope audit-records:read --output json
```

For mutations, confirm ids and generate or inspect the OpenAPI body before sending it:

```bash
realmroot toolbox any-managed-agents --search createAgent
realmroot toolbox post any-managed-agents/api/v1/agents --generate-body --scope agents:write
realmroot toolbox post any-managed-agents/api/v1/agents '<json-body>' --scope agents:write
```

Standard resources use `{ metadata, spec, status }`; use `metadata.uid` for follow-up calls. Realmroot secret state and access tokens must never appear in notes, commits, screenshots, or command output captured for audit.

Runtime traffic remains behind AMA session endpoints. Toolbox operates control-plane resources; it does not create another runtime protocol.
