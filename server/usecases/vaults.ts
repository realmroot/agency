import type {
  Credential,
  CredentialType,
  CredentialVersion,
  SecretMaterial,
  Vault,
  VaultScope,
} from '@server/domain/vault'
import { secretReference } from '@server/domain/vault'
import type { Deps } from './deps'
import { VaultSecretError } from './ports'

// Merges the safe reference metadata with the stored secret metadata
// (ciphertext) the gateway returned.
function versionMetadata(
  reference: { metadata: Record<string, unknown> },
  stored: Record<string, unknown> | undefined,
) {
  return { ...reference.metadata, ...(stored ?? {}) }
}

export interface CreateCredentialInputDto {
  name: string
  type: CredentialType
  metadata: Record<string, unknown>
  secret: SecretMaterial
}

export interface CreateCredentialResult {
  credential: Credential
  version: CredentialVersion
}

// Creates a credential and its first version: builds the safe reference, stores
// the secret material through the gateway, and inserts both rows atomically.
// Throws VaultSecretError on invalid material or storage failure.
export async function createCredential(
  deps: Deps,
  vault: Vault,
  input: CreateCredentialInputDto,
): Promise<CreateCredentialResult> {
  const timestamp = new Date().toISOString()
  const credentialId = newId('vaultcred')
  const versionId = newId('vaultver')
  let reference: ReturnType<typeof secretReference>
  try {
    reference = secretReference({ vaultId: vault.metadata.uid, credentialId, versionId }, 1, input.type, input.secret)
  } catch (error) {
    throw secretError(error)
  }
  let stored: Record<string, unknown> | undefined
  try {
    stored = await deps.secretStore.store(reference, input.secret)
  } catch (error) {
    throw secretError(error)
  }
  return await deps.vaults.insertCredentialWithVersion(
    {
      vaultId: vault.metadata.uid,
      organizationId: vault.spec.organizationId,
      projectId: vault.metadata.pid,
      name: input.name,
      type: input.type,
      metadata: input.metadata,
    },
    {
      id: versionId,
      credentialId,
      vaultId: vault.metadata.uid,
      organizationId: vault.spec.organizationId,
      projectId: vault.metadata.pid,
      version: 1,
      reference,
      metadata: versionMetadata(reference, stored),
    },
    timestamp,
  )
}

// Rotates a credential by creating a new active version and superseding the
// previous one. Throws VaultSecretError on invalid material or storage failure.
export async function rotateCredential(
  deps: Deps,
  credential: Credential,
  secret: SecretMaterial,
): Promise<{ credential: Credential; version: CredentialVersion }> {
  const timestamp = new Date().toISOString()
  let reference: ReturnType<typeof secretReference>
  let stored: Record<string, unknown> | undefined
  let nextVersion: number
  const versionId = newId('vaultver')
  try {
    nextVersion = (await deps.vaults.latestVersionNumber(credential.metadata.uid)) + 1
    reference = secretReference(
      { vaultId: credential.spec.vaultId, credentialId: credential.metadata.uid, versionId },
      nextVersion,
      credential.spec.type,
      secret,
    )
    stored = await deps.secretStore.store(reference, secret)
  } catch (error) {
    throw secretError(error)
  }
  const version = await deps.vaults.insertVersionRotation(
    {
      id: versionId,
      credentialId: credential.metadata.uid,
      vaultId: credential.spec.vaultId,
      organizationId: credential.spec.organizationId,
      projectId: credential.metadata.pid,
      version: nextVersion,
      reference,
      metadata: versionMetadata(reference, stored),
    },
    credential.status.activeVersionId,
    timestamp,
  )
  return {
    credential: {
      ...credential,
      metadata: { ...credential.metadata, updatedAt: timestamp },
      status: { ...credential.status, activeVersionId: version.metadata.uid },
    },
    version,
  }
}

function secretError(error: unknown) {
  return new VaultSecretError(error instanceof Error ? error.message : 'Invalid secret reference')
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

export type { VaultScope }
