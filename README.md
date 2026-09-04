# Enbor

[![CI](https://github.com/realmroot/enbor/actions/workflows/ci.yml/badge.svg)](https://github.com/realmroot/enbor/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenAPI](https://img.shields.io/badge/API-OpenAPI-6BA539?logo=openapiinitiative&logoColor=white)](sdk/openapi.json)

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

## When to Use Enbor

Use Enbor when agents are part of a product or operating environment and need
to outlive one model call or one local process. It is a good fit when you need
one or more of the following:

- stable Agent identity and versioned configuration across many Sessions;
- a consistent Session API across cloud and self-hosted execution;
- portability between the `enbor`, `claude-code`, `codex`, and `copilot`
  runtimes;
- durable events, transcripts, approvals, usage records, and audit history;
- reusable Environments, credentials, memory, tools, skills, and governance;
- infrastructure that a downstream product can embed behind its own user
  experience.

Enbor is usually unnecessary for a one-off prompt, a local chatbot with no
durable state, or an application that only needs to call one model provider
directly.

## Common Use Cases

- **Managed coding agents:** run coding work through different agent runtimes
  while retaining one durable Agent definition and Session history.
- **Agent products:** provide the control and execution plane behind a
  customer-facing product without coupling Enbor to that product's workflow.
- **Self-hosted execution:** dispatch Sessions to customer-controlled Runners
  while the Enbor control plane retains lifecycle and event ownership.
- **Governed agents:** apply identity, policy, approval, budget, credential,
  memory, and audit controls consistently across runtimes.
- **Long-running automation:** create Sessions from schedules or external
  events and inspect their results through one canonical API.

## The Name

`Enbor` means the trunk of a tree in Basque: the durable structure that remains while branches grow and change. An Enbor Agent plays the same role. Sessions branch from a stable, versioned definition while its capabilities, policy, and memory can evolve without losing the Agent's identity.

## Infrastructure Boundary

Enbor owns:

- **Durable agent definitions**: identity, instructions, provider and model policy, skills, tools, MCP connectors, memory bindings, governance, and versions.
- **Execution configuration**: reusable cloud or self-hosted environments, workspace setup, network policy, resource limits, and safe secret references.
- **Session lifecycle**: immutable agent and environment snapshots, runtime selection, dispatch, persisted events, transcripts, approvals, usage, and audit records.
- **Developer interfaces**: an OpenAPI-backed control plane, generated SDKs, standards-based protected-resource discovery, and an operational console.
- **Runtime portability**: a canonical session surface across the first-party `enbor` runtime and runner-managed integrations such as `claude-code`, `codex`, and `copilot`.

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
| Product APIs, generated SDKs, OpenAPI clients, console     |
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
| OAuth/OIDC, Workers, D1, Durable Objects, Sandbox, Secrets, |
| Workers AI, provider adapters, and MCP                      |
+-------------------------------------------------------------+
```

Cloudflare provides the serverless substrate for deployment, storage, isolation, and cloud execution. OAuth 2.0 with current security practices and OpenID Connect provide the authentication and tenancy boundary. Enbor defines a provider-neutral Agent Identity contract because no adopted standard Agent identity protocol exists; Realmroot is the current OAuth/OIDC and Agent identity provider. Enbor provides the durable Agent model and the control and execution planes that downstream products embed.

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

The repository and generated SDK distributions use the Enbor name. Resource
Server and runtime protocol identifiers retain their existing `agency` and `Enbor`
names until their separately versioned migrations are complete.

## Install Enbor Runner

Install the prebuilt `enbor-runner` binary on macOS or Linux with Homebrew:

```bash
brew install realmroot/tap/enbor-runner
```

Or run the multi-architecture container image from GitHub Container Registry:

```bash
docker pull ghcr.io/realmroot/enbor-runner:latest
```

See the [self-hosted Runner guide](docs/infra/self-hosted-runner.md) for authentication, persistent volumes, runtime CLI installation, and complete native and Docker startup commands.

## Documentation

This README is a non-normative project overview. Product and API behavior is
defined only by the Gherkin Features under `spec/`.

- [Documentation Index](docs/README.md) - documentation map and content ownership.
- [Getting Started](docs/guides/getting-started.md) - choose an execution model and complete the first SDK workflow.
- [Choose an Integration Path](docs/guides/choosing-an-integration-path.md) - decide when to use Context7, an SDK, the Enbor Skill, or Realmroot Toolbox.
- [SDK Guide](sdk/README.md) - shared SDK concepts and language-specific guides.
- [Contributor Guide](CONTRIBUTING.md) - local setup, verification, contribution workflow, and engineering rules.
- [Product and API Specifications](spec/) - normative behavior in Gherkin Features.
- [Architecture Decision Records](docs/adr/) - accepted architecture decisions, context, and consequences.
- [Generated OpenAPI](sdk/openapi.json) - exact API paths, methods, and schemas.
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
