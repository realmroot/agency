# Enbor

[![CI](https://github.com/realmroot/agency/actions/workflows/ci.yml/badge.svg)](https://github.com/realmroot/agency/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenAPI](https://img.shields.io/badge/API-OpenAPI-6BA539?logo=openapiinitiative&logoColor=white)](docs/product/sdk.md)

**The open infrastructure for durable agents.**

Enbor is an open-source, self-hostable control and execution plane for developers building agent products. Define an agent once—its identity, instructions, model policy, skills, tools, MCP connectors, memory, and governance—then version it and run consistent sessions across cloud and self-hosted runtimes.

> Define once. Run anywhere. Evolve over time.

Enbor is infrastructure. It is not an end-user agent, an agent application, or another framework for implementing one agent loop. Products build their own experiences and workflows on top of Enbor's durable resources, APIs, and runtime boundary.

## Why Enbor Exists

Most agent tooling starts with a run. Prompts, skills, tools, MCP configuration, model choices, and policies are assembled for one process on one machine. The next environment often has to assemble them again, while the identity and history of the agent are left to the application to reconstruct.

Enbor starts with the agent itself. An `Agent` is a long-lived, versioned definition and a `Session` is one concrete run of that definition. Environments describe where work can execute; runtimes describe how it executes. Models, machines, and runtimes may change without redefining what the agent is.

```txt
Agent definition -> immutable version -> Session
                                      -> Session
                                      -> Session
```

This gives agent product developers one canonical place to manage durable definitions, execution environments, runtime sessions, events, policy, credentials, memory, usage, and audit history.

## The Name

`Enbor` means the trunk of a tree in Basque: the durable structure that remains while branches grow and change. An Enbor Agent plays the same role. Sessions branch from a stable, versioned definition while its capabilities, policy, and memory can evolve without losing the Agent's identity.

## Infrastructure Boundary

Enbor owns:

- **Durable agent definitions**: identity, instructions, provider and model policy, skills, tools, MCP connectors, memory bindings, governance, and versions.
- **Execution configuration**: reusable cloud or self-hosted environments, workspace setup, network policy, resource limits, and safe secret references.
- **Session lifecycle**: immutable agent and environment snapshots, runtime selection, dispatch, persisted events, transcripts, approvals, usage, and audit records.
- **Developer interfaces**: an OpenAPI-backed control plane, generated SDKs, Realmroot Toolbox integration, and an operational console.
- **Runtime portability**: a canonical session surface across the first-party `ama` runtime and runner-managed integrations such as `claude-code`, `codex`, and `copilot`.

Enbor does not own:

- the customer-facing product or its business workflow
- the model provider
- a downstream product's user experience
- a replacement protocol or agent loop for every runtime

Agent frameworks answer **how one run executes**. Enbor answers **what the agent is across runs, versions, environments, and runtimes**.

## Architecture

```txt
+-------------------------------------------------------------+
| Developer Interfaces                                        |
| Product APIs, generated SDKs, Realmroot Toolbox, console    |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
| Enbor Control Plane                                         |
| Agent definitions and versions, environments, sessions,     |
| provider policy, memory, governance, usage, and audit        |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
| Enbor Execution Plane                                       |
| Cloudflare Sandbox for cloud sessions, self-hosted runners, |
| runtime adapters, event streaming, and persisted history    |
+-----------------------------+-------------------------------+
                              |
+-----------------------------v-------------------------------+
| Platform Services                                           |
| Realmroot, Workers, D1, Durable Objects, Sandbox, Secrets,  |
| Workers AI, provider adapters, and MCP                      |
+-------------------------------------------------------------+
```

Cloudflare provides the serverless substrate for deployment, storage, isolation, and cloud execution. Realmroot provides authentication, stable Agent identity, tenancy, and delegated authority. Enbor provides the durable Agent model and the control and execution planes that downstream products embed.

## How It Relates to Claude Managed Agents

[Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) demonstrates the value of first-class infrastructure for long-running agent work. Enbor applies that infrastructure model to an open, self-hostable, multi-runtime control plane.

| Area | Claude Managed Agents | Enbor |
| --- | --- | --- |
| Model choice | Claude | Workers AI first, with adapters for other configured providers |
| Hosting model | Anthropic-hosted managed infrastructure | Self-hosted Cloudflare control plane and execution plane |
| Core objects | Agents, environments, sessions, events | Versioned agents, environments, sessions, events, memory, governance, usage, and audit resources |
| API surface | Claude Platform API | OpenAPI-backed control-plane API and canonical session surface |
| Runtime ownership | Anthropic-managed runtime | Cloudflare Sandbox or registered self-hosted runners |
| Product fit | Products committed to Claude-hosted infrastructure | Developers who need agent infrastructure they can own, extend, and embed |

## Status

Enbor is early-stage software. The repository currently contains the Cloudflare foundation, OpenAPI-backed control-plane surface, authenticated console, generated SDK scaffolds, executable product specs, CI, and deployment documentation.

The project is moving toward a release where developers can define and version agents, configure reusable environments, start sessions across supported runtimes, inspect persisted events, and embed those capabilities in their own products.

The repository, package, Resource Server, and runtime identifiers currently retain their existing `agency`, `any-managed-agents`, and `AMA` names. Their migration is separate from adopting Enbor as the product name.

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
