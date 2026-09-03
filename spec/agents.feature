Feature: Agents
  Project-scoped, versioned agent definitions: reusable system prompts, model,
  tools, MCP connectors, sub-agents, and skills that sessions snapshot.

  # ── Definition lifecycle (domain + usecase: business rules, cheapest layer) ──

  @agents/create @usecase
  Scenario: Create an agent definition
    Given a signed-in user with access to a project
    When the user creates an agent with instructions, provider, model, skills, tools, MCP connectors, and metadata
    Then the agent is stored with a current version, project id, timestamps, and deletion tombstone
    And the first version snapshots the normalized runtime configuration
    And an unselected provider and model remain null without synthetic platform defaults

  @agents/update @usecase
  Scenario: Version an agent on runtime-relevant change
    Given an agent exists at version 1
    When the user changes a runtime-relevant field
    Then a new immutable version is snapshotted and becomes current
    And sessions created before the change keep the version 1 snapshot

  @agents/identity-binding @usecase
  Scenario: Snapshot an optional Identity binding
    Given an agent selects an active Identity from the same project
    When the agent is created or updated
    Then a new Agent Version stores only the safe Identity descriptor and immutable runtime
    And changing or removing Identity creates another Agent Version
    And an Identity whose runtime has no registered Enbor driver is rejected without being bound

  @agents/inbox-identity-rebind @usecase
  Scenario: Keep a live Inbox Trigger bound to one mailbox identity
    Given an agent has a live Inbox Trigger bound to its Realmroot Identity
    When the user attempts to replace or remove that Identity
    Then the update is rejected as a conflict
    And the guarded Agent update and version insert are atomic without an orphan version
    And concurrent Inbox Trigger creation and Identity rebinding serialize around the live Trigger row
    And non-Identity configuration updates remain available

  @agents/lifecycle @usecase
  Scenario: Partial updates leave omitted fields and prune null metadata
    Given an agent with instructions, description, model config, tools, and metadata
    When the user updates only some fields and sets a metadata key to null
    Then omitted runtime fields stay unchanged
    And the nulled metadata key is removed while other keys remain

  @agents/validation @domain
  Scenario: Reject invalid agent configuration
    When an agent is saved with an unavailable provider, blocked tool, invalid skill, or raw secret material
    Then the request is rejected with field-level validation details
    And secret material is never accepted inside policy, metadata, tools, or connector configuration
    And an unavailable or foreign-project Identity is rejected

  @agents/tool-contract @domain
  Scenario: Normalize and gate tool attachments
    Given an agent declares tool attachments
    When the tool policy is applied
    Then tool attachments are normalized to the stable contract
    And governance-blocked tools are rejected

  # ── API contract (api: assembled server, OpenAPI, tenancy, pagination) ──

  @agents/api-crud @api
  Scenario: Create, read, update, version, delete, and list agents over the API
    Given a signed-in user with access to a project
    When the user drives the agents API end to end
    Then create, read, update, version history, soft deletion, and list are supported
    And the API enforces auth, project tenancy, model policy, and tool policy
    And normal agent responses never expose sandbox policy

  @agents/create-idempotency @api
  Scenario: Retry Agent creation without duplicating an Identity binding
    Given a caller supplies an Idempotency-Key when creating an Agent
    When the same project retries the same request with that key
    Then Enbor returns the originally created Agent without another Agent Version
    And reusing the key for different Agent data is rejected as a conflict

  @agents/api-openapi @api
  Scenario: Publish agent routes in the OpenAPI document
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it includes the agents collection, item, and versions paths
    And the system prompt, tools, sub-agents, and skills contract is exposed through OpenAPI and generated SDKs

  @agents/api-identity-lookup @api
  Scenario: Resolve an agent by its Realmroot actor identity
    Given an active agent is bound to a Realmroot Identity in a project
    When the user filters agents by the exact Realmroot actor id
    Then the bound agent is returned without exposing agents from another project
    And missing, deleted, and malformed identity filters follow the collection contract

  @agents/api-pagination @api
  Scenario: List agents with pagination, filters, and tenant scope
	    Given a project has live and soft-deleted agents created across dates
	    When the user lists agents with a page size
	    Then the response includes data and cursor pagination metadata
	    And deleted agents are never returned by product APIs
    And created-date filters and project scope are respected

  @agents/api-schedulability @api
  Scenario: Discover agents that Enbor can schedule through Inbox
    Given active Agents have Realmroot Identities and Inbox Triggers in a project
    When a caller lists Agents by Identity runtime or schedulable state
    Then each Agent reports whether an active Inbox Trigger can resolve a compatible live execution environment
    And runtime filtering uses the exact runtime of the bound Identity
    And scheduling ignores task ownership, workload, and any accepting-tasks flag
    And deleted Agents, Identities, Triggers, Environments, and Runners never make an Agent schedulable

  @agents/api-delete @api
  Scenario: Soft-delete an agent without a restore path
    Given an agent exists with existing sessions
    When the user deletes the agent
    Then it is hidden from default lists and creation flows
    And deletion does not revalidate legacy runtime configuration
    And a legacy sub-agent configuration is normalized to the current response contract
    And new sessions cannot be created from it while existing sessions stay readable
    And the delete operation records an audit event

  # ── Web console (web: list and detail in jsdom) ──

  @agents/console-list @web
  Scenario: Browse, filter, and create agents from the agents page
    Given a project has agents
    When the user opens the agents page
    Then rows show name, model, tools, status, version, and updated time
    And the page supports search, filters, and navigation to agent detail
    And creating an agent returns to the list with the new row visible

  @agents/console-detail @web
  Scenario: Inspect agent detail without raw runtime JSON
    Given a project has an agent with model configuration and instructions
    When the user opens the agent detail page
    Then the selected version shows provider, model, tools, skills, MCP connectors, and system prompt as readable fields
    And sessions that selected the agent are listed separately
