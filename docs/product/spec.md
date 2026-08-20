# Product Spec

Any Managed Agents is a Cloudflare-native managed agents system. It is inspired by CMA and Claude Managed Agents, but it is not vendor locked to Anthropic or any single model provider.

## End State

- The platform can be deployed on Cloudflare Workers.
- This repository publishes OpenAPI for product resource management and keeps generated SDK scaffolds under `sdk/` until SDK release ownership moves out.
- The control-plane API contract is generated from Hono route schemas.
- The web console uses the project-local Hono RPC client for internal control-plane calls.
- Command-line automation uses Realmroot Toolbox against the published protected Resource and OpenAPI document.
- The project provides an agent-facing skill that teaches automation agents how to use Realmroot Toolbox with stable Agent identity.
- Agent products run as Session-selected runtimes on Environment-selected hosting. `ama`, `claude-code`, `codex`, and `copilot` are runtime choices behind one AMA control-plane and event surface.
- The `ama` runtime is the first-party AMA/Pi runtime. External runtimes such as `claude-code`, `codex`, and `copilot` are runner-managed integrations, not replacements for AMA's control plane.
- Runtime traffic goes through AMA session endpoints; clients do not connect directly to sandbox-owned or runner-owned agent processes.
- The canonical AMA session event protocol is the only UI, API, and session-state contract.
- Cloudflare Agents SDK is not the v1.0 runtime contract. It may be added later as an adapter, but v1.0 must not require `/agents/*` compatibility.
- The platform does not maintain a competing runtime SDK or incompatible runtime protocol.
- Workers AI is a first-class provider, and the model layer supports all configured providers through provider adapters.
- Anthropic is optional, not required.
- Authentication and delegated authority are provided exclusively by Realmroot.
- Realmroot owns users and organizations; AMA stores project and product-resource metadata only.
- The exact AMA protected Resource is `https://ama.tftt.cc/api`. Browser Console calls use Realmroot-issued Bearer `at+jwt` tokens from the registered Console client; runner, Agent, and Toolbox calls use sender-constrained tokens with a fresh RFC 9449 DPoP proof. Credentials cannot be downgraded or used across client modes.
- Secret values are stored in Cloudflare Secrets; D1 stores metadata and references only.
- BDD specs are the agent-facing acceptance contract for development and verification.
- E2E specs use native Playwright specs traced to BDD-lite scenario ids.

## Boundary

The platform owns the control plane:

- OIDC provider-backed tenancy and AMA projects
- agent definitions for persona, instructions, policy, provider, model, skills, tools, and MCP connectors
- provider configuration for all supported providers
- model policy
- sandbox and runtime policy
- session metadata
- environment hosting, workspace, network, resource, secret-reference, and runtime-config metadata
- sandbox lifecycle
- self-hosted runtime runner metadata and work leases
- runtime endpoint and event transport
- UI surfaces
- usage and cost records
- audit records
- Cloudflare Secrets references
- governance rules

AMA owns the control-plane surface, tenant enforcement, session record state machine, runtime endpoint, policy gates, and event persistence. The `ama` runtime owns first-party AMA/Pi loop behavior. External runtime adapters for `claude-code`, `codex`, and `copilot` are launched and observed by self-hosted runners while AMA remains the canonical session owner.

Cloudflare Sandbox owns filesystem, shell, process isolation, and per-session `cloud` workspace execution. Self-hosted runners own `self_hosted` external runtime process execution after claiming session work. Neither surface may expose raw runtime process endpoints to product clients.

AMA must not define a custom sandbox SDK. Sandbox access is an internal platform responsibility behind environments, sessions, policy, and tool executor dispatch.

The platform owns the control-plane OpenAPI contract. Repo-local generated SDK scaffolds live under `sdk/typescript`, `sdk/go`, and `sdk/python` and are regenerated from the Hono-generated OpenAPI document. Product SDKs manage control-plane resources and may provide thin helpers that connect to AMA runtime endpoints, but they must not define a replacement runtime protocol. Hand-authored SDK behavior that drifts from OpenAPI does not belong in this repository.

Command-line usage is a control-plane concern. Operators use Realmroot Toolbox with the published OpenAPI document. Realmroot owns controller approval, scoped credentials, DPoP, and Agent attribution.

