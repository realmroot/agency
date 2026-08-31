Feature: Environments
  Projects define reusable execution environment descriptions for agent work:
  type, networking, packages, and variable declarations. An environment is a
  versioned definition, not a running sandbox; sessions snapshot it. Persona,
  system prompt, provider, model, MCP connectors, volumes, secrets, and policy
  stay on their owning resources.

  # ── Configuration rules (domain: pure validation, no D1) ──

  @environments/secret-material @domain
  Scenario: Reject secret material in free-form environment configuration
    Given environment metadata, package lists, variable declarations, and networking objects
    When the configuration is validated for secret material
    Then objects with secret-suggesting keys are flagged at any depth
    And the validation error is keyed to the offending field
    And secret-free configuration passes

  # ── Lifecycle (usecase: business branches over fake ports) ──

  @environments/create @usecase
  Scenario: Create an environment with default execution policy and validated references
    When the user creates an environment
    Then version 1 snapshots the normalized policy and becomes current
    And type, networking, package lists, and variable declarations have stable defaults
    And removed legacy fields and secret material are rejected with field-level details

  @environments/update @usecase
  Scenario: Version environment changes and archive safely
    Given an environment is used by existing sessions
    When the user changes a runtime-relevant field
    Then a new environment version is snapshotted and becomes current
    And changing only name or description does not create a new version
    And archiving and unarchiving toggle availability while field edits on an archived environment are rejected

  # ── API contract (api: assembled server, real D1, OpenAPI) ──

  @environments/api-crud @api
  Scenario: Manage project environments through the API
    Given a signed-in user has access to a project
    When the user drives the environments API end to end
    Then create, read, update, version history, archive, and list are supported
    And the API enforces auth and project tenancy
    And legacy hosting and runtime fields are rejected and removed legacy fields fail validation

  @environments/api-validation @api
  Scenario: Validate environment policy and secret references over the API
    Given a signed-in user has access to a project
    When the user submits package, variable, and network configuration
    Then normalized fields are stored and raw secret values are rejected
    And invalid network, package, host-pattern, and removed legacy fields return field-level details

  @environments/api-pagination @api
  Scenario: List environments with pagination, filters, and tenant scope
    Given a project has active and archived environments created across multiple dates
    When the user lists environments with a page size
    Then the response includes data and cursor pagination metadata
    And archived environments are hidden unless archived filtering is requested
    And created-date filters and project scope are respected

  @environments/api-openapi @api
  Scenario: Publish environment CRUD routes in the OpenAPI document
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it includes the environments collection, item, and versions paths with the expected methods

  @environments/self-hosted @api
  Scenario: Accept self-hosted environments without starting cloud sandbox execution
    Given a signed-in user has access to a project
    When the user creates a self-hosted environment and starts a session with it
    Then the session keeps the self-hosted environment snapshot
    And the session stays pending with a waiting-for-runner reason
    And no Cloudflare Sandbox id is assigned before a runner lease

  @environments/cloud-packages @usecase
  Scenario: Install declared packages in a cloud environment
    Given a cloud environment snapshot declares pinned Webi packages or versioned Go modules
    When AMA prepares the Cloudflare Sandbox for a session
    Then each package is installed into the isolated session environment before the runtime starts
    And its bin directories are prepended to the runtime PATH
    And the cloud image provides the pinned Realmroot CLI without an Environment package declaration
    And self-hosted commands are resolved from the Runner host at execution time without capability preflight
    And a package installation failure records a stable code, failed step, safe diagnostic, and RuntimeReady condition
    And the safe startup failure remains inspectable as a Session runtime error event
    And process-unsafe self-hosted runners do not install environment packages

  # ── Web console (web: list, create, detail in jsdom) ──

  @environments/console-list @web
  Scenario: Browse and create environments from the environments page
    Given a project has environments or none
    When the user opens the environments page
    Then the empty state explains environments are reusable templates, not running containers
    And rows show name, status, type, packages, networking, and updated time
    And the create flow captures the environment definition and returns to the browsable list

  @environments/console-detail @web
  Scenario: Inspect environment detail without exposing secrets
    Given an environment exists
    When the user opens the environment detail page
    Then the header shows name, status, current version, type, and timestamps
    And variable declarations are shown without raw secret values
    And runners and sessions that selected the environment are listed in separate tabs
