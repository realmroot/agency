Feature: Agents
  Project-scoped, versioned agent definitions: reusable system prompts, model,
  tools, MCP connectors, sub-agents, and skills that sessions snapshot.

  # ── Definition lifecycle (domain + usecase: business rules, cheapest layer) ──

  @agents/create @usecase
  Scenario: Create an agent definition
    Given a signed-in user with access to a project
    When the user creates an agent with an explicit runtime, instructions, provider, model, skills, tools, MCP connectors, and metadata
    Then the agent is stored with a current version, project id, timestamps, and archive state
    And the first version snapshots the normalized runtime configuration
    And the agent defaults to the project default provider without forcing a model
    And an unselected model remains null without a synthetic default model id

  @agents/update @usecase
  Scenario: Version an agent on editable execution configuration change
    Given an agent exists at version 1
    When the user changes an editable provider, model, or instruction field
    Then a new immutable version is snapshotted and becomes current
    And sessions created before the change keep the version 1 snapshot
    But the Agent runtime cannot be changed after creation

  @agents/realmroot-binding @usecase
  Scenario: Provision one Realmroot identity as part of Agent creation
    Given a signed-in User authorized agents:write for the AMA Resource
    When the caller creates one Agent with an immutable username
    Then AMA initializes key material in an encrypted managed Vault before calling Realmroot
    And the same confidential Web Application authenticates with OIDC_CLIENT_ID and OIDC_CLIENT_SECRET to perform a restricted RFC 8693 exchange of the inbound User token
    And AMA uses the exchanged User-subject Realmroot /api Bearer to create the stable identity through POST /api/agents without approval
    And the exchanged token contains no Agent actor and is never returned, persisted, or refreshed by AMA
    And concurrent or interrupted retries reuse the same encrypted Vault checkpoint and exact Realmroot request
    And POST returns 201 with the ready Agent and its canonical Location without exposing a provisioning resource
    And only a ready Agent with non-empty issuer and subject enters the directory
    And raw Realmroot state, keys, and access tokens never enter Agent, Profile, or API records

  @agents/delete @api
  Scenario: Delete an unreferenced Agent locally
    Given an Agent is not referenced by a Session or Trigger
    When an authorized caller deletes the Agent
    Then AMA deletes the Agent and all of its immutable versions and returns 204
    And AMA does not call Realmroot or destroy a managed Vault
    But an Agent referenced by a Session or Trigger is retained and the request returns 409

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
    And an invalid immutable username or unsupported runtime is rejected before provisioning
    And claude-code accepts anthropic, codex accepts openai, copilot accepts github-copilot, and ama accepts any available vendor

  @agents/tool-contract @domain
  Scenario: Normalize and gate tool attachments
    Given an agent declares tool attachments
    When the tool policy is applied
    Then tool attachments are normalized to the stable contract
    And governance-blocked tools are rejected

  # ── API contract (api: assembled server, OpenAPI, tenancy, pagination) ──

  @agents/api-crud @api
  Scenario: Create, read, update, version, archive, and list agents over the API
    Given a signed-in user with access to a project
    When the user drives the agents API end to end
    Then create, read, update, version history, archive, and list are supported
    And the API enforces auth, project tenancy, model policy, and tool policy
    And normal agent responses never expose sandbox policy

  @agents/api-openapi @api
  Scenario: Publish agent routes in the OpenAPI document
    Given the Worker app is initialized
    When the OpenAPI document is requested
    Then it includes the agents collection, item, and versions paths
    And the system prompt, tools, sub-agents, and skills contract is exposed through OpenAPI and generated SDKs

	  @agents/api-pagination @api
	  Scenario: List agents with pagination, filters, and tenant scope
	    Given a project has active and archived agents with and without complete Realmroot identities created across dates
	    When the user lists agents with a page size
	    Then the response includes data and cursor pagination metadata
	    And archived agents are hidden unless archived filtering is requested
    And hasIdentity=true returns only Agents with a complete identity while hasIdentity=false returns all others
    And created-date filters and project scope are respected

  @agents/api-archive @api
  Scenario: Archive an agent safely
    Given an agent exists with existing sessions
    When the user archives the agent
    Then it is hidden from default lists and creation flows
    And new sessions cannot be created from it while existing sessions stay readable
    And the archive operation records an audit event

  # ── Web console (web: list and detail in jsdom) ──

  @agents/console-list @web
  Scenario: Browse, filter, and create agents from the agents page
    Given a project has agents
    When the user opens the agents page
    Then rows show name, model, tools, status, version, and updated time
    And the page supports search, filters, and navigation to agent detail
    And the create form starts with no skills and requires an explicit runtime selection
    And creating an agent returns to the list with the new row visible

  @agents/console-detail @web
  Scenario: Inspect agent detail without raw runtime JSON
    Given a project has an agent with model configuration and instructions
    When the user opens the agent detail page
    Then the selected version shows provider, model, tools, skills, MCP connectors, and system prompt as readable fields
    And sessions that selected the agent are listed separately
