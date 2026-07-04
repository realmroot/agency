Feature: API contracts
  The control plane is automated through a single OpenAPI document generated from
  the Hono routes under /api/v1. Errors use a stable envelope, lists paginate and
  filter consistently, the document drives restish and generated SDKs, and runtime
  session traffic stays on AMA endpoints rather than a bespoke CLI protocol.

  # ── Health probe and OpenAPI generation (api: assembled server) ──

  @api-contracts/health @api
  Scenario: Health probe returns ok outside the versioned control-plane contract
    Given the Worker app is initialized
    When a client requests the healthz endpoint
    Then the response is 200 with plain text ok
    And the versioned OpenAPI contract does not publish a health resource

  @api-contracts/openapi @api
  Scenario: Publish a generated OpenAPI document from control-plane routes
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it is generated from Hono route schemas and stays entirely under /api/v1
    And every operation has a unique id, summary, tags, a documented success response, and bearer auth on protected paths
    And it does not describe a replacement for AMA runtime session traffic

  @api-contracts/error-envelope @api
  Scenario: Provide a consistent API error envelope
    When an API request fails validation, authentication, authorization, or a not-found check
    Then the response uses the stable error envelope with type, message, and safe structured details

  @api-contracts/schema-alignment @api
  Scenario: Keep route handlers aligned with OpenAPI write schemas
    Given the agent, environment, and session write handlers read request fields
    When the handled fields are compared to the OpenAPI create and update schemas
    Then the handled fields match the published create schema plus the lifecycle archive transition

  @api-contracts/resource-entities @api
  Scenario: Publish standard resource entity responses
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then agent, environment, vault, memory, trigger, and child-resource responses use metadata, spec, and status
    And every resource response exposes its stable uid in metadata.uid

  # ── Pagination and filtering (e2e: cross-stack list contracts) ──
  # Native Playwright e2e specs execute these scenarios for real through `pnpm run e2e`.

  @api-contracts/pagination @e2e
  Scenario: Page through API resources
    Given more resources exist than fit on one page
    When the API client requests the next page
    Then the API uses stable cursor metadata

  @api-contracts/date-filters @e2e
  Scenario: Filter API resources by date range
    Given a list route supports timestamps
    When the API client requests a date range
    Then only matching resources are returned

  # ── restish and generated SDKs (api: documented CLI path + SDK layout) ──

  @api-contracts/restish @api
  Scenario: Drive the control plane through restish over the published contract
    Given a control-plane harness exposes /api/v1/openapi.json
    When restish discovers operations and runs the core environment, agent, and session workflow
    Then it discovers the documented resource groups and exercises the workflow over documented /api/v1 paths
    And the OpenAPI document remains the single source of truth for command discovery, fields, and auth

  @api-contracts/sdk-layout @api
  Scenario: Generate external SDKs from the API contract
    When the generated SDK artifacts are checked
    Then the TypeScript, Go, and Python SDKs align with the canonical OpenAPI snapshot and Hono routes
    And the web console uses the shared Hono RPC client instead of the published SDK
    And the SDKs do not define a replacement runtime protocol
