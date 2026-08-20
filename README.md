# Any Managed Agents

[![CI](https://github.com/saltbo/any-managed-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/saltbo/any-managed-agents/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenAPI](https://img.shields.io/badge/API-OpenAPI-6BA539?logo=openapiinitiative&logoColor=white)](docs/product/sdk.md)

**Any Managed Agents is an open-source, self-hostable alternative to Claude Managed Agents.**

AMA implements the same core idea as Claude Managed Agents: a managed service layer for agents, environments, sessions, and runtime events. The difference is that AMA is open source, self-hosted on your Cloudflare account, and designed to work with multiple model providers instead of only Claude.

## Why This Exists

[Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) shows where production agent infrastructure is going: long-running sessions, secure containers, tool execution, persisted events, and a first-class API surface for agents, environments, sessions, and events. Anthropic describes it as a configurable agent harness running on managed infrastructure, designed for long-running asynchronous work.

That direction is right. The lock-in tradeoff is not.

Claude Managed Agents is purpose-built for Claude. Any Managed Agents is built for teams that want CMA-style managed agent infrastructure, but with:

- **Any model provider**: use Workers AI first, then plug in OpenAI-compatible, Anthropic, local, or custom provider adapters.
- **Self-hosted control**: deploy the control plane on your own Cloudflare account instead of depending on a single vendor-hosted agent service.
- **Open API surface**: manage agents, environments, sessions, events, providers, usage, and audit data through an OpenAPI-backed control plane.
- **Runtime flexibility**: run cloud sessions on Cloudflare Sandbox and self-hosted sessions through registered runtime runners.
- **Product ownership**: integrate managed agents into your own product without inheriting another vendor's console, data plane, or roadmap constraints.

## What It Does

- Manages agents, environments, sessions, providers, usage records, audit records, and governance metadata.
- Creates one isolated Cloudflare Sandbox execution environment per running cloud session.
- Publishes a Realmroot-native Hono/OpenAPI control-plane API for Realmroot Toolbox and DPoP-aware generated SDKs.
- Uses an OIDC provider for authentication and tenancy instead of maintaining local user tables.
- Stores platform metadata in D1 and secret references in Cloudflare-managed secret storage.
- Provides a React console for authenticated project, agent, environment, and session workflows.
- Documents product behavior in Gherkin specs (BDD-lite) and exercises it through native Playwright end-to-end crowns plus vitest coverage gates.

## AMA vs CMA

| Area | Claude Managed Agents | Any Managed Agents |
| --- | --- | --- |
| Model choice | Claude | Workers AI first, with provider adapters for other models |
| Hosting model | Anthropic-hosted managed infrastructure | Self-hosted Cloudflare control plane |
| Core objects | Agents, environments, sessions, events | Agents, environments, sessions, events, plus provider governance and audit metadata |
| API surface | Claude Platform API | OpenAPI-backed control-plane API |
| Runtime ownership | Anthropic-managed runtime | Project-owned execution plane on Cloudflare Sandbox or self-hosted runners |
| Product fit | Best when you want Claude-hosted agent infrastructure | Best when you want a CMA alternative you can own, extend, and embed |

## Architecture

```txt
+-------------------------------------------------------------+
| Access                                                      |
| Web console, Realmroot Toolbox, DPoP-aware generated SDKs   |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
| Control Plane                                               |
| Projects, agents, environments, sessions, provider policy,  |
| usage records, audit records, OpenAPI routes                |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
| Execution Plane                                             |
| Cloudflare Sandbox for cloud sessions, self-hosted runners, |
| workspace state, tool execution, event streaming, history   |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
| Platform Services                                           |
| OIDC, Workers, D1, Durable Objects, Sandbox, Workers AI,    |
| provider adapters, Secrets, MCP                             |
+-------------------------------------------------------------+
```

At a high level, AMA owns the agent control plane: who can create agents, which environment a session runs in, which providers are allowed, what happened during execution, and how the run is audited. Cloudflare provides the serverless substrate for deployment, storage, isolation, and runtime execution.

## Status

Any Managed Agents is early-stage software. The repository currently contains the Cloudflare foundation, OpenAPI-backed control-plane surface, authenticated console, executable product specs, CI, and deployment documentation.

The project is moving toward a release where a signed-in user can create an environment, create an agent, start a managed session, send work into a sandboxed execution environment, inspect persisted events, and stop the session cleanly.

## Documentation

- [Contributor Guide](CONTRIBUTING.md) - local setup, verification, contribution workflow, and engineering rules.
- [Product Spec](docs/product/spec.md) - product model, architecture boundary, and acceptance criteria.
- [Product Decisions](docs/product/decisions.md) - fixed decisions for architecture and scope.
- [SDK and API Boundary](docs/product/sdk.md) - Realmroot, OpenAPI, and generated SDK usage.
- [Cloudflare Deployment](docs/infra/cloudflare-deploy.md) - Cloudflare resources, OIDC, runtime, and deployment notes.

## Verification

Native Playwright e2e crowns (`e2e/*.spec.ts`) run against a local
Worker/dev server and must not depend on deployed origins or real model quota:

```bash
pnpm run e2e
```

The enforced coverage gate runs in CI and locally:

```bash
pnpm run test:coverage
```

Business logic (server/domain + server/usecases) is held to ≥95% per-file
coverage; everything else included (gateways, shared, src/features, src/lib)
is held to ≥90% per-file.

## License

Apache-2.0
