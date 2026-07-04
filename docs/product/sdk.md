# SDK and API Boundary

This repository publishes the Any Managed Agents control-plane OpenAPI contract and generates the `sdk/` clients from it with standard community generators — no bespoke CLI binary and no hand-authored client behavior that can drift from OpenAPI. Each SDK is produced from the Hono-generated OpenAPI document by its language's mainstream generator (`@hey-api/openapi-ts` for TypeScript, `oapi-codegen` for Go, `openapi-python-client` for Python), so every operation and every request/response body is a generated, typed surface. Command-line automation uses restish against the same OpenAPI document. The web console is an internal entrypoint and uses the project-local Hono RPC client.

## SDK Layers

```txt
User application
  -> external Any Managed Agents SDK, restish, or direct HTTP
  -> Any Managed Agents OpenAPI control-plane API
  -> AMA session endpoint
  -> selected session runtime
  -> canonical AMA session events

Web console
  -> Hono RPC client
  -> Any Managed Agents control-plane routes
  -> AMA session endpoint
  -> selected session runtime
  -> canonical AMA session events
```

## External Any Managed Agents SDKs

Repo-local generated SDK scaffolds use this repository's OpenAPI document as their source of truth. Those SDKs are the developer entry point for product resources:

- create, read, update, archive, and version agents
- create and manage environments
- create, start, stop, resume, and inspect sessions
- manage provider, vault, policy, usage, and audit resources
- connect to a running session through AMA session endpoints

SDKs are fully typed and generated end to end from the OpenAPI document — typed operations and typed request/response models, not a thin untyped operation registry. Hand-written code is allowed only where the contract cannot express it (for example the Go runtime-session WebSocket helper that connects to an AMA session channel); everything REST-shaped is generated. Release ownership may move to separate repositories later, but this repository currently owns the reproducible generated layout.

Standard mutable product resources returned by the SDK use the same resource entity shape as Session: `{ metadata, spec, status }`. This applies to agents, agent versions, agent memory, environments, environment versions, vaults, credentials, credential versions, memory stores, memories, triggers, and trigger runs. Callers use `resource.metadata.uid` as the stable id for follow-up calls. Create and update request models remain business-shaped DTOs; SDKs must not add compatibility aliases for old top-level `id`, `name`, `description`, `archivedAt`, or `version` response fields.

## Repo-Local Generated Layout

The generated SDK layout is:

- `sdk/openapi.json` - committed OpenAPI snapshot generated from `createApp()` and Hono route schemas.
- `sdk/typescript` - pnpm workspace package `@any-managed-agents/sdk`.
- `sdk/go` - native Go module, not a pnpm workspace.
- `sdk/python` - native Python package, not a pnpm workspace.

Regenerate and check the SDK artifacts with:

```bash
pnpm run openapi:generate
pnpm run openapi:check
pnpm --filter @any-managed-agents/sdk run typecheck
```

`pnpm run openapi:generate` re-emits `sdk/openapi.json` from the Hono routes and then drives each language's generator. Do not edit generated code or the OpenAPI snapshot by hand.

## CLI Boundary

The CLI path is restish over OpenAPI. The OpenAPI document is the source of truth for operation discovery, request fields, response fields, authentication, and machine-readable output.

Restish is configured from the deployment document:

```bash
export AMA_ORIGIN="https://ama.example.com"
restish api configure ama "$AMA_ORIGIN/api/openapi.json"
restish ama read-configz
```

Use the current AMA deployment origin and `/api` paths for control-plane operations. The implemented security scheme is a OIDC provider-issued OIDC access token declared as `bearerAuth`; do not document provider API keys as AMA control-plane credentials.

This repository includes:

- [Integration snippets](integration-snippets.md) for curl, restish, and generated SDK-shaped examples.
- [AMA restish CLI skill](../agent-skills/ama-restish-cli/SKILL.md) for automation agents.
- `scripts/generate-openapi-and-sdks.ts` for reproducible SDK regeneration.

The skill is guidance for automation agents, not a separate command surface. It references OpenAPI operations or documented paths rather than inventing project-specific CLI commands.

## Web Console Boundary

The web console should not use OpenAPI as its internal client implementation. It calls the same Hono routes through the shared Hono RPC client. OpenAPI remains the external contract for direct HTTP users, generated SDKs, and restish.

## Runtime Protocol

AMA session endpoints and canonical AMA session events are the v1.0 UI/API/session-state protocol surface. Agent products run through the runtime selected by the session's environment.

Restish is control-plane only. It manages API resources through OpenAPI-described `/api` operations; it does not replace AMA runtime traffic.

The platform must not create a second client-facing runtime protocol for RPC, session events, prompts, abort, follow-up, steering, or tool calls. Runtime session traffic goes through AMA session endpoints, and observed state comes from canonical AMA session events.

Cloudflare Agents SDK is not the v1.0 runtime contract. It may become a future adapter, but v1.0 must not require `/agents/*` compatibility.

## Cloudflare Sandbox

Cloudflare Sandbox remains the sandbox execution foundation.

The platform uses sandbox capabilities internally to provide filesystem, shell, process isolation, and `cloud` workspace execution. SDKs should not expose the raw sandbox as the primary public product surface. Users manage `Environment` resources; the platform maps those environment descriptions to selected runtime behavior.

## Product Model

- `Agent` is a managed definition: persona, instructions, policy, provider, model, tools, MCP connectors, governance rules, and versions.
- `Environment` is a long-lived hosting and workspace configuration, not a running sandbox or runner. `hostingMode` is `cloud` or `self_hosted`; Session and Trigger `runtime` is `ama`, `claude-code`, `codex`, or `copilot`.
- `Sandbox` is a per-session cloud workspace instance created from an environment snapshot when the selected hosting/runtime combination requires it.
- `Session` is a concrete run of an agent, binding an agent version snapshot, environment snapshot, validated runtime/provider/model combination, runtime endpoint, canonical events, transcript, tool calls, and status.

External SDKs should make this model explicit.
