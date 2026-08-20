# Contributing to Any Managed Agents

Thanks for helping improve Any Managed Agents. This guide covers local development, verification, and contribution expectations. Product positioning and user-facing project overview belong in [README.md](README.md); implementation details belong here or in `docs/`.

## Project Boundaries

Any Managed Agents is a Cloudflare-native Managed Agent control plane.

- AMA owns the control plane: projects, agents, environments, sessions, providers, vault references, governance, usage, audit, OpenAPI, UI, sandbox lifecycle, and runtime proxy metadata.
- OIDC owns authentication, users, and organization identity. AMA must not maintain local user or organization tables.
- Pi coding agent is the v1 runtime inside one Cloudflare Sandbox per running session.
- Cloudflare Sandbox owns filesystem, process isolation, and per-session execution.
- Runtime traffic uses Pi protocol directly or through a transparent AMA proxy.
- OpenAPI and RFC 9728 metadata are the external contract for Realmroot Toolbox and DPoP-aware generated SDKs.
- The web console uses the shared Hono RPC client for internal control-plane calls.
- Secret values belong in Cloudflare Secrets or an approved external vault. D1 stores metadata, policy, snapshots, and secret references only.

This is a clean-room implementation. Do not copy source, specs, UI text, database schemas, or implementation details from AGPL projects.

## Requirements

- Node.js 24+
- npm
- Wrangler
- Cloudflare account for deployed runtime work
- OIDC application for login flows
- Cloudflare Sandbox/Containers access for live Pi runtime sessions

## Local Setup

```bash
git clone https://github.com/saltbo/any-managed-agents.git
cd any-managed-agents
pnpm install
cp .env.example .dev.vars
pnpm dev
```

For local API and browser checks, configure OIDC issuer/client values and Workers AI settings in `.dev.vars`. `pnpm dev` uses local development variables. Live runtime sessions require the Cloudflare Sandbox container image built from this repository's `Dockerfile`.

## Common Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run e2e
npm run build
```

Script responsibilities:

- `npm run lint`: Biome checks for formatting and linting.
- `npm run typecheck`: server and web TypeScript projects.
- `npm test`: unit, component, route, and runtime tests.
- `npm run test:coverage`: `vitest run --project unit --project web --coverage`, the enforced per-file coverage gate.
- `npm run e2e`: native Playwright cross-stack crowns in `e2e/*.spec.ts`, backed by local resources (`npm run e2e:server` boots the dev stack for them).
- `npm run build`: production Vite/Worker build.

Choose the smallest meaningful check for a narrow change. For broad control-plane, runtime, or release work, run lint, typecheck, unit tests, coverage, e2e, and build.

## Specs First (BDD-lite)

Product behaviour starts in Gherkin under `spec/` (see `spec/README.md`). The
`.feature` files are documentation, one per capability; tests trace back to scenarios
with `[spec: <id>]` breadcrumbs rather than being generated from them.

1. Write or update a scenario in `spec/<capability>.feature` with a stable id
   `@<capability>/<slug>` and one layer tag (`@domain`/`@usecase`/`@web`/`@api`/`@e2e`).
2. Add or update the home test at that layer and put `[spec: <id>]` in its name.
3. Implement Worker, runtime, D1, or UI behaviour.
4. Run the smallest meaningful verification command (`test`, `test:coverage`, `lint:spec`, `e2e`).

Verify at the cheapest layer that can prove the scenario. Reserve `@e2e` (run by
`npm run e2e` as native Playwright crowns in `e2e/*.spec.ts`) for genuinely
cross-stack journeys. Static shape checks and pure assertions belong in unit or
integration tests, not e2e.

## Architecture Map

```txt
server/            Cloudflare Worker backend, routes, auth, D1, runtime orchestration
server/routes/     API routes and OpenAPI-backed control-plane surfaces
server/auth/       OIDC and session integration
server/db/         D1 schema and persistence helpers
server/runtime/    Cloudflare Sandbox and Pi runtime integration
src/app/           React providers and router setup
src/features/      Route-level console features
src/console/       Shared AMA console components and view models
src/components/ui/ shadcn-generated primitives
spec/              Product behaviour in Gherkin (BDD-lite documentation, one file per capability)
e2e/          Native Playwright crowns (*.spec.ts), fixtures, and local harnesses (@e2e)
docs/product/      Product decisions, API boundaries, and implementation notes
docs/infra/        Cloudflare deployment and infrastructure notes
```

## API and OpenAPI

Control-plane API behavior must stay aligned across route handlers, validation schemas, tests, and generated OpenAPI output. Stable error envelopes matter. Do not replace structured API errors with ad hoc strings.

OpenAPI is the public contract for Realmroot Toolbox and generated SDKs. The browser console should use the shared Hono RPC client instead of ad hoc `fetch('/api/...')` calls.

## Authentication

AMA is a native Realmroot Resource Server:

- `oidc-client-ts` in the browser for authorization-code PKCE redirect handling.
- `jose` in the Worker for Realmroot JWT/JWKS and RFC 9449 DPoP verification.

Do not hand-roll token parsing, token validation, callback validation, or OIDC discovery logic.

Expected configuration names use generic OIDC terminology, for example:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_RESOURCE`
- `OIDC_BROWSER_SCOPES`
- `AMA_VAULT_ENCRYPTION_KEY`

## UI Contributions

Follow `docs/product/ui-ux-standards.md` for visible console work.

- Compose route pages from shadcn primitives and shared AMA components.
- Use React Query for server state.
- Keep primary resources URL-routed and deep-linkable.
- Use shared formatting and confirmation-dialog helpers.
- Check desktop and 390px mobile behavior for visible UI changes.

## Deployment Notes

GitHub Actions runs CI checks. Production and staging deploys should run through Cloudflare Workers Builds unless the deployment policy changes.

For full deployment setup, including D1, OIDC redirect URIs, Cloudflare Sandbox, Workers AI, and Durable Object migration bootstrap, see [docs/infra/cloudflare-deploy.md](docs/infra/cloudflare-deploy.md).

## Pull Request Expectations

- Keep changes focused.
- Update specs or docs when behavior changes.
- Keep route schemas, OpenAPI output, and tests aligned.
- Do not commit `.env`, `.dev.vars`, secrets, local Playwright artifacts, Wrangler state, screenshots, videos, traces, or generated runtime artifacts.
- Prefer failing fast over swallowing errors.
- Delete dead code instead of polishing it.

Before opening a PR, run the smallest verification command that proves the change. For broad changes, run:

```bash
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run e2e
npm run build
```
