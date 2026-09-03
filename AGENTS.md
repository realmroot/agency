# Enbor Development Guide

## Clean-Room Boundary

- Do not copy code, specs, UI text, database schemas, or implementation details from AGPL projects.
- Use Cloudflare documentation, public product behavior, and locally authored specs as inputs.
- Keep this project under Apache-2.0-compatible dependencies unless explicitly reviewed.
- When comparing another project, use it only to identify capability categories, test gaps, and workflow ideas. Re-express all requirements in this repository's own product language.

## Product Boundaries

- Enbor is Cloudflare-native infrastructure for developers building agent products: Workers, D1, Durable Objects, Cloudflare Sandbox, Workers AI, and Cloudflare Secrets are the default platform assumptions.
- Prefer mature community libraries for established protocols and hard problems instead of reimplementing them locally. This applies to auth protocols, OpenAPI tooling, validation, crypto, date/time handling, UI primitives, routing, data fetching, and runtime integrations.
- Architecture rationale and ownership boundaries live in `docs/adr/`. Observable product and API behavior lives only in `spec/*.feature`; do not restate either in this file.
- AMA is infrastructure for downstream products and must not depend on or recognize any one of them. Do not add downstream-product names, client IDs, environment variables, routes, query parameters, authorization branches, fixtures, or compatibility behavior to AMA; expose generic resource capabilities and let each consumer own its business binding.
- Use standard protocols at external boundaries and keep provider-specific implementation behind adapters. Do not turn a current provider into the AMA protocol contract.

## Workflow: Spec-Traced, Verified At The Cheapest Layer

Specs are BDD-lite (see `spec/README.md`). `spec/*.feature` is the product source of
truth — documentation only, one file per capability — and is NOT executed; there is
no Cucumber runner. Tests trace back to scenarios with `[spec: <id>]` breadcrumbs.

Product behavior and API behavior MUST NOT be specified in Markdown documents.
Write every observable requirement in the owning `spec/*.feature` file. The generated
OpenAPI document is the machine-readable API shape; do not maintain Markdown endpoint
catalogs, API design specifications, request/response examples, or product specs.
Markdown is limited to architecture decisions, contributor workflow, operational
runbooks, and implementation guidance that does not define product behavior. When a
Markdown file contains normative behavior, migrate it to Gherkin and delete the
Markdown source in the same change.

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

If implementation discovers missing product behavior, stop widening the code change
and update the relevant `spec/` scenario first. Record only consequential,
hard-to-reverse architecture decisions in `docs/adr/`.

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
- `server/auth/` - OAuth/OIDC, DPoP, scope, session, and provider integration.
- `server/db/` - D1 schema and persistence helpers.
- `server/runtime/` - Cloudflare Sandbox and Pi runtime integration.
- `src/app/` - React application providers and router setup.
- `src/features/` - Route-level feature orchestration for console pages.
- `src/features/console/` - Shared authenticated console shell and context.
- `src/console/` - Reusable AMA product components, form helpers, formatting, defaults, and view models.
- `src/components/ui/` - shadcn-generated primitives. Prefer these before writing custom primitives.
- `spec/` - Product behaviour in Gherkin (BDD-lite). One `.feature` per capability; tests trace back via `[spec: id]`. See `spec/README.md`.
- `e2e/` - Native Playwright crowns (`*.spec.ts`), fixtures, browser helpers, and local e2e harnesses for `@e2e` scenarios.
- `docs/adr/` - Accepted architecture decisions, their context, and consequences.
- `docs/infra/` - Cloudflare deployment and infrastructure notes.

## UI/UX Rules

- Describe visible console behavior in `spec/web-console.feature` or the owning capability Feature before implementation.
- `src/App.tsx` should compose providers and `RouterProvider`; primary route definitions belong in `src/app/router.tsx`.
- Use React Query for server state. Do not add feature-level `useEffect + useState` API loading loops.
- Use the shared Hono RPC client for browser control-plane calls. Do not add ad hoc `fetch('/api/...')` clients in feature code.
- Compose route pages from shadcn primitives and shared AMA components. Do not recreate local button, input, card, panel, or field systems.
- Forms use shadcn `Field` primitives for labels, descriptions, errors, and validation layout.
- Date and time display uses the shared dayjs-backed formatter in `src/console/format.ts`.
- For visible UI changes, run the proof layer selected by the owning Feature on desktop and 390px mobile where applicable.

## API And OpenAPI Rules

- Control-plane API shapes must be represented in OpenAPI generated from route schemas; observable behavior belongs in the owning Feature.
- Keep route handlers, validation schemas, tests, and OpenAPI output aligned in the same change.
- Stable error envelopes matter; do not replace structured API errors with ad hoc strings.
- OpenAPI and RFC 9728 protected-resource metadata are the contract for external CLI and generated SDK workflows.
- OpenAPI is the external contract. It should not become the internal browser client implementation when Hono RPC can provide the project-local API entrypoint.

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
