Feature: Runners
  Self-hosted environments are serviced by registered runtime runners that lease
  Enbor-owned session work. Enbor queues work without a Cloudflare Sandbox, runners
  claim leases for eligible work, provide sandbox execution for Enbor sessions,
  run CLI-backed runtimes over a runner-owned channel, and the work queue recovers
  expired leases. Enbor stays the control plane and canonical event store;
  runner-local runtime endpoints are never exposed.

  @runners/local-instances @unit
  Scenario: Manage isolated local Runner instances
    Given an operator does not configure runner state or work directories
    When runners connect to Enbor API Servers and Environments
    Then each API Server and Environment pair receives one stable isolated state directory
    And the same pair cannot run more than one local Runner process
    And the operator can start, list, inspect, stop, restart, configure, view logs, and remove local Runner instances
    And managed Runners do not start at login unless the operator explicitly enables that policy
    And the operator can inspect and change the start-at-login policy without changing whether the Runner is currently running
    And local process state is reported separately from Enbor control-plane heartbeat state
    And restarting an instance reuses its Runner identity, workspaces, and session event logs
    And each instance keeps using the Realmroot account selected when it was created even when another account becomes active for the same API Server
    And explicit state and work directory overrides are available only to foreground run mode

  # ── Eligibility and registration (domain + usecase: matching, binding) ──

  @runners/eligibility @domain
  Scenario: Match runners to work by structured runtime declarations
    Given a work item declares a structured runtime and optional model requirement
    When a runner is evaluated for the work
    Then only a runner reporting that ready runtime and exact selected model in its runtimes list is eligible
    And an already-assigned lease remains locally valid if that same matching runtime becomes limited after the scheduling heartbeat
    And a null model requires only the ready runtime without inventing a model id
    And session starts that declare no runtime requirement are not claimable
    And local sandbox tool work requires the Enbor runtime while other unscoped non-session work is claimable by any runner

  @runners/auth-binding @domain
  Scenario: Bind runner registration to its Realmroot token
    Given a runner registers with a Realmroot Context login token from loopback PKCE
    When the registration auth mode and environment are resolved
    Then the auth mode and bound environment follow the token binding
    And the runner sends its short-lived access token as Bearer authentication
    And a runner login token cannot register a non-OIDC runner
    And raw secret material in runner metadata or runtime diagnostics is rejected

  @runners/local-credential-refresh @domain
  Scenario: Coordinate shared local runner credential refresh
    Given multiple local runners use the same saved credential profile
    When one runner refreshes the profile before another runner uses its stale in-memory token
    Then the second runner reuses the refreshed credential from disk instead of reusing the old refresh token

  @runners/register @usecase
  Scenario: Register and manage a runner with safe references
    Given an operator registers a runner with usable environment and credential references
    When the runner is created, updated, or deleted
    Then references are validated, secret material is rejected, and deletion leaves an irreversible tombstone
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
    And Windows omits the unsupported Enbor runtime while still reporting detected CLI-backed runtimes
    And quota-governed runtimes are probed before the first schedulable heartbeat
    And quota-governed runtimes whose usage probe is unavailable are reported as limited before work can be assigned
    And disabled runners cannot heartbeat themselves active and every runner endpoint requires authentication

  @runners/stale-heartbeat @api
  Scenario: Treat runners that stop heartbeating as offline
    Given an active self-hosted runner stops sending heartbeats beyond the control-plane grace window
    When operators read or filter runners and Enbor evaluates runtime scheduling or lease claims
    Then the runner is reported as offline and excluded from active runner results
    And it cannot satisfy runtime availability or claim new work while its heartbeat is stale
    And a fresh heartbeat makes the same runner active again without re-registration

  # ── Work queue and leases (api: assembled server, channel, lifecycle) ──

  @runners/queue-work @api
  Scenario: Queue self-hosted session work without a Cloudflare Sandbox
    Given a self-hosted environment has an active eligible runner
    When the user creates a session in that environment
    Then Enbor queues session work without creating a Cloudflare Sandbox
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
    And losing lease ownership cancels local work and records a cancelled outcome
    And control-plane cancellation of already running self-hosted work is not available until a cancellation resource is defined

  @runners/enbor-sandbox-channel @api
  Scenario: Keep an Enbor sandbox channel after startup work completes
    Given a self-hosted Enbor session has completed its startup lease
    When the Enbor runtime executes a sandbox tool for that session
    Then the runner pool routes the sandbox request through the live runner channel
    And a reconnect advertises and restores every active Enbor Session route
    And only the current runner connection may replace or retire its routes
    And stopping the sandbox retires live routing while preserving event backfill
    And completed CLI runtime sessions remain unavailable for live sandbox requests

  @runners/lease-recovery @api
  Scenario: Recover interrupted or expired leases to available work
    Given a runner lease for self-hosted work is interrupted or expires before renewal
    When the queue is read
    Then the work returns to available with the bound target runtime session id and a null runner
    And the session exposes a safe waiting-for-runner-recovery reason
    And reading the session after the startup window does not terminalize runner recovery
    And an eligible runner can claim the recovered work again, return the session to running, and complete it to idle

  @runners/session-runtime-binding @api
  Scenario: Bind each Enbor session to one target runtime session
    Given a runner lease reports a target runtime session id for self-hosted work
    When the same Enbor session reports a different target runtime session id
    Then Enbor rejects the lease update before persisting the second target runtime session id
    And the original target runtime session id remains the only binding for that Enbor session

  @runners/live-prompt @api
  Scenario: Deliver prompts to a live self-hosted runner session
    Given a self-hosted session is already leased to an online runner
    When the user sends another prompt to that running session
    Then Enbor delivers the prompt over the runner session command channel only through a runner that supports command acknowledgements
    And Enbor accepts the prompt only after the runner writes it to the live runtime bridge
    And retries across channel reconnection reuse one request id so a lost acknowledgement cannot deliver the prompt twice while the runner process remains alive
    And restarting the runner process is an explicit at-least-once delivery boundary
    And a runner without the acknowledgement capability returns a retryable conflict until it is upgraded
    And the prompt does not create a second queued work item
    And live session events continue to stream through the browser session socket

  # ── Contract (api: OpenAPI) ──

  @runners/openapi @api
  Scenario: Publish runner queue routes in OpenAPI
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it includes the runners, heartbeat, leases, lease channel, and work-items paths
    And the legacy runner lease and heartbeat namespaces are gone
