# Product Decisions

These decisions define the intended end state for Any Managed Agents.

## Environment and Sandbox

- `Environment` is a long-lived sandbox hosting and workspace configuration, not a running sandbox.
- `Environment.hostingMode` is exactly `cloud` or `self_hosted`.
- Session and Trigger `runtime` is exactly `ama`, `claude-code`, `codex`, or `copilot`.
- Environments own hosting mode, workspace setup, safe secret references, network policy, resource limits, and runtime configuration.
- The Environment API surface is `hostingMode` and `runtimeConfig`; compatibility aliases for hosting or runtime image fields are not part of the public contract.
- `Sandbox` is an ephemeral workspace/runtime instance created from an environment snapshot when the selected hosting mode and session runtime require Cloudflare Sandbox.
- Each running `cloud` `Session` that requires Cloudflare Sandbox owns exactly one sandbox.
- Sandbox instances follow the session lifecycle and are not reused across sessions.
- Cloudflare Sandbox owns filesystem, shell, process isolation, and the per-session execution environment.
- Sandbox instances are execution environments only and must not expose public ports or preview URLs.
- Environments own network policy. `unrestricted` permits outbound network subject to governance policy, `restricted` requires explicit allowed hosts, and `offline` denies outbound sandbox network operations.

## Runtime Boundary

- All agent products run as Session-selected runtimes behind the same AMA control plane and canonical session event surface.
- The `ama` runtime is the first-party AMA/Pi runtime owned by the cloud control plane.
- `claude-code`, `codex`, and `copilot` are external agent runtimes launched, managed, observed, and translated by self-hosted `ama-runner` processes.
- `Agent` owns persona, instructions, policy, provider, model, skills, tools, and MCP connector configuration.
- `Environment` owns hosting mode, workspace, secrets, network, resource limits, and runtime config.
- `Session` owns runtime selection, snapshots the selected Agent and Environment, and validates the exact runtime, provider, and model combination before any runtime work starts.
- Session creation must fail before workspace allocation when the selected session runtime does not support the Agent's exact provider/model.
- `cloud` environments run selected runtime execution through AMA-managed Cloudflare infrastructure. `self_hosted` environments run selected runtimes through registered self-hosted runtime runners.
- Self-hosted runners are registered runtime hosts for `self_hosted` environments. They heartbeat safe capability/load metadata, claim session leases, renew or finish leases, open one outbound WebSocket per claimed session, execute runtime/tool work locally, and stream canonical AMA session events/results through AMA.
- Runner HTTP queue and lease APIs are for dispatch, ownership, heartbeat, expiry, recovery, and audit. A claimed self-hosted session uses its runner-owned session WebSocket as the real-time runtime/tool execution path.
- A claimed self-hosted session becomes active only after AMA authenticates and accepts the runner session WebSocket. Duplicate, stale, or mismatched runner channels cannot submit tool or runtime results.
- OIDC provider owns authentication, users, and organizations. AMA owns OIDC provider-backed tenancy enforcement, projects, agent, environment, and session metadata, OpenAPI CRUD, sandbox lifecycle, session sockets, UI, audit metadata, and usage metadata.
- Runtime traffic uses AMA session endpoints. Browser, SDK, and CLI helpers must not connect directly to sandbox-owned or runner-owned agent processes.
- The canonical AMA session event protocol is the only UI, API, and session-state contract. Every runtime adapter must translate provider, model, tool, workspace, policy, lifecycle, usage, and error activity into that protocol before clients observe state.
- AMA must not define a new incompatible runtime SDK or runtime protocol.
- Cloudflare Agents SDK is not the v1.0 runtime contract and v1.0 must not require `/agents/*` compatibility. It may become a future adapter.

## SDK Ownership

- This repository maintains repo-local generated SDK scaffolds under `sdk/typescript`, `sdk/go`, and `sdk/python` until the SDK release process moves out.
- This repository publishes the control-plane OpenAPI document.
- The TypeScript SDK is the only SDK pnpm workspace. Go and Python use language-native module or package metadata and are not pnpm workspaces.
- External SDK behavior must be generated from or mechanically aligned with this repository's Hono-generated OpenAPI document and accept request-aware DPoP authorization, never a raw Bearer-token shortcut.
- This repository must not accumulate hand-authored bespoke SDK behavior that drifts from OpenAPI.
- Runtime helpers in external SDKs must delegate to AMA runtime endpoints.
- The web console is an internal entrypoint and uses Hono RPC for control-plane calls. OpenAPI remains the external contract for Realmroot Toolbox and DPoP-aware SDKs.

## CLI Ownership

- This repository does not maintain a bespoke CLI binary.
- Command-line automation uses Realmroot Toolbox against the native protected Resource.
- OpenAPI and RFC 9728 protected-resource metadata remain the source of truth for Realmroot Toolbox operation discovery, fields, scopes, and response shapes.
- Agent-facing skills use `realmroot toolbox`; they must not introduce raw-token workflows or a separate runtime protocol.

## Authentication