The web console is an internal control-plane entrypoint. It uses Realmroot authorization code with PKCE, keeps rotating refresh and short-lived access credentials in tab-scoped session storage, sends its access token as Bearer authentication through Hono RPC, and exchanges that credential for a short-lived single-use ticket before opening a session WebSocket. External developers and operators use Realmroot Toolbox or DPoP-aware generated SDKs. AMA selects the credential mode from the verified Realmroot client identity and never falls back between modes.

## Runtime Shape

```txt
Control plane:
  web console -> Realmroot Bearer Hono RPC client -> /api/* -> Hono OpenAPI routes -> D1 / governance / metadata
  Realmroot Toolbox / DPoP SDK -> protected Resource + OpenAPI -> Hono routes -> D1 / governance / metadata

Runtime:
  client / external SDK helper -> AMA session endpoint -> selected session runtime -> canonical AMA session events -> D1 events

Runtime hosting:
  cloud environment -> AMA-managed Cloudflare infrastructure -> selected runtime -> workspace / safe secrets / policy gates
  self_hosted environment -> runner work queue -> self-hosted runtime lease -> per-session runner WebSocket -> selected external runtime -> structured events/results
```

## Product Model

- `Agent` is a long-lived managed definition: persona, instructions, policy, provider, model, carried skills, tool declarations, MCP connectors, metadata, and versions. Agents do not bind environments and do not own hosting, workspace, secrets, network, or resource policy.
- `Environment` is a long-lived hosting and workspace configuration: hosting mode, workspace setup, packages, variables, safe secret references, network policy, resource limits, runtime config, and metadata. It is not a running sandbox or runner, and it does not select the agent runtime.
- `Sandbox` is an ephemeral `cloud` workspace/runtime instance created from an environment snapshot for exactly one cloud session when the selected hosting/runtime combination requires Cloudflare Sandbox.
- `Session` is a concrete run of an agent in an explicitly selected environment. Each session binds an agent version snapshot, environment snapshot, safe resource references, runtime/provider/model validation result, runtime endpoint, canonical AMA session events, and status.
- `Runner` is a registered `self_hosted` runtime host. Runners heartbeat capability, supported runtime/provider/model combinations, load, and safe metadata to AMA, claim leases for queued self-hosted session runtime work, open one outbound session WebSocket per claimed session, and send canonical AMA session events/results through AMA.

Environment `hostingMode` is exactly `cloud` or `self_hosted`. Session and Trigger `runtime` is exactly `ama`, `claude-code`, `codex`, or `copilot`.

The Environment API surface is `hostingMode` and `runtimeConfig`. Hosting mode chooses AMA-managed cloud infrastructure or registered self-hosted runners, while Session/Trigger `runtime` selects the adapter family.

Core product resources follow the standard resource entity shape in API and SDK responses:

```ts
{
  metadata: { uid, pid, name, description, labels, annotations, createdBy, createdAt, updatedAt, archivedAt }
  spec: object
  status: object
}
```

This applies to agents, environments, vaults, memory stores, triggers, and their child resources such as versions, memories, credentials, credential versions, and trigger runs. External callers use `metadata.uid` as the stable id. Create and update requests remain business-shaped request DTOs; callers do not submit full resource entities.

Session creation validates the selected Agent provider/model against the selected Session runtime and Environment hosting mode. If the exact runtime/provider/model combination is unsupported, session creation fails before workspace allocation, sandbox creation, or self-hosted lease creation.

Session creation resolves runtime inputs into safe execution references. Runtime secrets travel as `secretRef` URL references in `envFrom` or `volumes` and are materialized only at dispatch — on self-hosted lease claim or cloud session startup — never stored raw in D1 or session records. Workers AI runs on the platform binding and contributes no connection env.

`cloud` sessions use AMA-managed Cloudflare infrastructure for the selected runtime. `self_hosted` environments enqueue runtime work and keep sessions pending with `statusReason: "waiting-for-runner"` until an eligible runner that supports the exact runtime/provider/model combination claims a lease. `self_hosted` session creation must not create a Cloudflare Sandbox or expose runner-local endpoints.

