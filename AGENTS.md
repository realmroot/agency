# Any Managed Agents Development Guide

## Clean-Room Boundary

- Do not copy code, specs, UI text, database schemas, or implementation details from AGPL projects.
- Use Cloudflare documentation, public product behavior, and locally authored specs as inputs.
- Keep this project under Apache-2.0-compatible dependencies unless explicitly reviewed.
- When comparing another project, use it only to identify capability categories, test gaps, and workflow ideas. Re-express all requirements in this repository's own product language.

## Product Boundaries

- Any Managed Agents is Cloudflare-native: Workers, D1, Durable Objects, Cloudflare Sandbox, Workers AI, and Cloudflare Secrets are the default platform assumptions.
- Prefer mature community libraries for established protocols and hard problems instead of reimplementing them locally. This applies to auth protocols, OpenAPI tooling, validation, crypto, date/time handling, UI primitives, routing, data fetching, and runtime integrations.
- Realmroot owns authentication, stable Agent identity, users, and organizations. The browser uses public-SPA authorization code with PKCE and sends an exact-audience AMA Resource token on every protected request; AMA has no opaque Web Session authentication mode. Agent identity administration uses a restricted RFC 8693 exchange by AMA's Machine Application. Console and runner access tokens use Bearer; Realmroot Agent tokens use DPoP.
- Pi coding agent is the v1.0 runtime inside one Cloudflare Sandbox per running session.
- AMA owns the control plane: Realmroot-backed tenancy and scope enforcement, projects, agents, environments, sessions, providers, vaults, governance, usage, audit, OpenAPI, UI, sandbox lifecycle, and runtime proxy metadata. AMA must not maintain local user or organization tables.
- AMA must not invent a competing runtime protocol, sandbox SDK, or agent loop. Runtime traffic uses Pi protocol directly or a transparent AMA proxy.
- Cloudflare Agents SDK is not the v1.0 runtime contract. It may be added later as an adapter, but v1.0 must not require `/agents/*` compatibility.
- Command-line automation uses `realmroot toolbox` against the published protected-resource metadata and OpenAPI document. Do not expose raw token or Bearer-token workflows.
- Agent-facing skills must use Realmroot Agent identity and OpenAPI-described control-plane operations while preserving the Pi runtime boundary.
- Web UI code is an internal product entrypoint and should call the control plane through the shared Hono RPC client. External operators use Realmroot Toolbox or DPoP-aware SDKs against the published OpenAPI document.
- Secret values belong in Cloudflare Secrets or an approved external vault. D1 stores metadata, policy, snapshots, and secret references only.

## Workflow: Spec-Traced, Verified At The Cheapest Layer

Specs are BDD-lite (see `spec/README.md`). `spec/*.feature` is the product source of
truth — documentation only, one file per capability — and is NOT executed; there is
no Cucumber runner. Tests trace back to scenarios with `[spec: <id>]` breadcrumbs.

1. Write or update a scenario in the capability's `spec/<capability>.feature`. Give it
   a stable id `@<capability>/<slug>` and one layer tag (`@domain`/`@usecase`/`@web`/
   `@api`/`@e2e` — the cheapest layer that can prove it).
2. Add or update the home test at that layer (see the table in `spec/README.md`) and
   put `[spec: <id>]` in its `describe`/`it` name.
3. Implement the Worker, Agent, D1, or UI behavior.
4. Run the smallest meaningful check:
   - `npm run test` (unit + web + integration vitest projects)
   - `npm run test:coverage` (enforced per-file coverage gate)
   - `npm run typecheck`
   - `npm run lint:spec` (every enforced scenario id has a breadcrumb)
   - `npm run e2e` (native Playwright crowns in `e2e/*.spec.ts` — real cross-stack journeys)

Scenarios describe business behaviour. Selectors, fixtures, and platform details
belong in the home test and its helpers.

If implementation discovers a missing product decision, stop widening the code change
and update the relevant `spec/` scenario or product doc first.

## Spec And Test Layering Rules

- `spec/` holds only `.feature` files and its README — no test code, no step
  definitions. The id `@<capability>/<slug>` never changes once written.
- Verify at the cheapest layer. Old `@api` scenarios usually map to `@api`
  (assembled server, real D1) or `@usecase` (fake-port business branch); old `@ui`
  scenarios map to `@web` (jsdom + vi-mocked api) or `@e2e` (real browser). Reserve
  `@e2e` for genuinely cross-stack, hermetic journeys — do not turn every scenario
  into a slow E2E.
- `npm run e2e` runs the native Playwright crowns in `e2e/*.spec.ts`
  (`auth.spec.ts`, `api-contracts.spec.ts`, `projects.spec.ts`) against local
  resources; `npm run e2e:server` boots the dev stack for them. Do not make e2e
  depend on production, staging, real model quota, real user credentials, or
  direct database access.
