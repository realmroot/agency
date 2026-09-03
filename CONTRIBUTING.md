# Contributing to Enbor

Thanks for helping improve Enbor. This guide covers local development, verification, and contribution expectations. Product positioning and the non-normative project overview belong in [README.md](README.md); product and API behavior belong only in `spec/*.feature`.

## Project Boundaries

Enbor is a Cloudflare-native Managed Agent control plane.

- Read `docs/adr/` for architecture rationale and ownership boundaries.
- Read `spec/*.feature` for every observable product and API behavior.
- Use generated OpenAPI for exact paths, methods, and schemas.
- Keep provider-specific code behind adapters and use standard protocols where
  standards exist.

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
git clone https://github.com/realmroot/enbor.git
cd enbor
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
`.feature` files are the exclusive specification, one per capability; tests trace
back to scenarios with `[spec: <id>]` breadcrumbs rather than being generated from
them. Do not create Markdown product specs, API design documents, endpoint catalogs,
or normative request/response examples. Generated OpenAPI owns exact API shapes.

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
src/console/       Shared Enbor console components and view models
src/components/ui/ shadcn-generated primitives
spec/              Product and API behavior in Gherkin, one Feature per capability
e2e/               Native Playwright crowns (*.spec.ts), fixtures, and local harnesses (@e2e)
docs/adr/          Consequential architecture decisions and trade-offs
docs/infra/        Deployment and operational runbooks
```

## API and OpenAPI

Control-plane API behavior must stay aligned across the owning Feature, route handlers, validation schemas, tests, and generated OpenAPI output.

OpenAPI is the public machine-readable contract for protected-resource clients and generated SDKs. The browser console should use the shared Hono RPC client instead of ad hoc `fetch('/api/...')` calls.

Regenerate and verify the OpenAPI snapshot and language SDKs with
`pnpm run openapi:generate` and `pnpm run openapi:check`. Do not maintain
hand-written Markdown API reference or SDK usage documentation.

## Authentication

Enbor is an OAuth protected Resource with OpenID Connect identity:

- `oauth4webapi` in the Worker for authorization-code PKCE, callback, and confidential client handling.
- `jose` in the Worker for JWT/JWKS and RFC 9449 DPoP verification.

Do not hand-roll token parsing, token validation, callback validation, or OIDC discovery logic.

Expected configuration names use generic OIDC terminology, for example:

- `OIDC_ISSUER`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_RESOURCE`
- `AMA_WEB_SESSION_ENCRYPTION_KEY`
- `OIDC_BROWSER_SCOPES`
- `AMA_VAULT_ENCRYPTION_KEY`

## UI Contributions

Describe visible console behavior in `spec/web-console.feature` or the owning
capability Feature before implementation.

- Compose route pages from shadcn primitives and shared Enbor components.
- Use React Query for server state.
- Keep primary resources URL-routed and deep-linkable.
- Use shared formatting and confirmation-dialog helpers.
- Check desktop and 390px mobile behavior for visible UI changes.

## Deployment Notes

GitHub Actions runs CI checks. Production and staging deploys should run through Cloudflare Workers Builds unless the deployment policy changes.

For full deployment setup, including D1, OIDC redirect URIs, Cloudflare Sandbox, Workers AI, and Durable Object migration bootstrap, see [docs/infra/cloudflare-deploy.md](docs/infra/cloudflare-deploy.md).

## Pull Request Expectations

- Keep changes focused.
- Update the owning Feature when behavior changes; never put behavior in Markdown.
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
