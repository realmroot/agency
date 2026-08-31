Feature: Triggers
  Heartbeat-driven schedules and authenticated HTTP requests wake agents by
  creating sessions with initial prompts. A trigger snapshots its agent,
  environment, runtime, prompt template, and trigger source; scheduled triggers
  use a local heartbeat dispatcher, while HTTP triggers render prompt variables
  from the request that creates the run.

  # ── Definition lifecycle (usecase: business rules, cheapest layer) ──

  @triggers/create @usecase
  Scenario: Create a trigger from usable references
    Given a signed-in user with an active agent and environment
    When the user creates a scheduled trigger with a prompt template and schedule
    Then the trigger is stored active with a derived next-due time when omitted
    And a missing agent or archived environment is rejected before storing

  @triggers/http-create @usecase
  Scenario: Create an HTTP trigger from usable references
    Given a signed-in user with an active agent and environment
    When the user creates an HTTP trigger with a prompt template
    Then the trigger is stored active without schedule timing
    And the HTTP trigger can render prompt variables from request fields

  @triggers/inbox-provisioning @usecase
  Scenario: Maintain one Inbox Subscription for an Inbox trigger
    Given a Realmroot-bound Agent whose internal Identity id differs from its stable OIDC subject
    When the trigger is created, paused, resumed, archived, or deleted
    Then Agency reconciles the Trigger-owned Inbox Subscription through its service identity
    And the Subscription references the stable OIDC subject rather than the internal Identity id
    And provisioning state includes safe gateway diagnostics without exposing the callback Bearer token

  @triggers/lifecycle @usecase
  Scenario: Update, archive, and restore a trigger
    Given a trigger exists
    When the user updates fields, archives, or restores it
    Then schedule changes are snapshotted and the transition is reported
    And archived triggers reject field updates until restored
    And reference changes are re-validated when the agent or environment changes

  @triggers/validation @usecase
  Scenario: Reject secret material in trigger config
    When a trigger is created or updated with secret-looking metadata or environment variables
    Then the request is rejected with field-level validation details
    And no secret-bearing trigger config is persisted

  @triggers/delete @usecase
  Scenario: Permanently delete a trigger and its runs
    Given a trigger with run history exists
    When the user deletes the trigger
    Then the trigger and all of its runs are removed and the delete is audited
    And deleting a missing or foreign-project trigger is rejected as not found

  # ── API contract (api: assembled server, real D1, pagination, audit) ──

  @triggers/api-crud @api
  Scenario: Create, list, read, update, pause, archive, restore, and audit triggers over the API
	    Given a signed-in user with an active agent and environment
	    When the user drives the triggers API end to end
	    Then create, paginated list, search, suspend filter, read, update, archive, and restore are supported
	    And trigger create, update, and archive actions are recorded in audit history
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
    And later posts with the same routing key reuse the same non-archived session instead of creating another one
    And missing template variables fail the run request without creating a session

  @triggers/inbox-callback @api
  Scenario: Reliably accept and deduplicate Inbox notifications
    Given an active Inbox trigger with a registered callback token and stable OIDC Agent subject
    When Inbox delivers the same subscription event more than once
    Then Agency durably accepts one Trigger Run before acknowledging delivery
    And invalid tokens, internal Identity ids, and mismatched Agent subjects are rejected without creating a run

  @triggers/inbox-routing @api
  Scenario: Route Inbox notifications into Sessions by an opaque routing key
    Given an active Inbox trigger for a Realmroot-bound Agent
    When Inbox delivers notifications with equal, different, and absent routing keys
    Then equal keys share one Session under an atomic route binding
    And different keys use different Sessions
    And notifications without a key each create a new Session

  @triggers/http-serial-dispatch @usecase
  Scenario: Serial HTTP triggers queue different subjects without delaying the active subject
    Given a serial HTTP trigger has an active session for one routing key
    When requests arrive for another routing key and then for the active routing key
    Then the other routing key remains queued until the active session becomes idle
    And the active routing key is delivered immediately to its existing session
    And queued routing keys dispatch in AMA acceptance order with at most one active session

  @triggers/http-serial-wake-bounded @usecase
  Scenario: Blocked serial trigger wake signals remain bounded
    Given a serial HTTP trigger has queued runs blocked by an active session
    When a queued wake signal cannot claim the next run
    Then the blocked wake signal is consumed without scheduling another polling signal
    And session settlement or heartbeat recovery can wake the trigger again

  @triggers/inactive @api
  Scenario: Inactive triggers do not dispatch
    Given a project has paused and archived triggers
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
