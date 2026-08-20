Feature: Runners
  Self-hosted environments are serviced by registered runtime runners that lease
  AMA-owned session work. AMA queues work without a Cloudflare Sandbox, runners
  claim leases for eligible work, provide sandbox execution for AMA sessions,
  run CLI-backed runtimes over a runner-owned channel, and the work queue recovers
  expired leases. AMA stays the control plane and canonical event store;
  runner-local runtime endpoints are never exposed.

  # ── Eligibility and registration (domain + usecase: matching, binding) ──

  @runners/eligibility @domain
  Scenario: Match runners to work by structured runtime declarations
    Given a work item declares a structured runtime and optional model requirement
    When a runner is evaluated for the work
    Then only a runner reporting that ready runtime and exact selected model in its runtimes list is eligible
    And an already-assigned lease remains locally valid if that same matching runtime becomes limited after the scheduling heartbeat
    And a null model requires only the ready runtime without inventing a model id
    And session starts that declare no runtime requirement are not claimable
    And local sandbox tool work requires the AMA runtime while other unscoped non-session work is claimable by any runner

  @runners/auth-binding @domain
  Scenario: Bind runner registration to its Realmroot token
    Given a runner registers with a Realmroot device-login token
    When the registration auth mode and environment are resolved
    Then the auth mode and bound environment follow the token binding
    And the runner sends a fresh DPoP proof for every control-plane request
    And a device-login token cannot register a non-OIDC runner
    And raw secret material in runner metadata or runtime diagnostics is rejected

  @runners/local-credential-refresh @domain
  Scenario: Coordinate shared local runner credential refresh
    Given multiple local runners use the same saved credential profile
    When one runner refreshes the profile before another runner uses its stale in-memory token
    Then the second runner reuses the refreshed credential from disk instead of reusing the old refresh token

  @runners/register @usecase
  Scenario: Register and manage a runner with safe references
    Given an operator registers a runner with usable environment and credential references
    When the runner is created, updated, or archived
    Then references are validated, secret material is rejected, and archive uses the archived flag
    And a machine-bound Realmroot runner re-registers instead of inserting a duplicate

  @runners/claim-eligibility @usecase
  Scenario: Claim a lease only for eligible available work
    Given a runner attempts to claim a work item
    When the claim is evaluated
    Then inactive runners, missing work, unsupported runtime requirements, at-capacity, and lost-race claims are rejected
    And claim-time secret resolution failure fails the claim cleanly

  # ── Heartbeat and runtimes (api: assembled server, real D1) ──

  @runners/heartbeat @api
  Scenario: Register a runner and report supported runtimes through the heartbeat singleton
    Given a self-hosted environment and a vault credential reference
    When the operator registers a runner and sends a heartbeat
    Then the runner stores only safe metadata and never the raw credential value
    And the heartbeat reports one runtimes list with each runtime's models, version, availability state, and safe diagnostics
    And the runner resource does not expose a generic capabilities field or a legacy runtimeInventory field
    And host platform metadata is diagnostic while the runtimes list remains authoritative for scheduling
    And Windows omits the unsupported AMA runtime while still reporting detected CLI-backed runtimes
    And quota-governed runtimes are probed before the first schedulable heartbeat
    And quota-governed runtimes whose usage probe is unavailable are reported as limited before work can be assigned
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
    And reading the session after the startup window does not terminalize runner recovery
    And an eligible runner can claim the recovered work again, return the session to running, and complete it to idle

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
