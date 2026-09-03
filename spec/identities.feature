Feature: Identities
  An Identity is an AMA-managed, provider-neutral Agent identity with an immutable
  runtime. Its safe descriptor is stable across runtimes and its private state lives
  only in a dedicated managed Vault. Realmroot is the current provider adapter.

  @identities/provision @api
  Scenario: Provision a personal Realmroot Agent identity synchronously
    Given a Realmroot User is operating a personal project
    When the user creates an Identity with a username and supported runtime
    Then AMA creates one managed Vault and one Realmroot Agent installation
    And verifies the remote Agent before marking the Identity active
    And exposes only identity resource id, provider Agent id, issuer, stable subject, username, runtime, and credential reference as its safe descriptor
    And stores complete private state only as an ama.dev/realmroot-agent-state credential
    And rejects incomplete, hand-authored, or incompatible provider state

  @identities/idempotent-resume @usecase
  Scenario: Resume failed provisioning without duplicating identity material
    Given Identity provisioning stopped after a durable checkpoint
    When the same user retries the same request with the same Idempotency-Key and fresh authority
    Then AMA resumes with the original Identity, key, Vault, and remote Agent
    And a different request using that key is rejected as an idempotency conflict

  @identities/agent-provision @usecase
  Scenario: A controlled Agent provisions another personal Agent identity
    Given an authenticated Realmroot Agent acts for its active controller in that controller's personal project
    When the Agent creates an Identity with its current Resource access token
    Then AMA delegates that exact Agent authority to Realmroot and provisions the child Identity
    And the new Identity remains owned and controlled by the same Realmroot User
    And no browser approval or User-token substitution occurs
    And AMA neither issues provider authority nor proxies provider business API traffic

  @identities/installation-identifiers @usecase
  Scenario: Generate standard Realmroot installation identifiers
    Given AMA is initializing a new Realmroot Agent installation
    When it checkpoints the Agent, host, and key identifiers
    Then each new persistent identifier is a standard UUID version 7 without a resource-type prefix
    And previously checkpointed opaque identifiers remain readable

  @identities/personal-only @api
  Scenario: Reject unsupported Identity owners
    Given an organization project or a Runner principal requests an Identity
    When AMA evaluates the create request
    Then it returns a stable organization_identity_not_supported or forbidden error
    And no Identity, Vault, key, or remote Agent is created

  @identities/lifetime-binding @usecase
  Scenario: Bind an Identity to one Agent for its lifetime
    Given an active unbound Identity
    When an Agent first selects it
    Then AMA atomically records that Agent as its permanent owner
    And another Agent cannot select it after the first Agent changes or removes Identity

  @identities/archive @api
  Scenario: Archive an unused Identity without deleting its remote Agent
    Given an active Identity is not currently selected by its bound Agent
    When the user archives the Identity
    Then AMA hides it from the default list without calling Realmroot deletion
    And an Identity currently selected by its Agent is rejected with identity_in_use

  @identities/runtime-constraint @usecase
  Scenario: Resolve Session and Trigger runtime from the selected Identity
    Given an Agent version snapshots an Identity and its immutable runtime
    When a Session or Trigger omits runtime
    Then AMA persists the Identity runtime before environment and runner checks
    And provider-bound Sessions expose their canonical AMA Session id to the runtime
    And an explicit different runtime is rejected with identity_runtime_mismatch
    And an Agent without Identity still requires an explicit runtime

  @identities/console @web
  Scenario: Create and inspect Identities without exposing private state
    Given a user opens the Identities resource pages
    When the user creates an Identity from the creation Sheet and opens its detail
    Then the list and detail show safe status, runtime, username, and binding facts
    And private state, credentials, tokens, and keys never appear
