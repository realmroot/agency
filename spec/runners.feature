Feature: Runners
  Self-hosted environments are serviced by registered runtime runners that lease
  AMA-owned session work. AMA queues work without a Cloudflare Sandbox, runners
  claim leases for eligible work, provide sandbox execution for AMA sessions,
  run external runtimes over a runner-owned channel, and the work queue recovers
  expired leases. AMA stays the control plane and canonical event store;
  runner-local runtime endpoints are never exposed.

  # ── Eligibility and registration (domain + usecase: matching, binding) ──

  @runners/eligibility @domain
  Scenario: Match runners to work by capability and ready runtime inventory
    Given a work item declares a required runtime, provider, and model capability
    When a runner is evaluated for the work
    Then only a runner advertising the exact capability with ready runtime inventory is eligible
    And session starts that declare no required capability are not claimable
    And unscoped non-session work is claimable by any runner

  @runners/auth-binding @domain
  Scenario: Bind runner registration to its OIDC or federated token
    Given a runner registers with a device-login or federated token
    When the registration auth mode and environment are resolved
    Then the auth mode and bound environment follow the token binding
    And a device-login token cannot register a non-OIDC runner and a federated token cannot register a non-federated runner
    And raw secret material in runner metadata or capabilities is rejected

  @runners/register @usecase
  Scenario: Register and manage a runner with safe references
    Given an operator registers a runner with usable environment and credential references
    When the runner is created, updated, or archived
    Then references are validated, secret material is rejected, and archive uses the archived flag
    And a machine-bound federated runner re-registers instead of inserting a duplicate

  @runners/claim-eligibility @usecase
  Scenario: Claim a lease only for eligible available work
    Given a runner attempts to claim a work item
    When the claim is evaluated
    Then inactive runners, missing work, ineligible capability, at-capacity, and lost-race claims are rejected
    And claim-time secret resolution failure fails the claim cleanly

  # ── Heartbeat and inventory (api: assembled server, real D1) ──

  @runners/heartbeat @api
  Scenario: Register a runner and report runtime inventory through the heartbeat singleton
    Given a self-hosted environment and a vault credential reference
    When the operator registers a runner and sends a heartbeat
    Then the runner stores only safe metadata and never the raw credential value
    And the heartbeat reports supported runtimes with version, availability state, and safe diagnostics
    And quota-governed runtimes whose usage probe is unavailable are reported as limited
    And disabled runners cannot heartbeat themselves active and every runner endpoint requires authentication

  # ── Work queue and leases (api: assembled server, channel, lifecycle) ──

  @runners/queue-work @api
  Scenario: Queue self-hosted session work without a Cloudflare Sandbox
    Given a self-hosted environment has an active eligible runner
    When the user creates a session in that environment
    Then AMA queues session work without creating a Cloudflare Sandbox
    And the session stays pending with a waiting-for-runner reason until a runner claims it

  @runners/work-items @api
  Scenario: List and read queued session work with intact payload references
    Given a self-hosted session has queued work
    When a user or runner token lists and reads work items with state and search filters
    Then work items expose state, session, environment, runner, lease, and payload references
    And unresolved secret references keep their canonical type and reference shape

  @runners/lease-claim @api
  Scenario: Claim a specific work item as a lease
    Given an available work item and an eligible active runner
    When the runner claims the work item
    Then a lease is created, the work item becomes leased, and the materialized payload resolves secret env into runtime env
    And the same work item cannot be claimed twice
    And the session becomes running only after the runner opens the lease channel

  @runners/lease-lifecycle @api
  Scenario: Renew, complete, fail, and channel-guard a lease
    Given a runner holds an active lease for self-hosted work
    When the runner renews, completes, or fails the lease
    Then outcomes land on the work item and drive the session to idle or error
    And the lease channel rejects non-upgrade requests and finished leases
    And a finished lease can no longer be renewed or completed

  @runners/lease-recovery @api
  Scenario: Recover interrupted or expired leases to available work
    Given a runner lease for self-hosted work is interrupted or expires before renewal
    When the queue is read
    Then the work returns to available with the bound target runtime session id and a null runner
    And the session exposes a safe waiting-for-runner-recovery reason
    And an eligible runner can claim the recovered work again

  @runners/session-runtime-binding @api
  Scenario: Bind each AMA session to one target runtime session
    Given a runner lease reports a target runtime session id for self-hosted work
    When the same AMA session reports a different target runtime session id
    Then AMA rejects the lease update before persisting the second target runtime session id
    And the original target runtime session id remains the only binding for that AMA session

  @runners/live-prompt @api
  Scenario: Deliver prompts to a live self-hosted runner session
    Given a self-hosted session is already leased to an online runner
    When the user sends another prompt to that running session
    Then AMA delivers the prompt over the runner session command channel
    And the prompt does not create a second queued work item
    And live session events continue to stream through the browser session socket

  # ── Contract (api: OpenAPI) ──

  @runners/openapi @api
  Scenario: Publish runner queue routes in OpenAPI
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it includes the runners, heartbeat, leases, lease channel, and work-items paths
    And the legacy runner lease and heartbeat namespaces are gone
