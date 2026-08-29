Feature: Identities
  An Identity is an AMA-managed Realmroot Agent installation with an immutable
  runtime. Its private state lives only in a dedicated managed Vault.

  @identities/provision @api
  Scenario: Provision a personal Realmroot Agent identity synchronously
    Given a Realmroot User is operating a personal project
    When the user creates an Identity with a username and supported runtime
    Then AMA creates one managed Vault and one Realmroot Agent installation
    And verifies the remote Agent before marking the Identity active
    And stores complete private state only as an ama.dev/realmroot-agent-state credential

  @identities/idempotent-resume @usecase
  Scenario: Resume failed provisioning without duplicating identity material
    Given Identity provisioning stopped after a durable checkpoint
    When the same user retries the same request with the same Idempotency-Key and fresh authority
    Then AMA resumes with the original Identity, key, Vault, and remote Agent
    And a different request using that key is rejected as an idempotency conflict

  @identities/personal-only @api
  Scenario: Reject unsupported Identity owners
    Given an organization project or a non-User principal requests an Identity
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
    And an explicit different runtime is rejected with identity_runtime_mismatch
    And an Agent without Identity still requires an explicit runtime

  @identities/console @web
  Scenario: Create and inspect Identities without exposing private state
    Given a user opens the Identities resource pages
    When the user creates an Identity from the creation Sheet and opens its detail
    Then the list and detail show safe status, runtime, username, and binding facts
    And private state, credentials, tokens, and keys never appear
