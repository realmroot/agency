Feature: Projects
  A project is the tenant scope for every AMA resource. External products such as
  Downstream systems own their own workflow but use AMA as the lower-level agent,
  environment, session, runner, and event substrate through the OpenAPI SDK —
  storing only standard AMA fields and keeping product mappings in their own store.

  # ── Project lifecycle (usecase: tenant scope, default project) ──

  @projects/lifecycle @usecase
  Scenario: Materialize and create projects in the caller organization
    Given a caller signs in to an organization
    When the caller lists projects on a first empty page or creates a project
    Then exactly one system-owned project named "Default" exists before the first custom project is inserted or after the first unpaged list
    And repeated attempts to ensure the default project do not create duplicates
    And callers cannot explicitly create another project named "Default"
    And an explicitly created project is inserted in the caller organization

  @projects/delete-empty @api
  Scenario: Delete an empty project without deleting project resources
    Given a caller has an empty project in the current organization
    When the caller deletes that project
    Then the project is removed and repeated deletion reports not found
    And the system-owned default project is immutable and rejected as a conflict
    And a project with any associated resource is rejected as a conflict
    And a project in another organization remains concealed

  @projects/rename @api
  Scenario: Rename an ordinary project
    Given a caller has an ordinary project in the current organization
    When the caller renames that project through the Projects API or generated SDK
    Then the updated Project is returned and the new name persists
    And the system-owned "Default" project cannot be edited
    And no ordinary project can be renamed to the reserved exact name "Default"
    And unknown and foreign-organization projects remain concealed as not found
    And an empty project name is rejected as invalid
    And Toolbox exposes the operation as "update-project"

  # ── External product as substrate (e2e: real SDK + Worker + D1) ──
  # Native Playwright e2e specs execute these scenarios for real through `pnpm run e2e`.

  @projects/external-resources @e2e
  Scenario: External product manages standard AMA resources through the SDK
    Given an external product owns its workflow identifiers and product state
    When the product creates or updates AMA agent definitions, environments, and resources through the OpenAPI SDK
    Then AMA stores only standard AMA resource fields
    And AMA does not store product-specific external references as first-class fields
    And the product keeps any mapping between product records and AMA ids in its own storage
    And AMA does not require the product to expose board, task, review, or PR concepts

  @projects/external-session @e2e
  Scenario: External product starts work by creating an AMA session
    Given an external product has selected a standard AMA agent definition
    And the external product has selected a standard AMA environment
    And the external product has selected standard AMA resource references
    When the external product creates an AMA session through the OpenAPI SDK
    Then AMA snapshots the selected agent and environment
    And AMA validates the session runtime, provider, and model before runtime work starts
    And AMA returns a stable session id, status, status reason, runtime, and event endpoint
    And the external product can store the returned AMA ids in its own product records
    And the external product can render progress from AMA session status and canonical events

  @projects/external-control @e2e
  Scenario: External product controls a running session only through AMA endpoints
    Given an external product created an AMA session
    When the external product sends a follow-up message, close request, or resume request
    Then AMA routes the command to the selected runtime or owning self-hosted runner
    And AMA records the command result as canonical session events
    And the external product never connects to a sandbox-local, runner-local, or official-runtime-local endpoint
