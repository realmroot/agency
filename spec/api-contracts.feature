Feature: API contracts
  The control plane is automated through a single OpenAPI document generated from
  the Hono routes under /api/v1. Errors use a stable envelope, lists paginate and
  filter consistently, the document drives protected-resource clients and generated
  SDKs, and runtime Session traffic stays on Enbor endpoints rather than a bespoke CLI
  protocol.

  # ── Health probe and OpenAPI generation (api: assembled server) ──

  @api-contracts/health @api
  Scenario: Health probe returns ok outside the versioned control-plane contract
    Given the Worker app is initialized
    When a client requests the healthz endpoint
    Then the response is 200 with plain text ok
    And healthz and readyz both live under the API namespace
    And the versioned OpenAPI contract does not publish a health resource

  @api-contracts/openapi @api
  Scenario: Publish a generated OpenAPI document from control-plane routes
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it is generated from Hono route schemas and stays entirely under /api/v1
    And every operation has a unique id, summary, tags, a documented success response, and scoped OAuth auth on protected paths
    And its path and method inventory comes from route schemas rather than a hand-maintained endpoint catalog
    And it does not describe a replacement for Enbor runtime session traffic

  @api-contracts/resource-discovery @api
  Scenario: Publish the OAuth protected Resource contract
    Given the Worker app is initialized
    When a client discovers the exact Enbor Resource
    Then RFC 9728 metadata publishes the exact resource, configured authorization server, supported Bearer and DPoP modes, and complete scope catalog
    And the Resource response links the live OpenAPI document with service-desc
    And every OpenAPI operation scope belongs to the published catalog

  @api-contracts/agent-skills @api
  Scenario: Publish installable Agent Skills
    Given Enbor owns Agent-facing operating Skills
    When Toolbox discovers Agent Skills at the Enbor Resource Server origin
    Then Enbor publishes an Agent Skills Discovery version 0.2.0 index
    And the index advertises every Enbor-owned Skill as a digest-verified archive
    And each archive contains its Skill instructions and supporting files

  @api-contracts/error-envelope @api
  Scenario: Provide a consistent API error envelope
    When an API request fails validation, authentication, authorization, or a not-found check
    Then the response uses the stable error envelope with type, message, and safe structured details

  @api-contracts/schema-alignment @api
  Scenario: Keep route handlers aligned with OpenAPI write schemas
    Given the agent, environment, and session write handlers read request fields
    When the handled fields are compared to the OpenAPI create and update schemas
    Then the handled fields match the published create schema and deletion uses HTTP DELETE

  @api-contracts/resource-entities @api
  Scenario: Publish standard resource entity responses
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then agent, environment, vault, memory, trigger, and child-resource responses use metadata, spec, and status
    And every resource response exposes its stable uid in metadata.uid
    And responses omit raw organization ownership, runtime placement details, and deprecated top-level compatibility fields
    And create and update requests use their business input schemas instead of requiring complete resource entities

  @api-contracts/resource-identifiers @api
  Scenario: Generate opaque time-ordered resource identifiers
    Given Enbor creates a resource with a server-owned primary key
    When the resource is persisted and returned through the API
    Then its identifier is a standard UUID version 7 without a resource-type prefix
    And previously persisted identifiers remain valid resource locators

  # ── Pagination and filtering (e2e: cross-stack list contracts) ──
  # Native Playwright e2e specs execute these scenarios for real through `pnpm run e2e`.

  @api-contracts/pagination @e2e
  Scenario: Page through API resources
    Given more resources exist than fit on one page
    When the API client requests the next page
    Then the response contains data and pagination with limit, hasMore, and nextCursor
    And the API uses a stable cursor rather than first or last item metadata

  @api-contracts/date-filters @e2e
  Scenario: Filter API resources by date range
    Given a list route supports timestamps
    When the API client requests a date range
    Then only matching resources are returned

  # ── Protected-resource clients and generated SDKs ──

  @api-contracts/realmroot-toolbox @api
  Scenario: Drive the control plane through a protected-resource client over the published contract
    Given a control-plane harness exposes /api/v1/openapi.json
    When the current Toolbox client discovers operations and runs the core environment, Agent, and Session workflow
    Then it discovers the documented resource groups and exercises the workflow over documented /api/v1 paths
    And project-scoped operations expose an optional project selector while organization and global operations do not
    And the project selector keeps the "X-Enbor-Project-ID" wire name while Toolbox exposes it as "project-id"
    And an explicit unknown, empty, or foreign-organization project selector is concealed as not found
    And WebSocket upgrade operations remain in OpenAPI and SDKs but are excluded from Toolbox commands while REST and SSE operations remain available
    And every Toolbox-visible operation publishes a unique stable command name with friendly names for core actions
    And the OpenAPI document remains the single source of truth for command discovery, fields, and auth

  @api-contracts/sdk-layout @api
  Scenario: Generate external SDKs from the API contract
    When the generated SDK artifacts are checked
    Then the TypeScript, Go, and Python SDKs align with the canonical OpenAPI snapshot and Hono routes
    And public control-plane and runner clients expose only the operations owned by their audience
    And REST-shaped SDK behavior is generated while non-HTTP Session transport helpers remain thin hand-written adapters
    And the web console uses the shared Hono RPC client instead of the published SDK
    And the SDKs do not define a replacement runtime protocol
