# Product specs (BDD-lite)

Behaviour-first product specs in Gherkin `.feature` files. This directory is the
**single source of truth for what the product and API do**, independent of
implementation. Tests trace back to scenarios by id; the specs do not generate
tests.

Do not specify product behavior or API behavior in Markdown. This prohibition
includes product specs, API design documents, endpoint catalogs, and normative
request/response examples. Exact API shapes are generated as OpenAPI from route
schemas, while observable API semantics live here as scenarios. If behavior is
found in Markdown, migrate it into the owning Feature and delete the Markdown
source in the same change.

## Convention

- **One `.feature` file per capability** (`agents.feature`, `sessions.feature`,
  `auth.feature`, …). Merge or split the old per-resource files into the capability
  they belong to.
- Each scenario carries exactly **two tags**: the stable **id** `@<capability>/<slug>`
  and the single **layer** that proves it — `@domain` / `@usecase` / `@web` / `@api` /
  `@e2e`:

  ```gherkin
  @<capability>/<stable-scenario-id> @<layer>
  Scenario: <observable outcome>
    Given <precondition>
    When <action>
    Then <observable result>
  ```

- The id **never changes** once written (rename = new id). Ids are trivially
  greppable — a cleaner mechanism than embedding ids in prose.
- Pick the **cheapest layer that can prove it**. Old `@api` scenarios usually become
  `@api` (assembled-server contract) or `@usecase` (business branch); old `@ui`
  scenarios usually become `@web` (jsdom) or `@e2e` (real browser journey). Reserve
  `@e2e` for genuinely cross-stack, hermetic journeys. BDD-lite must not turn every
  scenario into a slow E2E.
- The old `@implemented` / `@planned` noise tags are gone. A scenario lives here
  because it is the product's intended behaviour; the `[spec: id]` breadcrumb (below)
  records whether and where it is proven.

Keep this directory **pure**: only `.feature` files and this README. No test code,
no step definitions, no runner config.

## Traceability

Each scenario's home test carries `[spec: <id>]` in its `describe`/`it` name, so a
scenario traces to the test that proves it (and back). The home test lives at the
layer named by the scenario's layer tag:

| layer tag   | home location                                            |
| ----------- | -------------------------------------------------------- |
| `@domain`   | `server/domain/*.test.ts`                                |
| `@usecase`  | `server/usecases/*.test.ts`                              |
| `@api`      | `server/http/*.test.ts` (workers pool + real D1)         |
| `@web`      | `src/**/*.test.ts(x)` (jsdom + vi-mocked api)            |
| `@e2e`      | `e2e/*.spec.ts` (native Playwright, real stack)          |

```ts
describe('[spec: agents/create] createAgent', () => { … })
```

`pnpm lint:spec` (a governance lint, sibling to `lint:arch`) parses every
`@<capability>/<slug>` id in `spec/*.feature` and fails if a covered capability has a
scenario id with no `[spec: …]` breadcrumb anywhere in the test tree. See
**Enforcement scope** below — it is not a behavioural test and lives only as a script.

## Runner decision (no Cucumber)

Per the skill, `.feature` files under `spec/` are documentation with **no Cucumber
runner** — Cucumber has been removed entirely (no `@cucumber/cucumber`, no step
definitions):

- `spec/` is the **only** home for `.feature` files, and nothing executes the Gherkin.
  Most scenarios are proven at the cheapest layer (`@domain`/`@usecase`/`@api`/`@web`)
  by ordinary vitest tests carrying `[spec: id]` breadcrumbs.
- The cross-stack crown is **native Playwright** in `e2e/*.spec.ts` (`pnpm e2e`,
  booted by `pnpm e2e:server`). Scenarios tagged **`@e2e`** are the genuinely
  cross-stack, hermetic journeys — reimplemented as Playwright specs that carry the
  matching `[spec: id]`, executed for real instead of merely traced.
- The old `specs/product/`, `specs/smoke/`, and the Cucumber step files were deleted;
  their behaviour lives on as capability specs plus the layered tests that carry the
  breadcrumbs.

**Escalation path:** if a non-technical audience ever needs to *run* more of the
Gherkin, wire [`playwright-bdd`](https://github.com/vitalets/playwright-bdd) (compiles
`.feature` → Playwright). These are already real `.feature` files, so that step is
mechanical — do not reach for raw `@cucumber/cucumber`, and do not adopt it
preemptively.

## Enforcement scope

`lint:spec` enforces breadcrumb coverage **only for capabilities that have opted in**
— a capability is enforced once it appears in the `ENFORCED_CAPABILITIES` allowlist in
`scripts/check-spec-coverage.ts`. The seed capabilities are **agents, sessions,
auth**. As each remaining capability is migrated into `spec/` with breadcrumbs, add it
to the allowlist. This keeps the lint from false-failing on capabilities whose specs
exist but whose breadcrumbs are still being fanned out.

## Migration status

| capability | status   | source `specs/product/*.feature` (merged in) |
| ---------- | -------- | -------------------------------------------- |
| agents     | migrated | agents-api, agents-control-plane, agents-ui, agents-update, agent-detail, agent-roles-memory |
| sessions   | migrated | sessions-api, sessions-events, session-detail-tool-tracing, session-stop, sessions-list-bulk-archive, sessions-ui |
| auth       | migrated | auth, auth-flow, auth-guard, auth-tenancy, login, login-page, sso-discovery, user-initial-password, web-auth-redirect |
| providers  | migrated | providers, providers-models, provider-access |
| environments | migrated | environments, environments-api, environments-ui, environment-detail, environments-mcp |
| vaults     | migrated | vaults, vaults-api, vaults-ui, vault-detail, vault-secrets, encryption |
| governance | migrated | governance-api, governance-policy |
| mcp        | migrated | mcp-discovery, mcp-credential-binding, engine-mcp |
| runtime    | migrated | sessions-runtime, engine-cooperative-cancellation, engine-error-termination |
| runners    | migrated | external-runtimes, self-hosted-runner-work, sandbox-execution |
| usage      | migrated | usage-summary, usage-audit |
| audit      | migrated | audit-auto, audit-log-ui |
| triggers   | migrated | scheduled-triggers |
| api-contracts | migrated | api-contracts, cli-openapi-contract, control-plane, list-route-pagination, list-date-range-filters, storage-cloudflare-d1, destructive-ops, external-product-integration, events-api |
| web-console | migrated | web-ui, layout, web-api-client-consolidation |
| projects   | migrated | external-product-integration |
