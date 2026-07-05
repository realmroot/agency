# Integration Snippets

These examples use the current AMA deployment origin and the published `/api/openapi.json` document. Set `AMA_ORIGIN` to the console origin, for example `https://ama.example.com`. Do not point AMA control-plane examples at model-provider API hosts.

## OpenAPI

```bash
export AMA_ORIGIN="https://ama.example.com"
curl -fsS "$AMA_ORIGIN/api/openapi.json"
```

The document contains `/api/v1` paths for config discovery, agents, environments, sessions, providers, vaults, budgets, usage, audit, connectors, and auth. It is the source of truth for request fields, response fields, auth, and machine-readable output.

## curl

Use a OIDC provider-issued OIDC access token. The token is local to the operator session and must not be committed or shared.

```bash
curl -fsS "$AMA_ORIGIN/api/healthz"
curl -fsS "$AMA_ORIGIN/api/v1/configz"

curl -fsS "$AMA_ORIGIN/api/v1/environments" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OIDC_ACCESS_TOKEN" \
  -d '{"name":"Node workspace","hostingMode":"cloud","runtimeConfig":{"image":"node:24"},"packages":[{"name":"tsx","version":"latest"}]}'

curl -fsS "$AMA_ORIGIN/api/v1/agents" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OIDC_ACCESS_TOKEN" \
  -d '{"name":"Research assistant","instructions":"Answer with citations.","providerId":"workers-ai","model":"@cf/moonshotai/kimi-k2.6"}'

curl -fsS "$AMA_ORIGIN/api/v1/sessions" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $OIDC_ACCESS_TOKEN" \
  -d '{"agentId":"agent_abc123","environmentId":"env_abc123"}'
```

## restish

Configure restish from the deployment OpenAPI document and keep JSON output enabled for automation.

```bash
restish api configure ama "$AMA_ORIGIN/api/openapi.json"
restish ama read-configz
restish ama list-agents --rsh-output-format json
printf '%s\n' '{"name":"Node workspace","hostingMode":"cloud","runtimeConfig":{"image":"node:24"},"packages":[{"name":"tsx","version":"latest"}]}' \
  | restish ama create-environment --rsh-output-format json
printf '%s\n' '{"name":"Research assistant","instructions":"Answer with citations.","providerId":"workers-ai","model":"@cf/moonshotai/kimi-k2.6"}' \
  | restish ama create-agent --rsh-output-format json
printf '%s\n' '{"agentId":"agent_abc123","environmentId":"env_abc123"}' \
  | restish ama create-session --rsh-output-format json
```

The local e2e check exercises actual restish discovery plus create environment, create agent, and create session serialization:

```bash
pnpm run e2e
```

Common control-plane workflows map to these OpenAPI operations:

| Workflow | Operation IDs | Paths |
| --- | --- | --- |
| Config discovery | `readConfigz` | `GET /api/v1/configz` |
| Agents | `listAgents`, `createAgent`, `readAgent`, `updateAgent`, `listAgentVersions`, `readAgentVersion`, `readAgentMemory`, `replaceAgentMemory`, `listAgentHandoffCandidates` | `/api/v1/agents` |
| Environments | `listEnvironments`, `createEnvironment`, `readEnvironment`, `updateEnvironment`, `listEnvironmentVersions`, `readEnvironmentVersion` | `/api/v1/environments` |
| Sessions | `listSessions`, `createSession`, `readSession`, `updateSession`, `connectSessionSocket`, `listSessionMessages`, `createSessionMessage`, `readSessionMessage`, `listSessionEvents`, approval operations | `/api/v1/sessions` |
| Providers | `listProviders`, `listModels`, `refreshCatalog`, `readProvider`, `listProviderModels` | `/api/v1/providers` |
| Vaults | `listVaults`, `createVault`, `readVault`, `updateVault`, credential operations, read-only version operations | `/api/v1/vaults` |
| Budgets | budget operations | `/api/v1/budgets` |
| Usage | `listUsageRecords`, `readUsageRecord`, `readUsageSummary` | `/api/v1/usage-records`, `/api/v1/usage-summary` |
| Audit | `listAuditRecords`, `readAuditRecord` | `/api/v1/audit-records` |

Archive and stop flows use the resource `update*` operations with the relevant state fields. Confirm the target id before destructive updates or delete operations such as budget deletes.

Standard resource responses for agents, environments, vaults, memory stores, triggers, and their child resources use `{ metadata, spec, status }`. Use `resource.metadata.uid` as the stable id in follow-up calls.

## Generated SDK Shape

Generated SDKs are generated from or mechanically aligned with `/api/openapi.json`. They should keep control-plane calls thin:

```ts
const client = createAmaClient({
  baseUrl: window.location.origin,
  accessToken,
  projectId,
})

const environment = await client.environments.create({
  name: 'Node workspace',
  hostingMode: 'cloud',
  runtimeConfig: { image: 'node:24' },
  packages: [{ name: 'tsx', version: 'latest' }],
})

const agent = await client.agents.create({
  name: 'Research assistant',
  instructions: 'Answer with citations.',
  providerId: 'workers-ai',
  model: '@cf/moonshotai/kimi-k2.6',
})

const session = await client.sessions.create({
  agentId: agent.metadata.uid,
  environmentId: environment.metadata.uid,
  runtime: 'ama',
  volumes: [
    {
      name: 'source',
      type: 'github_repository',
      owner: 'saltbo',
      repo: 'any-managed-agents',
      ref: 'main',
    },
  ],
  volumeMounts: [
    {
      name: 'source',
      mountPath: '/workspace/repos/saltbo/any-managed-agents',
    },
  ],
})
```

The stable facade is split by audience:

- `createAmaClient` / `ama.New` / `create_ama_client` expose public control-plane resources.
- `createAmaRunnerClient` / `ama.NewRunner` / `create_ama_runner_client` expose runner protocol resources: runner channel, runner heartbeat, work items, leases, and runner-side session event ingestion.

Runtime task interaction is separate from restish control-plane automation. Use the session socket operation (`connectSessionSocket`) or the generated SDK stream helper. Do not define a new CLI-level runtime protocol.

Regenerate repo-local SDK scaffolds from the Hono-generated OpenAPI document before publishing SDK changes:

```bash
pnpm run openapi:generate
pnpm run openapi:check
```
