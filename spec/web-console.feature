Feature: Web console
  A Cloudflare-native web console operates the control plane: a stable app shell
  with organization and project context, resource lists and detail pages for every
  capability, destructive-action confirmations, and a single shared Hono RPC client
  for all control-plane calls.

  # ── App shell and navigation (web: jsdom) ──

  @web-console/shell @web
  Scenario: Render the application shell and primary navigation
    Given a signed-in user has access to a project
    When the user opens the console
    Then the sidebar shows agents, environments, sessions, providers, vaults, MCP, usage, audit, and settings
    And the current organization and project context are visible
    And an Organization claim is never mislabeled as a personal workspace when its display name is absent
    And desktop keeps navigation in the left shell while mobile exposes full non-ellipsized route labels
    And route labels, page headings, and browser URLs agree

  @web-console/project-switcher @web
  Scenario: Switch, create, and manage projects from the sidebar header
    Given a signed-in user belongs to an organization with one or more projects
    When the user opens the project switcher in the sidebar header
    Then the switcher lists every project and marks the active one
    And selecting a project switches the active project and refreshes control-plane data
    And choosing "Create project" opens a form that creates a project and switches to it
    And choosing "Manage projects" navigates to "/settings/projects"

  @web-console/project-management @web
  Scenario: Manage organization projects from Settings
    Given a signed-in user opens the Projects tab in Settings
    When the Projects page loads the organization's projects through the shared API client
    Then it lists the system-owned Default project and ordinary projects
    And the Default project offers no rename or delete action
    And renaming an ordinary project uses a secondary form and refreshes the stored list
    And deleting an ordinary project requires destructive confirmation and refreshes the stored list

  @web-console/routed-pages @web
  Scenario: Navigate routed resource and detail pages
    Given a project has agents, environments, sessions, providers, vaults, MCP connectors, usage, and audit records
    When the user navigates the console and opens detail pages
    Then each resource list and its detail page render from the control-plane responses
    And raw secret values are never rendered in detail pages
    And primary resources are deep-linkable without relying on in-memory navigation state
    And desktop and 390px mobile layouts avoid horizontal page scrolling

  # ── Resource list rendering (web: list rows and errors) ──

  @web-console/resource-lists @web
  Scenario: Render resource list rows with paginated, tooltip-backed status
    Given providers and MCP connectors include error and disabled status
    When the user opens the provider and MCP lists
    Then each row renders on one line with pagination counts
    And error and disabled detail is exposed through tooltips instead of inline overflow
    And loading regions use scoped progress while empty states explain what is missing
    And status remains understandable without color alone

  # ── Destructive operations (web: confirm + audit) ──

  @web-console/destructive-ops @web
  Scenario: Confirm destructive actions through the shared dialog
    Given a session can be closed and archived
    When the user triggers a close or archive from the console
    Then a confirmation dialog names the resource and consequence before the action runs
    And archived resources expose no further destructive action
    And the pending operation disables duplicate submission and reports completion through shared feedback

  # ── Shared API client (web: single Hono RPC client) ──

  @web-console/rpc-client @web
  Scenario: Use one shared Hono RPC client for control-plane calls
    Given the console issues a control-plane list request
    When the request is sent
    Then it uses the shared authenticated client with Realmroot Console Bearer auth, tenancy headers, the web-rpc marker, and serialized list options
    And external automation remains described by the OpenAPI document