- `npm run test:coverage` is the enforced coverage gate (`vitest run --project unit
  --project web --coverage`): business logic (server/domain + server/usecases) ≥95%
  per-file, everything else included (gateways, shared, src/features, src/lib) ≥90%
  per-file.
- `npm run lint:spec` is a governance lint (sibling to `lint:arch`): it fails when an
  enforced capability has a scenario id with no `[spec: id]` breadcrumb. Add a
  capability to `ENFORCED_CAPABILITIES` in `scripts/check-spec-coverage.ts` once its
  spec and breadcrumbs land.
- Do not add standalone `scripts/` test runners for product behaviour. Restish/OpenAPI
  contract behaviour lives in `server/http/*.test.ts` (integration) or the native
  Playwright crowns in `e2e/*.spec.ts`.

## Architecture Map

- `server/` - Cloudflare Worker backend, Hono routes, auth, D1 access, runtime orchestration, and Pi bridge code.
- `server/routes/` - API routes and OpenAPI-backed control-plane surfaces.
- `server/auth/` - Realmroot OIDC, DPoP, scope, and session integration.
- `server/db/` - D1 schema and persistence helpers.
- `server/runtime/` - Cloudflare Sandbox and Pi runtime integration.
- `src/app/` - React application providers and router setup.
- `src/features/` - Route-level feature orchestration for console pages.
- `src/features/console/` - Shared authenticated console shell and context.
- `src/console/` - Reusable AMA product components, form helpers, formatting, defaults, and view models.
- `src/components/ui/` - shadcn-generated primitives. Prefer these before writing custom primitives.
- `spec/` - Product behaviour in Gherkin (BDD-lite). One `.feature` per capability; tests trace back via `[spec: id]`. See `spec/README.md`.
- `e2e/` - Native Playwright crowns (`*.spec.ts`), fixtures, browser helpers, and local e2e harnesses for `@e2e` scenarios.
- `docs/product/` - Product decisions, UI/UX standards, API/SDK boundaries, and implementation notes.
- `docs/infra/` - Cloudflare deployment and infrastructure notes.

## UI/UX Rules

- Follow `docs/product/ui-ux-standards.md` for all visible console work.
- `src/App.tsx` should compose providers and `RouterProvider`; primary route definitions belong in `src/app/router.tsx`.
- Primary resources must be URL-routed and deep-linkable. Do not drive major pages only through local view state.
- Use React Query for server state. Do not add feature-level `useEffect + useState` API loading loops.
- Use the shared Hono RPC client for browser control-plane calls. Do not add ad hoc `fetch('/api/...')` clients in feature code.
- Compose route pages from shadcn primitives and shared AMA components. Do not recreate local button, input, card, panel, or field systems.
- Forms use shadcn `Field` primitives for labels, descriptions, errors, and validation layout.
- Date and time display uses the shared dayjs-backed formatter in `src/console/format.ts`.
- Destructive actions use the shared confirmation dialog.
- For visible UI changes, check desktop and 390px mobile behavior. Avoid horizontal scrolling, truncated mobile nav labels, card-in-card layouts, and marketing-style hero surfaces inside the console.

## API And OpenAPI Rules

- Control-plane API behavior must be represented in OpenAPI generated from route schemas.
- Keep route handlers, validation schemas, tests, and OpenAPI output aligned in the same change.
- Stable error envelopes matter; do not replace structured API errors with ad hoc strings.
- OpenAPI and protected-resource metadata are the contract for Realmroot Toolbox and generated SDK workflows.
- OpenAPI is the external contract. It should not become the internal browser client implementation when Hono RPC can provide the project-local API entrypoint.

## Runtime And Session Rules

- A running session owns exactly one sandbox.
- Environments are reusable configuration and policy snapshots, not running containers.
- A session binds immutable agent and environment snapshots for runtime execution.
- Session events, transcript, tool calls, usage, policy decisions, and safe runtime errors must remain inspectable after completion or failure.
- Do not expose raw sandbox ports or preview URLs as the product surface.

## Verification

Choose the smallest meaningful check, then broaden when touching shared contracts:

- Native Playwright e2e crowns: `npm run e2e`
- Coverage gate: `npm run test:coverage`
- Type safety: `npm run typecheck`
- Unit/integration/runtime tests: `npm test`
- Lint/format checks: `npm run lint`
- Production build: `npm run build`

For v1 acceptance or broad changes, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:coverage`, `npm run e2e`, and `npm run build`.

## Local Safety

- Do not commit `.dev.vars`, `.env`, secrets, local Playwright captures, Wrangler state, or generated runtime artifacts.
- Do not change real Cloudflare resource names, account ids, service bindings, or deployment targets unless the task requires it.
- Prefer failing fast over adding fallback logic. Add defensive handling only at real boundaries: user input, external APIs, network, filesystem, and process execution.
