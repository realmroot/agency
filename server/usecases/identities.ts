import type { Identity, IdentityCheckpoint } from '@server/domain/identity'
import type { RuntimeName } from '@server/domain/runtime-catalog'
import { newPrimaryKey } from '@server/id'
import type { Deps } from './deps'
import type { AuthScope, RealmrootManagementCredential } from './ports'
import { createCredential } from './vaults'

type IdentityCredentialPurpose = 'provisioning-checkpoint' | 'enrolled-checkpoint' | 'agent-state'

function identityDeps(deps: Deps) {
  if (!deps.identities || !deps.realmrootEnrollment || !deps.realmrootManagement)
    throw new Error('Identity dependencies are not configured')
  return { identities: deps.identities, enrollment: deps.realmrootEnrollment, management: deps.realmrootManagement }
}

export class IdentityConflictError extends Error {
  constructor(
    readonly code:
      | 'idempotency_conflict'
      | 'identity_in_use'
      | 'identity_provisioning_in_progress'
      | 'organization_identity_not_supported',
    message: string,
  ) {
    super(message)
    this.name = 'IdentityConflictError'
  }
}

export class IdentityProvisioningError extends Error {
  constructor(
    readonly code: string,
    message = 'Identity provisioning failed. Retry with the same Idempotency-Key after renewing authorization.',
  ) {
    super(message)
    this.name = 'IdentityProvisioningError'
  }
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function realmrootOrigin(issuer: string) {
  if (!issuer) throw new Error('Realmroot issuer is unavailable')
  return new URL(issuer).origin
}

async function findIdentityCredential(
  deps: Deps,
  vaultId: string,
  identityId: string,
  purpose: IdentityCredentialPurpose,
) {
  if (!deps.vaults.findIdentityCredential) throw new Error('Identity managed Credential access is unavailable')
  return await deps.vaults.findIdentityCredential(vaultId, identityId, purpose)
}

async function findOrCreateIdentityCredential(
  deps: Deps,
  vault: Parameters<typeof createCredential>[1],
  identityId: string,
  purpose: IdentityCredentialPurpose,
  input: Omit<Parameters<typeof createCredential>[2], 'credentialId' | 'versionId' | 'metadata'> & {
    metadata?: Record<string, unknown>
  },
) {
  const existing = await findIdentityCredential(deps, vault.metadata.uid, identityId, purpose)
  if (existing) return existing
  try {
    return (
      await createCredential(deps, vault, {
        ...input,
        metadata: { ...input.metadata, managedBy: 'identity', identityId, purpose },
      })
    ).credential
  } catch (error) {
    const concurrent = await findIdentityCredential(deps, vault.metadata.uid, identityId, purpose)
    if (concurrent) return concurrent
    throw error
  }
}

async function checkpointFromVault(deps: Deps, auth: AuthScope, identityId: string) {
  const provisioning = await identityDeps(deps).identities.provisioning(identityId)
  if (!provisioning?.credentialId) return null
  const manifest = await deps.runtimeSecrets.resolveWorkspaceManifest(
    { organizationId: auth.organization.id, projectId: auth.project.id },
    [
      {
        name: 'identity-checkpoint',
        type: 'secret',
        secretRef: `ama://vaults/${provisioning.vaultId}/credentials/${provisioning.credentialId}`,
        items: [{ key: 'state.json', path: 'state.json' }],
      },
    ],
    [{ name: 'identity-checkpoint', mountPath: '/identity', readOnly: true }],
  )
  const mount = manifest.mounts[0]
  const content = mount?.type === 'secret' ? mount.files[0]?.content : null
  if (!content) throw new Error('Identity checkpoint is unavailable')
  return JSON.parse(content) as IdentityCheckpoint
}

async function saveCheckpoint(
  deps: Deps,
  auth: AuthScope,
  owner: string,
  identityId: string,
  checkpoint: IdentityCheckpoint,
) {
  const provisioning = await identityDeps(deps).identities.provisioning(identityId)
  if (!provisioning?.credentialId) throw new Error('Identity checkpoint credential is unavailable')
  if (!deps.vaults.findIdentityManaged) throw new Error('Identity managed Vault access is unavailable')
  const vault = await deps.vaults.findIdentityManaged(provisioning.vaultId, {
    organizationId: auth.organization.id,
    projectId: auth.project.id,
  })
  if (!vault) throw new Error('Identity managed Vault is unavailable')
  const credential = await findOrCreateIdentityCredential(deps, vault, identityId, 'enrolled-checkpoint', {
    name: 'Identity enrolled checkpoint',
    type: 'opaque',
    secret: { stringData: { 'state.json': JSON.stringify(checkpoint) } },
  })
  await identityDeps(deps).identities.setCredential(
    identityId,
    owner,
    credential.metadata.uid,
    new Date().toISOString(),
  )
}

export async function createIdentity(
  deps: Deps,
  auth: AuthScope,
  input: {
    name: string
    description: string | null
    username: string
    runtime: RuntimeName
    idempotencyKey: string
    subjectToken: string
  },
): Promise<Identity> {
  if (auth.organization.id !== `user:${auth.user.id}`) {
    throw new IdentityConflictError(
      'organization_identity_not_supported',
      'Organization-owned Identities are not supported.',
    )
  }
  if (auth.oidc?.runnerId)
    throw new IdentityProvisioningError(
      'user_principal_required',
      'Only a Realmroot User or an Agent acting for its controller can create an Identity.',
    )
  const keyHash = await digest(input.idempotencyKey)
  const fingerprint = await digest(
    JSON.stringify({
      name: input.name,
      description: input.description,
      username: input.username,
      runtime: input.runtime,
    }),
  )
  const configured = identityDeps(deps)
  const identityId = newPrimaryKey()
  const timestamp = new Date()
  const owner = `provisioning_${crypto.randomUUID().replaceAll('-', '')}`
  const claim = await configured.identities.claim(
    {
      id: identityId,
      projectId: auth.project.id,
      organizationId: auth.organization.id,
      name: input.name,
      description: input.description,
      username: input.username,
      runtime: input.runtime,
      vaultId: newPrimaryKey(),
      idempotencyKeyHash: keyHash,
      requestFingerprint: fingerprint,
    },
    owner,
    timestamp.toISOString(),
    new Date(timestamp.getTime() + 5 * 60_000).toISOString(),
  )
  if (claim.requestFingerprint !== fingerprint) {
    throw new IdentityConflictError(
      'idempotency_conflict',
      'Idempotency-Key was already used for a different Identity request.',
    )
  }
  const identity = claim.identity
  if (identity.metadata.deletedAt) {
    throw new IdentityConflictError('idempotency_conflict', 'Idempotency-Key belongs to a deleted Identity.')
  }
  if (identity.status.state === 'active') return identity
  if (!claim.acquired) {
    throw new IdentityConflictError(
      'identity_provisioning_in_progress',
      'Identity provisioning is already in progress for this Idempotency-Key.',
    )
  }

  let checkpoint: IdentityCheckpoint | null = null
  const visibility = { organizationId: auth.organization.id, projectId: auth.project.id }
  try {
    const location = await configured.identities.provisioning(identity.metadata.uid)
    if (!location || !deps.vaults.findIdentityManaged) throw new Error('Identity managed Vault is unavailable')
    let vault = await deps.vaults.findIdentityManaged(location.vaultId, visibility)
    if (!vault) {
      vault = await deps.vaults.insert(
        {
          id: location.vaultId,
          organizationId: auth.organization.id,
          projectId: auth.project.id,
          name: `Identity · ${input.name}`,
          description: 'AMA-managed Realmroot Agent installation state.',
          scope: 'project',
          managedBy: 'identity',
        },
        timestamp.toISOString(),
      )
    }
    if (!location.credentialId) {
      const recovered = await findIdentityCredential(
        deps,
        location.vaultId,
        identity.metadata.uid,
        'provisioning-checkpoint',
      )
      if (recovered) {
        await configured.identities.setCredential(
          identity.metadata.uid,
          owner,
          recovered.metadata.uid,
          new Date().toISOString(),
        )
      }
    }
    checkpoint = await checkpointFromVault(deps, auth, identity.metadata.uid)
    if (!checkpoint) {
      checkpoint = await configured.enrollment.initialize({
        origin: realmrootOrigin(auth.oidc?.issuer ?? ''),
        username: input.username,
        name: input.name,
        runtime: input.runtime,
        idempotencyKey: input.idempotencyKey,
      })
      const credential = await findOrCreateIdentityCredential(
        deps,
        vault,
        identity.metadata.uid,
        'provisioning-checkpoint',
        {
          name: 'Identity provisioning checkpoint',
          type: 'opaque',
          secret: { stringData: { 'state.json': JSON.stringify(checkpoint) } },
        },
      )
      await configured.identities.setCredential(
        identity.metadata.uid,
        owner,
        credential.metadata.uid,
        new Date().toISOString(),
      )
    }
  } catch {
    await configured.identities.fail(
      identity.metadata.uid,
      owner,
      'identity_initialization_failed',
      new Date().toISOString(),
    )
    throw new IdentityProvisioningError('identity_initialization_failed')
  }

  if (!checkpoint) throw new IdentityProvisioningError('identity_checkpoint_missing')
  let managementCredential: RealmrootManagementCredential
  try {
    managementCredential = await configured.management.exchange({
      subjectToken: input.subjectToken,
      subject: auth.user.id,
    })
  } catch {
    await configured.identities.fail(
      identity.metadata.uid,
      owner,
      'realmroot_authorization_failed',
      new Date().toISOString(),
    )
    throw new IdentityProvisioningError('realmroot_authorization_failed')
  }
  try {
    const origin = realmrootOrigin(auth.oidc?.issuer ?? '')
    const provisioned = await configured.enrollment.provision({
      origin,
      username: input.username,
      name: input.name,
      runtime: input.runtime,
      idempotencyKey: input.idempotencyKey,
      checkpoint,
      managementCredential,
      onCheckpoint: (next) => saveCheckpoint(deps, auth, owner, identity.metadata.uid, next),
    })
    const location = await configured.identities.provisioning(identity.metadata.uid)
    if (!location?.credentialId) throw new Error('Identity checkpoint credential is unavailable')
    if (!deps.vaults.findIdentityManaged) throw new Error('Identity managed Vault access is unavailable')
    const vault = await deps.vaults.findIdentityManaged(location.vaultId, {
      organizationId: auth.organization.id,
      projectId: auth.project.id,
    })
    if (!vault) throw new Error('Identity managed Vault is unavailable')
    const finalStateCredential = await findOrCreateIdentityCredential(
      deps,
      vault,
      identity.metadata.uid,
      'agent-state',
      {
        name: 'Realmroot Agent state',
        type: 'ama.dev/realmroot-agent-state',
        secret: { stringData: { 'state.json': JSON.stringify(provisioned.checkpoint.state) } },
      },
    )
    return await configured.identities.activate(
      identity.metadata.uid,
      owner,
      finalStateCredential.metadata.uid,
      {
        ...provisioned.descriptor,
        identityId: identity.metadata.uid,
        credentialRef: `ama://vaults/${location.vaultId}/credentials/${finalStateCredential.metadata.uid}`,
      },
      new Date().toISOString(),
    )
  } catch {
    await configured.identities.fail(
      identity.metadata.uid,
      owner,
      'realmroot_provisioning_failed',
      new Date().toISOString(),
    )
    throw new IdentityProvisioningError('realmroot_provisioning_failed')
  }
}

export async function deleteIdentity(deps: Deps, auth: AuthScope, identity: Identity) {
  const deleted = await identityDeps(deps).identities.delete(
    auth.project.id,
    identity.metadata.uid,
    new Date().toISOString(),
  )
  if (!deleted) {
    throw new IdentityConflictError(
      'identity_in_use',
      'Identity is currently selected by an Agent or provisioning is still in progress.',
    )
  }
}