- Authentication integrates exclusively with Realmroot.
- This project must not reimplement a parallel authentication system.
- The verified Realmroot `client_id` selects one credential mode. The registered browser Console and native runner clients use Bearer; the `realmroot-cli` Agent client requires DPoP. A credential presented through the wrong mode is rejected without fallback.
- The Console is a direct public SPA client owned by the AMA maintainers. It uses authorization code with PKCE, the exact `https://ama.tftt.cc/api` audience, and explicit AMA resource scopes. Realmroot controls access-token expiry and rotates opaque refresh tokens; AMA rejects expired access tokens. OAuth credentials are stored only in tab-scoped `sessionStorage`, never in URLs, logs, IndexedDB, or cross-restart `localStorage`.
- The direct SPA design accepts that same-origin script compromise can exfiltrate the current tab's Bearer or refresh credential. The boundary must therefore avoid unreviewed script execution and raw HTML, keep credentials tab-scoped, rely on Realmroot rotation/revocation, and retain server-side scope, tenant, ownership, and audit enforcement. A BFF becomes required if AMA introduces regulated data, irreversible financial actions, privileged credentials readable through the API, long-lived non-rotating browser credentials, or unreviewed third-party scripts.
- Console session WebSockets never carry an OAuth credential in their URL or subprotocol. The Console exchanges Bearer authentication for an opaque 30-second, single-use ticket bound to the exact session and browser origin. Agent SDK WebSockets continue to use DPoP.
- Runner daemon authentication uses Realmroot authorization-code PKCE with an exact loopback callback and explicit Context selection, short-lived Bearer access tokens, rotating refresh credentials, exact audience validation, and least-privilege scopes. Static tokens are unsupported.
- Access tokens must identify the exact `https://ama.tftt.cc/api` audience. Missing scopes grant no implicit owner authority.
- The HTTP auth wall maps `GET` and `HEAD` to `<resource>:read` and mutations to `<resource>:write`; the exact scope authorizes the operation. Runner tokens remain limited to their bound runner workflow.

## Realmroot Agent Identity

- An AMA Agent may bind to one enrolled Realmroot Agent through a safe versioned descriptor containing the Realmroot Agent id, Realmroot origin, and an AMA Vault credential reference.
- The Realmroot Agent state and private key remain secret material in AMA Vault. Agent rows, version rows, session snapshots, API responses, events, and audit records store only the safe descriptor and secret reference.
- Session creation automatically attaches only the bound credential. It must not attach the containing vault or any unrelated credential.
- Cloud and self-hosted runtimes materialize the credential through the existing read-only secret mount, copy it into a session-local private writable state directory required by Realmroot Toolbox, and delete that working copy with the session workspace.
- AMA sets the Realmroot runtime identity to `ama` so one AMA Agent remains one stable Realmroot Agent across the concrete `ama`, `codex`, `claude-code`, and `copilot` session runtimes.
- AMA does not proxy Realmroot business API traffic, issue Realmroot tokens, or inject a controller's OIDC credentials into a runtime. Realmroot Toolbox obtains and refreshes short-lived Agent authority directly.

## Providers

- Workers AI is first-class.
- All configured providers should be supported through provider adapters.
- Provider behavior should be normalized for usage, policy, errors, and audit records.

## Governance Policy Hierarchy

- Governance policy rows exist at `organization`, `team`, and `project` scope. Team scope binds to an OIDC-asserted team id; AMA keeps no local team tables, so a team-scope policy applies to a request only when the caller's OIDC `teams` claim includes that team id.
- Effective policy is a deterministic most-restrictive merge ordered organization → team(s, sorted by team id) → project. One row per scope/team participates (latest `updatedAt` wins).
- Merge rules:
  - `providerRules` and `modelRules` concatenate across scopes; any applicable deny rule denies (deny overrides allow).
  - `blocked*`, `denied*`, and `requireApproval*` lists union across scopes.
  - `allowed*` lists intersect across scopes that define them; `'*'` is the intersection identity. A scope that does not define an allow list does not constrain it.
  - `defaultEffect: 'deny'` at any scope is sticky.
  - Boolean flags AND across scopes (`false` at any scope is sticky, e.g. `sandboxPolicy.enabled`).
  - Restrictive string states (`disabled`, `deny`, `offline`, e.g. `sandboxPolicy.network`) are sticky once set by a broader scope.
  - Numeric limits (budget policy values) take the minimum across scopes.
  - Nested objects (e.g. `connectorApprovalModes`) shallow-merge with the most specific scope last; any other scalar takes the most specific scope's value.
- Governance and budget data is managed through the public CRUD resources that remain in `/api/v1`; the removed `/api/governance/*` import/preview/validate surface is not part of v1.
- A team referenced by the configuration is known when it is declared in the document's `teams` section or asserted by the submitting operator's OIDC `teams` claim.
- Historical sessions keep their immutable agent and environment snapshots and their recorded events after policy changes; new runtime work on any session is evaluated against the current effective policy.

## Secrets

- Secret values are stored in Cloudflare Secrets.
- D1 stores metadata and references only.
- API responses, events, logs, and UI views must not expose raw secret values.

## Specs

- Gherkin is the product spec format.
- `.feature` files under `spec/` are documentation and traceability only.
- E2E specs use native Playwright tests carrying `[spec: id]` breadcrumbs.
