# SDK and API Boundary

This repository publishes the Any Managed Agents control-plane OpenAPI contract and generates the `sdk/` clients from it with standard community generators. Agent-facing clients require request-aware Realmroot DPoP authentication, while runner clients receive Bearer authentication through their configured transport; none accepts a raw access-token constructor shortcut. Command-line automation uses Realmroot Toolbox against the protected Resource and the same OpenAPI document.

## SDK Layers

```txt
User application
  -> Realmroot Toolbox, an Agent DPoP SDK, or a runner Bearer SDK
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

## Realmroot Toolbox Boundary

The CLI path is Realmroot Toolbox over RFC 9728 discovery and OpenAPI. Realmroot owns Agent identity, controller approval, token acquisition, and DPoP signing.

Restish is configured from the deployment document:

```bash
realmroot toolbox sync any-managed-agents
realmroot toolbox get any-managed-agents/api/v1/configz
```

Use the protected Resource URL `https://ama.tftt.cc/api`. Realmroot Toolbox and generated Agent SDK usage require a Realmroot-issued DPoP-bound token and a fresh proof for every request. The browser Console uses an HttpOnly AMA session and exchanges it for a single-use session socket ticket; the native runner authenticates its control-plane channel with its own Realmroot Bearer access token.

This repository includes:

- [Integration snippets](integration-snippets.md) for Realmroot Toolbox and generated SDK examples.
- [AMA Realmroot Toolbox skill](../agent-skills/ama-realmroot-toolbox/SKILL.md) for automation agents.
- `scripts/generate-openapi-and-sdks.ts` for reproducible SDK regeneration.

The skill is guidance for automation agents, not a separate command surface. It references OpenAPI operations or documented paths rather than inventing project-specific CLI commands.

## Web Console Boundary

The web console should not use OpenAPI as its internal client implementation. It calls the same Hono routes through the shared Hono RPC client. OpenAPI remains the external contract for Realmroot Toolbox and DPoP-aware generated SDKs.

## Runtime Protocol

AMA session endpoints and canonical AMA session events are the v1.0 UI/API/session-state protocol surface. Agent products run through the runtime selected by the session's environment.

Realmroot Toolbox is control-plane only. It manages API resources through OpenAPI-described `/api` operations; it does not replace AMA runtime traffic.

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
