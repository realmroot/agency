Feature: Auth
  The platform delegates identity to Realmroot and applies a single tenant
  context (user, organization, project) to both the control plane and the runtime.

  # ── OIDC claim resolution (domain: pure token-to-scope rules) ──

  @auth/oidc-claims @domain
  Scenario: Resolve a tenant scope from OIDC claims
    Given a valid Realmroot access token with identity claims and the exact AMA resource audience
    When the platform resolves the request context
    Then it derives user, organization, and project context from the claims
    And deterministic runner tokens require a configured runner client
    And a token without an explicit operation scope receives no implicit owner authority
    And each control-plane operation requires its resource read or write scope

  @auth/oidc-audience @domain
  Scenario: Reject an access token issued for another resource
    Given a signed Realmroot access token from the configured issuer
    When its audience does not identify the AMA resource
    Then authentication fails closed before tenant context is resolved

  # ── Session and context API (api: assembled server, real D1) ──

  @auth/credential-mode @api
  Scenario: Select the credential mode from the verified Realmroot client
    Given Realmroot issued an at+jwt access token for the exact AMA resource
    When a direct Console client sends Bearer authentication or the browser sends its opaque AMA session cookie
    Then both credentials resolve through the same exact-scope authorization context without a proof-of-possession requirement
    And an explicitly trusted Web application may present its own Bearer token for the exact AMA resource
    And the runner client also uses Bearer authentication while the Realmroot CLI client requires a fresh DPoP proof whose key matches cnf.jkt
    And using a client through the wrong credential mode fails closed without fallback

  @auth/dpop @api
  Scenario: Require proof of possession for Agent requests
    Given Realmroot issued a DPoP-bound Agent token for the exact AMA resource
    When the caller omits the DPoP proof, replays it, changes its method or URL, or uses another key
    Then authentication fails closed with a DPoP challenge
    And a fresh proof whose key matches cnf.jkt is accepted once

  @auth/session-current @api
  Scenario: Read the Realmroot-authenticated context
    Given an authenticated user
    When the user reads the current session context
    Then the context returns user, organization, and project without the organization id
    And a browser login is represented only by an opaque HttpOnly cookie backed by an encrypted Realmroot token

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
    Given the public AMA configuration
    When the user requests the discovery config
    Then the confidential AMA backend sign-in method is returned only when its client secret and session encryption key are configured
    And public configuration returns the Realmroot issuer, runner client, exact resource, and runner scopes without exposing browser credentials

  @auth/callback @api
  Scenario: Complete a server-owned browser authorization response
    Given the browser created a state, nonce, and PKCE-bound authorization attempt
    When Realmroot returns a valid authorization code to the AMA backend
    Then AMA consumes the attempt once and authenticates the confidential client with client_secret_basic
    And AMA stores the access token as authenticated ciphertext in D1
    And the browser receives only an opaque HttpOnly SameSite cookie
    And invalid, expired, replayed, or cross-browser responses fail without creating a session

  @auth/delegated-bootstrap @api
  Scenario: Delegate first-admin bootstrap to the OIDC provider
    Given AMA starts without local users or organizations
    Then Realmroot remains responsible for first-admin bootstrap and credential rotation
    And AMA accepts only validated Realmroot identity and authority claims for product access

  # ── Web console (web: login action and auth redirect) ──

  @auth/login-page @web
  Scenario: Render the Realmroot sign-in action and preserve the return path
    When the user opens the login page
    Then the page offers Realmroot sign-in and preserves the requested return path

  @auth/web-redirect @web
  Scenario: Redirect unauthenticated users and return after sign-in
    When an unauthenticated user opens a protected page
    Then the app redirects to login and returns to the original page after sign-in

  # ── Browser sign-in handoff (e2e: real SPA browser wiring) ──
  # Protocol completion, D1 persistence, and scope continuity live at the
  # assembled Worker integration layer in auth/callback.

  @auth/e2e-sign-in @e2e
  Scenario: Start browser sign in
    When an unauthenticated browser chooses Realmroot sign in
    Then the SPA creates a server-owned authorization attempt and navigates to Realmroot
    And no OAuth token is exposed to browser JavaScript or browser storage
