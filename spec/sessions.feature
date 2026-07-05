Feature: Sessions
  A session is a tenant-scoped run of an agent version in a selected runtime.
  It snapshots its agent and environment, owns canonical events, and exposes a
  lifecycle (create, prompt, close, reopen, archive) behind AMA endpoints only.

  # ── State rules (domain: pure, no runtime) ──

  @sessions/state-rules @domain
  Scenario: Session state governs prompts and terminality
    Given a session in a given state
    Then prompts are accepted only while the runtime is live
    And error is terminal while closed can be reopened

  @sessions/workspace-safety @domain
  Scenario: Reject unsafe workspace and secret-bearing inputs
    Given session inputs declaring repositories, mount paths, and metadata
    When the inputs are normalized
    Then path traversal, the reserved root, and absolute escapes are rejected
    And secret-looking keys and credential-bearing URLs are rejected at any depth

  # ── API contract (api: assembled server, real D1, runtime, OpenAPI) ──

	  @sessions/create @api
	  Scenario: Create a session from an active agent and environment
	    Given a project has an active agent and an active environment
	    When the user creates a session with the agent and environment
	    Then the response includes metadata uid, spec, status, connection, and runtime metadata
	    And the session stores immutable agent and environment snapshots
	    And internal placement and tenancy fields never leave the API

	  @sessions/create-explicit-inputs @api
	  Scenario: Create a session with explicit runtime and secret references
	    Given a project has an active agent and active environments
	    When the user creates a session with name, metadata, env, envFrom, volumes, and volumeMounts
	    Then those values are stored as safe references
	    And repository resources are declared in the deterministic workspace manifest
	    And raw credentials are rejected from the request body

  @sessions/secret-projection @usecase
  Scenario: Project credential secrets into runtime inputs
    Given a session references vault credentials without pinning a version
    When runtime secrets are materialized for env and workspace volumes
    Then the active credential version is resolved at dispatch time
    And envFrom expands credential data keys into runtime environment variables
    And volume items project selected secret keys to the runtime-facing names

	  @sessions/memory-store-resources @api
	  Scenario: Create a session with attached memory stores
	    Given a project has an active memory store with memories
	    When the user creates a session with memory volumes and readOnly volumeMounts
    Then AMA stores memory references in volumes and readOnly settings in volumeMounts
    And runtime materialization mounts the current memory store contents
    And memory volumeMount readOnly settings and mount paths are included in the runtime system prompt context
    And memory contents are mounted as files instead of injected into the prompt

  @sessions/reject-dependencies @api
  Scenario: Reject unavailable or unsupported session dependencies
    When a session is created against an archived agent or environment, a disabled provider, a blocked sandbox policy, or an unsupported runtime/provider/model
    Then the request fails before any workspace, sandbox, or runner allocation
    And the error envelope identifies the unavailable or unsupported dependency
    And no session record is left in an active state

  @sessions/initial-prompt @api
  Scenario: Launch a session with an initial prompt over the API
    Given a project has an active agent and active environments
    When an external scheduler creates a session with an initial prompt and run correlation metadata
    Then the prompt is dispatched to the AMA-owned runtime without a browser socket
    And the initial-prompt dispatch is recorded as an audit event
    And workspace resource context is supplied through the session runtime snapshot

  @sessions/prompt @api
  Scenario: Send a prompt to an active session
    Given an idle session with cloud-owned runtime state
    When the user sends a prompt through the sessions API
    Then the runtime accepts it and message, tool, sandbox, usage, lifecycle, and error events are stored in sequence
    And the session returns to idle with a result or moves to error with a safe reason
    And self-hosted prompt resumption persists the queued work item and pending session state atomically

  @sessions/close @api
  Scenario: Close and reopen a running session cooperatively
    Given a session is running
    When the user closes the session
    Then cloud-owned runtime work is cancelled and no new work starts after the cancellation boundary
    And the status becomes closed with close lifecycle and audit records
    And the user can reopen the same session without a prompt and send follow-up work
    And no successful completion events are written after cancellation

	  @sessions/archive @api
	  Scenario: Archive and read sessions safely
	    Given a session exists
	    When the user archives the session
	    Then it is hidden from default lists but returned by archived filtering
    And archived sessions reject edits but can be restored
    And events and immutable snapshots remain readable

  @sessions/list @api
  Scenario: List sessions with pagination, state, search, label selector, and date filters
    Given a project has sessions
    When the user lists sessions with a page size, state, search term, metadata label selector, and date range
    Then the response paginates with cursors and applies state, search, metadata label selector, and date filters
    And results are scoped to the signed-in project

  @sessions/auth-tenancy @api
  Scenario: Enforce auth and project tenancy for session lifecycle
    Given a session belongs to a project
    When a request without a valid session, or a user outside the project, accesses the session
    Then the request is rejected and no cross-project data is returned

  @sessions/connection @api
  Scenario: Expose live browser traffic only through the AMA session socket
    Given a session exists in cloud or self-hosted hosting
    When a browser opens the session socket
    Then the request upgrades to the AMA session WebSocket after auth and tenancy checks
    And non-WebSocket requests are rejected instead of returning runtime discovery metadata

  # ── Canonical events (api + domain: protocol normalization) ──

  @sessions/events-canonical @api
  Scenario: Normalize all runtime output into canonical session events
    Given a session runs with any supported runtime
    When the runtime emits lifecycle, message, tool, and usage activity
    Then it is stored as canonical session events read by UI, API, and session-state views
    And runtime-specific details appear only as safe metadata

  @sessions/events-query @api
  Scenario: Query session events with stable pagination and filters
    Given a session has many events
    When the client lists events with limit, order, type filter, or cursor
    Then the response returns a deterministic page with sequence boundaries
    And CSV and SSE views are available through content negotiation

  @sessions/tool-result-redaction @api
  Scenario: Redact sensitive tool result output
    Given a tool result emits sensitive values
    When the event is stored or streamed
    Then tool result output redacts high-confidence secret values
    And tool calls, runtime state, and control-plane references keep their original structure

  @sessions/events-hierarchy @domain
  Scenario: Preserve event hierarchy for product consumers
    Given a runtime emits nested turns, messages, tool calls, and substeps
    When AMA stores the session events
    Then every event has a stable id and monotonically increasing sequence
    And related events share turn, message, tool-call, and span identifiers with parent references
    And sub-agent work is represented as an agent tool call whose child events reference that tool call through parentToolCallId

  # ── Web console (web: session list, detail, transcript, tool trace) ──

  @sessions/console-detail @web
  Scenario: Render session list and detail from snapshots
    Given sessions exist with agent and environment snapshots
    When the user opens the sessions list and a session detail
    Then rows and detail facts come from agent provider/model, hosting snapshots, and session runtime
    And error, closed, and archived states are surfaced without leaking detail onto table rows

  @sessions/console-transcript @web
  Scenario: Render canonical events as transcript, debug, and tool trace
    Given a session has persisted canonical events
    When the user opens the session transcript
    Then transcript renders structured message, tool, lifecycle, usage, and error rows
    And debug keeps canonical payload JSON while the tool-trace tab pairs calls with results
    And raw payloads stay out of transcript mode while tool-result redaction stays intact
