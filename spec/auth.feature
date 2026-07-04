Feature: Auth
  The platform delegates identity to an OIDC provider and applies a single tenant
  context (user, organization, project) to both the control plane and the runtime.

  # ── OIDC claim resolution (domain: pure token-to-scope rules) ──

  @auth/oidc-claims @domain
  Scenario: Resolve a tenant scope from OIDC claims
    Given a valid OIDC access token with identity claims
    When the platform resolves the request context
    Then it derives user, organization, and project context from the claims
    And deterministic runner tokens require a configured runner client

  # ── Session and context API (api: assembled server, real D1) ──

  @auth/session-create @api
  Scenario: Resolve bearer context from a valid access token
    Given an OIDC provider can issue a valid access token
    When the user submits the token for context resolution
    Then the bearer token resolves user, organization, and default project
    And the project response never exposes the organization id

  @auth/session-reject @api
  Scenario: Reject invalid tokens, disallowed origins, and malformed payloads
    When context resolution is requested with an invalid token, a disallowed origin, or a malformed payload
    Then the request is rejected with the standard OIDC, forbidden, or validation envelope
    And no tenant data is returned

  @auth/session-current @api
  Scenario: Read the bearer-authenticated context and acknowledge sign-out
    Given an authenticated user
    When the user reads the current session context and then signs out
    Then the context returns user, organization, and project without the organization id
    And sign-out does not create or clear a server-managed cookie

  @auth/guard @api
  Scenario: Guard protected resources against unauthenticated access
    Given the Worker app is initialized
    When an unauthenticated request calls a protected API
    Then it is rejected with 401 and the authentication_required envelope
    And no tenant data is returned

  @auth/tenancy @api
  Scenario: Scope resources by tenant and reject cross-tenant reads
    Given resources belong to a project in an organization
    When a user from another organization reads them
    Then access is rejected and identifiers never expose secrets or provider credentials

  @auth/sso-discovery @api
  Scenario: Discover an organization's sign-in methods
    Given an organization identifier
    When the user requests the discovery config
    Then the available OIDC sign-in options are returned, optionally hinted by organization

  @auth/delegated-bootstrap @api
  Scenario: Delegate first-admin bootstrap to the OIDC provider
    Given AMA starts without local users or organizations
    Then the OIDC provider remains responsible for first-admin bootstrap and credential rotation
    And AMA accepts only OIDC identity claims for product access

  # ── Web console (web: login action and auth redirect) ──

  @auth/login-page @web
  Scenario: Render the OIDC sign-in action and preserve the return path
    When the user opens the login page
    Then the page offers OIDC provider sign-in and preserves the requested return path

  @auth/web-redirect @web
  Scenario: Redirect unauthenticated users and return after sign-in
    When an unauthenticated user opens a protected page
    Then the app redirects to login and returns to the original page after sign-in

  # ── Cross-stack sign-in (e2e: real SPA + Worker + D1 + OIDC) ──
  # Native Playwright e2e specs execute this scenario for real through `pnpm run e2e`.

  @auth/e2e-sign-in @e2e
  Scenario: Complete sign in
    When a user completes the OIDC callback
    Then the browser stores the OIDC token and API requests resolve user, organization, and project context
    And invalid OIDC provider callbacks return the standard OIDC error envelope
