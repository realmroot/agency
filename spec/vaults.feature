Feature: Vaults
  Vaults provide scoped, encrypted credential storage. Secret values are accepted
  only on create or rotate, encrypted at rest, and never returned, logged, or shown
  in events or UI. D1 stores only metadata and safe references. Sessions resolve
  credentials through references, and rotation and revocation stay auditable.

  # ── Secret reference rules (domain: pure, no D1) ──

  @vaults/secret-reference @domain
  Scenario: Build safe secret references and strip stored secret material
    Given a credential is stored through the AMA vault provider
    When the secret reference is built
    Then it derives a provider, reference name, and safe secret reference without the raw value
    And provider selection is not exposed until a concrete provider implementation exists
    And stored secret material is stripped from version metadata before it is returned

  @vaults/encryption @domain
  Scenario: Store credentials with authenticated encryption at rest
    Given the platform encryption key is configured
    When a credential value is encrypted
    Then it uses authenticated AES-GCM encryption
    And repeated encryption of the same value produces different ciphertext
    And tampered ciphertext fails authenticated decryption with a safe error
    And the plaintext value is never embedded in the stored payload

  # ── Lifecycle (usecase: business branches over fake ports) ──

  @vaults/credential-create @usecase
  Scenario: Create a credential with its first encrypted version
    Given a vault exists
    When the user creates a credential with a secret value
    Then the secret is stored and the credential is inserted with version 1 as the active version
    And an invalid secret reference or a secret-store failure surfaces a safe vault secret error

  @vaults/credential-rotate @usecase
  Scenario: Rotate a credential without breaking historical auditability
    Given a credential has an active version
    When the user rotates the credential
    Then the next version becomes active and supersedes the previous version
    And historical sessions keep safe references to the version they used

  # ── API contract (api: assembled server, real D1, redaction, tenancy) ──

  @vaults/api-crud @api
  Scenario: Manage vaults and credentials over the API without exposing secrets
    Given a signed-in user has access to a project
    When the user creates, lists, reads, updates, and archives project-scoped vaults and their credentials
    Then vault and credential responses expose only safe metadata and reference fields
    And secret values are accepted only on create or rotate and are never returned
    And credential versions are read-only snapshots created by AMA when credential secret material changes

  @vaults/api-tenancy @api
  Scenario: Scope vault credentials to organization and project
    Given two projects exist
    When one project stores a credential
    Then project-scoped vaults are isolated inside the same organization
    And organization-scoped vaults are shared across the organization through explicit scope
    And credential metadata remains scoped without exposing cross-project secret references

  # ── Web console (web: list, detail, add credential in jsdom) ──

  @vaults/console-list @web
  Scenario: Browse vaults and inspect vault detail with secrets redacted
    Given a project has vaults
    When the user opens the vaults list and a vault detail
    Then rows show display name, scope, status, and timestamps with a deliberate create action
    And credential names, versions, and usage references are visible while raw secret values are redacted
