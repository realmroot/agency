Feature: Triggers
  Heartbeat-driven schedules and authenticated HTTP requests wake agents by
  creating sessions with initial prompts. A trigger snapshots its agent,
  optional environment pin, runtime, prompt template, and trigger source; scheduled triggers
  use a local heartbeat dispatcher, while HTTP triggers render prompt variables
  from the request that creates the run.

  # ── Definition lifecycle (usecase: business rules, cheapest layer) ──

  @triggers/create @usecase
  Scenario: Create a trigger from usable references
    Given a signed-in user with an active agent
    When the user creates a scheduled trigger with a prompt template, schedule, and optional environment pin
    Then the trigger is stored active with a derived next-due time when omitted
    And a missing agent or deleted environment is rejected before storing
    And retrying the same request with the same Idempotency-Key does not create another trigger

  @triggers/http-create @usecase
  Scenario: Create an HTTP trigger from usable references
    Given a signed-in user with an active agent and environment
    When the user creates an HTTP trigger with a prompt template
    Then the trigger is stored active without schedule timing
    And the HTTP trigger can render prompt variables from request fields

  @triggers/inbox-provisioning @usecase
  Scenario: Maintain one Inbox Subscription for an Inbox trigger
    Given a provider-bound Agent whose internal Identity id differs from its stable OIDC subject
    When the trigger is created, paused, resumed, or deleted
    Then Agency reconciles exactly one Trigger-owned Inbox Subscription through a dedicated OAuth service client
    And provisioning creates, reads, and deletes the Subscription conditionally with its current ETag
    And the Subscription references the stable OIDC subject rather than the internal Identity id
    And legacy rows use the canonical snapshot subject only as a transition target until remote GET calibrates the registered subject
    And active Subscriptions are reconciled whenever the remote registered subject differs from that target
    And retries reuse the encrypted callback credential while admission uses only its hash
    And provisioning state includes safe gateway diagnostics without exposing the callback Bearer token

  @triggers/lifecycle @usecase
  Scenario: Update and soft-delete a trigger
    Given a trigger exists
    When the user updates fields or deletes it
    Then schedule changes are snapshotted and the transition is reported
    And deleted triggers disappear from product APIs and cannot be restored
    And reference changes are re-validated when the agent or environment changes

  @triggers/validation @usecase
  Scenario: Reject secret material in trigger config
    When a trigger is created or updated with secret-looking metadata or environment variables
    Then the request is rejected with field-level validation details
    And no secret-bearing trigger config is persisted

  @triggers/delete @usecase
  Scenario: Soft-delete a trigger while retaining its run history
    Given a trigger with run history exists
    When the user deletes the trigger
    Then the trigger is absent from every product API and the delete is audited
    And its database tombstone and existing run history remain retained
    And no new run can be created for the deleted trigger
    And deleting a missing or foreign-project trigger is rejected as not found

  # ── API contract (api: assembled server, real D1, pagination, audit) ──

  @triggers/api-crud @api
  Scenario: Create, list, read, update, pause, delete, and audit triggers over the API
    Given a signed-in user with an active agent and environment
    When the user drives the triggers API end to end
    Then create, paginated list, search, suspend filter, read, update, and soft deletion are supported
    And trigger create, update, and delete actions are recorded in audit history
    And triggers expose safe metadata, spec, and status without raw tenancy fields

  @triggers/dispatch @api
  Scenario: Heartbeat dispatch creates one scheduled session per due occurrence
    Given a project has an active agent and active environments
    When the user creates a due trigger and the heartbeat dispatcher runs twice for the same occurrence
    Then one scheduled run creates a session with the initial prompt and schedule run metadata
    And duplicate heartbeat dispatch does not create another session for the same occurrence
    And the run exposes its session, state, scheduled time, correlation id, and idempotency key

  @triggers/http-dispatch @api
  Scenario: HTTP dispatch creates a session from request fields
    Given a signed-in user with an active HTTP trigger
    When the user posts JSON to the trigger runs collection
    Then one run creates a session with a prompt rendered from body, query, and allowed headers
    And later posts with the same routing key reuse the same live session instead of creating another one
    And missing template variables fail the run request without creating a session

  @triggers/inbox-callback @api
  Scenario: Reliably accept and deduplicate Inbox notifications
    Given an active Inbox trigger with a registered callback token and stable OIDC Agent subject
    When Inbox delivers the same subscription event more than once
    Then Agency durably accepts one Trigger Run before acknowledging delivery
    And a successful 202 response means the receipt is durable rather than the Agent work is complete
    And the notification stores Message references without copying the Message body
    And a subject transition accepts the registered and persisted target subjects only while provisioning is pending or failed
    And an uncalibrated legacy row with an existing ETag temporarily admits a schema-valid subject until remote GET persists its registration
    And a new Subscription without an ETag never receives that uncalibrated admission
    And active admission accepts only the subject confirmed by the last successful Subscription PUT
    And invalid tokens, internal Identity ids, and mismatched Agent subjects are rejected without creating a run

  @triggers/inbox-routing @api
  Scenario: Route Inbox notifications into Sessions by an opaque routing key
    Given an active Inbox trigger for a provider-bound Agent
    When Inbox delivers notifications with equal, different, and absent routing keys
    Then equal keys share one Session under an atomic route binding
    And a terminal or deleted bound Session is atomically replaced without splitting concurrent deliveries
    And a runner-sandbox Session whose live runner route was lost is atomically replaced while an accepted route is reused
    And a cloudflare-sandbox Session is reused without runner-channel preflight
    And different keys use different Sessions
    And notifications without a key each create a new Session
    And the Session prompt contains the tenant Context id, event and Message references, and Trigger instructions
    And personal tenant storage prefixes are not exposed while organization Context ids pass through unchanged
    And created routed Sessions record the sixty-second annotation when template metadata omits it and otherwise preserve the template value
    And pre-existing routed Sessions missing that annotation are backfilled atomically without overwriting current metadata
    And preserved zero or invalid annotation metadata still resolves to the shared runtime default

  @triggers/http-serial-dispatch @usecase
  Scenario: Serial HTTP triggers queue different subjects without delaying the active subject
    Given a serial HTTP trigger has an active session for one routing key
    When requests arrive for another routing key and then for the active routing key
    Then the other routing key remains queued until the active session becomes idle
    And the active routing key is delivered immediately to its existing session
    And queued routing keys dispatch in Enbor acceptance order with at most one active session

  @triggers/http-serial-wake-bounded @usecase
  Scenario: Blocked serial trigger wake signals remain bounded
    Given a serial HTTP trigger has queued runs blocked by an active session
    When a queued wake signal cannot claim the next run
    Then the blocked wake signal is consumed without scheduling another polling signal
    And session settlement or heartbeat recovery can wake the trigger again

  @triggers/inactive @api
  Scenario: Inactive triggers do not dispatch
    Given a project has paused and deleted triggers
    When the heartbeat dispatcher runs
    Then no sessions are created and the inactive triggers have no run history

  # ── Contract (api: OpenAPI) ──

  @triggers/openapi @api
  Scenario: Publish trigger routes in OpenAPI
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it includes the triggers collection, item, and runs paths
    And the legacy scheduled-agent-triggers namespace is gone

  @triggers/console-list @web
  Scenario: Browse triggers with readable agent identity
    Given a project has triggers and agents
    When the user opens the triggers page
    Then trigger rows show the selected agent name, id, provider, and model instead of only the agent id
    And trigger search can match the trigger name, agent id, or agent name
