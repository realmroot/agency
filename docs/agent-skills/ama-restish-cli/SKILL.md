---
name: ama-restish-cli
description: Operate Any Managed Agents control-plane resources from a terminal using restish and the published OpenAPI document.
---

# AMA restish CLI

Use this skill when an agent needs terminal automation for Any Managed Agents resources. This skill is documentation only: it does not define a bespoke AMA CLI binary or a replacement runtime protocol.

## Setup

1. Set the deployment origin:

   ```bash
   export AMA_ORIGIN="https://ama.example.com"
   ```

2. Authenticate through OIDC provider and provide a OIDC provider-issued OIDC access token. The current implemented OpenAPI security scheme is `bearerAuth` in `/api/openapi.json`.

3. Configure restish from the published OpenAPI document:

   ```bash
   restish api configure ama "$AMA_ORIGIN/api/openapi.json"
   restish ama read-configz
   ```

4. Use JSON output when another tool will parse command output:

   ```bash
   restish ama list-agents --rsh-output-format json
   ```

## Workflow Map

Use OpenAPI operation names or documented `/api/v1` paths. Do not invent local command names.

| Resource | Read/list | Create/update | Archive/delete or command |
| --- | --- | --- | --- |
| Config discovery | `readConfigz` | n/a | n/a |
| Agents | `listAgents`, `readAgent`, `listAgentVersions`, `readAgentVersion`, `readAgentMemory`, `listAgentHandoffCandidates` | `createAgent`, `updateAgent`, `replaceAgentMemory` | use `updateAgent` state fields |
| Environments | `listEnvironments`, `readEnvironment`, `listEnvironmentVersions`, `readEnvironmentVersion` | `createEnvironment`, `updateEnvironment` | use `updateEnvironment` state fields |
| Sessions | `listSessions`, `readSession`, `listSessionEvents`, `connectSessionSocket`, message and approval operations | `createSession`, `updateSession`, `createSessionMessage` | use `updateSession` state fields |
| Providers | `listProviders`, `listModels`, `readProvider`, `listProviderModels` | `refreshCatalog` | n/a |
| Vaults | `listVaults`, `readVault`, `listVaultCredentials`, `readVaultCredential`, `listVaultCredentialVersions`, `readVaultCredentialVersion` | `createVault`, `updateVault`, `createVaultCredential`, `updateVaultCredential`, `createVaultCredentialVersion` | `deleteVaultCredentialVersion` |
| Budgets | `listBudgets`, `readBudget` | `createBudget`, `updateBudget` | `deleteBudget` |
| Usage | `listUsageRecords`, `readUsageRecord`, `readUsageSummary` | n/a | n/a |
| Audit | `listAuditRecords`, `readAuditRecord` | n/a | n/a |

## Common Commands

```bash
restish ama list-environments --rsh-output-format json
printf '%s\n' '{"name":"Node workspace","packages":[{"name":"tsx","version":"latest"}]}' \
  | restish ama create-environment --rsh-output-format json

restish ama list-agents --rsh-output-format json
printf '%s\n' '{"name":"Research assistant","instructions":"Answer with citations.","providerId":"workers-ai","model":"@cf/moonshotai/kimi-k2.6"}' \
  | restish ama create-agent --rsh-output-format json

printf '%s\n' '{"agentId":"agent_abc123","environmentId":"env_abc123"}' \
  | restish ama create-session --rsh-output-format json
restish ama read-session sessionId:"session_abc123"
restish ama list-session-events sessionId:"session_abc123" --rsh-output-format json

restish ama list-providers --rsh-output-format json
restish ama list-vaults --rsh-output-format json
restish ama read-usage-summary --rsh-output-format json
restish ama list-audit-records --rsh-output-format json
```

Standard resource responses for agents, environments, vaults, memory stores, triggers, and child resources use `{ metadata, spec, status }`; use `metadata.uid` as the stable id in follow-up calls.

Run `pnpm run e2e` in this repository when you need local evidence that the current OpenAPI document is ingestible by restish and that restish can serialize the core create environment, create agent, and create session workflow.

If SDK artifacts change, run `pnpm run openapi:generate` and `pnpm run openapi:check`. Restish remains the default command-line path; do not replace these workflows with a bespoke AMA CLI.

## Safety Boundaries

- Confirm ids before destructive `update*` state changes or `deleteVaultCredentialVersion`.
- Treat vault values and auth tokens as secrets. Never paste raw secret values into notes, commits, or screenshots.
- Runtime interaction remains behind AMA session endpoints and canonical AMA events. Use `connectSessionSocket` or generated SDK stream helpers for live task traffic.
- Do not add a `bin`, shell wrapper, package-manager global command, or project-specific command surface for AMA control-plane work.