Queue and lease APIs solve session dispatch, ownership, heartbeat, expiry, and recovery. They are not the per-tool real-time execution path. After a runner claims a self-hosted session, the runner opens an outbound WebSocket for that exact session because self-hosted runners may sit behind NAT or firewalls. AMA sends approved runtime/tool calls over that claimed session channel, and the runner streams lifecycle, stdout, stderr, output, timing, usage, safe errors, and tool/runtime results back over the same channel. A self-hosted session becomes active only after AMA accepts the claimed runner session channel. Duplicate, stale, or mismatched runner channels cannot submit results.

All runtimes emit canonical AMA session events. The protocol covers lifecycle, message, provider call, tool call, workspace, policy, usage, and error events with monotonically increasing sequence numbers, stable ids, redacted payloads, and runtime-specific details confined to safe metadata.

Runner authentication uses a Realmroot public-native Application. `ama-runner auth login` uses Realmroot OAuth/OIDC device authorization and persists its DPoP private key and token material only in the local runner credential file, separate from the non-secret runner config file. AMA validates Realmroot-issued `at+jwt` tokens plus a fresh RFC 9449 proof, binds OIDC runner registrations to the creating token subject/client id, rejects runner heartbeats, lease operations, event upload, or session WebSocket upgrades when the token does not match that binding, and rejects runner-scoped device tokens on non-runner control-plane resources. AMA must not implement a parallel runner credential issuer. D1 may store runner ids, names, OIDC subject/client binding metadata, supported runtimes and models, environment binding metadata, heartbeat/load state, work item payloads, lease state, result/error metadata, DPoP replay identifiers with short expiry, and secret references only. Raw runner tokens, DPoP private keys, provider secrets, or vault secret values must not appear in D1, OpenAPI responses, events, logs, or UI state.

Environment `networkPolicy.mode` is exactly `unrestricted`, `restricted`, or `offline`. Restricted policy requires explicit `allowedHosts`; unrestricted and offline policy do not carry host allow-lists. Offline policy denies outbound sandbox network operations.

Sandbox instances follow the session lifecycle, are not reusable across sessions, and must not expose public ports.

Session `volumes` may include GitHub repository declarations, mounted through `volumeMounts`:

```json
{
  "name": "source",
  "type": "github_repository",
  "owner": "saltbo",
  "repo": "any-managed-agents",
  "ref": "main",
  "secretRef": "ama://vaults/vault_abc123/credentials/vaultcred_abc123"
}
```

AMA stores only safe references. Raw tokens, clone URLs with embedded credentials, path traversal, and mount paths outside `/workspace` are rejected. Cloud and self-hosted runtime setup consume the same workspace volume model; repositories are not considered cloned or mounted until that layer performs setup using approved credential references.

## Spec Discipline

Product behavior should be described in BDD specs before implementation. These specs are primarily for agents and developers, not for end users.

See `spec/README.md` for the BDD-lite convention and the per-capability spec map.

See `docs/product/decisions.md` for fixed product decisions.

See `docs/product/sdk.md` for the SDK ownership and generation boundary.

## v1.0 Acceptance

The first release is accepted when a signed-in user can create an environment,
create an agent, create a session by selecting an agent and environment, send a task through the AMA runtime endpoint,
inspect persisted session events, and stop the session.

Release verification must include:

- Realmroot PKCE login through `oidc-client-ts`, with Bearer tokens kept in tab-scoped session storage.
- Realmroot access-token validation at the Worker boundary for every client; runner and Agent credentials additionally require DPoP validation including `cnf.jkt`, `ath`, method, URI, freshness, and replay checks.
- Agent, environment, and session CRUD covered by Cloudflare integration tests.
- OpenAPI generated from Hono route schemas for auth, agents, environments, and
  sessions.
- UI coverage for signed-out and signed-in console states.
- BDD-lite acceptance scenarios in `spec/`, traced to layered tests via `[spec: id]`.
- `pnpm run lint`, `pnpm run typecheck`, `pnpm test`, `pnpm run e2e`,
  and `pnpm run build`.

Secrets must remain in Cloudflare Secrets or external vaults. D1 may store
metadata, policy, snapshots, and secret references, but not raw secret values.
