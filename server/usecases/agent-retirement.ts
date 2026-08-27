import type { Agent } from '@server/domain/agent'
import { secretRefIdentity } from '@server/domain/vault'
import type { WorkspaceManifestMount } from '@server/domain/workspace'
import type { Deps } from './deps'
import type { AuthScope, RealmrootManagementCredential } from './ports'
import { closeSession } from './runtime/session-lifecycle'

async function identityRecordId(deps: Deps, auth: AuthScope, agent: Agent) {
  const reference = secretRefIdentity(agent.identity.credentialRef)
  if (!reference?.credentialId) throw new Error('Agent identity Vault reference is unavailable')
  const manifest = await deps.runtimeSecrets.resolveWorkspaceManifest(
    { organizationId: auth.organization.id, projectId: auth.project.id },
    [
      {
        name: 'identity-state',
        type: 'secret',
        secretRef: agent.identity.credentialRef,
        items: [{ key: 'state.json', path: 'state.json' }],
      },
    ],
    [{ name: 'identity-state', mountPath: '/workspace/.ama/retirement', readOnly: true }],
  )
  const mount = manifest.mounts.find(
    (item): item is Extract<WorkspaceManifestMount, { type: 'secret' }> => item.type === 'secret',
  )
  const content = mount?.files.find((file) => file.path === 'state.json')?.content
  if (!content) throw new Error('Agent identity Vault state is unavailable')
  const state = JSON.parse(content) as { identity?: { id?: unknown } }
  if (typeof state.identity?.id !== 'string' || !state.identity.id)
    throw new Error('Realmroot identity record ID is unavailable')
  return { identityId: state.identity.id, vaultId: reference.vaultId, credentialId: reference.credentialId }
}

async function cleanup(deps: Deps, agent: Agent) {
  const reference = secretRefIdentity(agent.identity.credentialRef)
  if (!reference?.credentialId) throw new Error('Agent identity Vault reference is unavailable')
  await deps.vaults.destroyManagedVault(reference.vaultId, reference.credentialId)
  await deps.agents.markRetirement(agent.metadata.pid ?? '', agent.metadata.uid, 'retired', new Date().toISOString())
}

export async function retireAgent(
  deps: Deps,
  auth: AuthScope,
  agent: Agent,
  authority?: RealmrootManagementCredential,
) {
  if (agent.status.phase === 'retired') return
  if (agent.status.phase !== 'retiring') {
    await deps.agents.markRetirement(auth.project.id, agent.metadata.uid, 'stopping', new Date().toISOString())
  }
  const sessions = await deps.sessionOrchestration.activeSessionsForAgent(auth.project.id, agent.metadata.uid)
  for (const session of sessions) {
    const result = await closeSession(deps, auth, session.id, null, 'agent_retired')
    if (!result.ok) throw new Error(`Session ${session.id} could not be ended: ${result.error.message}`)
  }
  if (agent.status.retirementStage !== 'identity_retired') {
    const identity = await identityRecordId(deps, auth, agent)
    if (!authority || !deps.realmrootEnrollment) throw new Error('Realmroot Agent retirement authority is unavailable')
    await deps.realmrootEnrollment.retire({
      issuer: agent.identity.issuer,
      identityId: identity.identityId,
      managementCredential: authority,
    })
    await deps.agents.markRetirement(auth.project.id, agent.metadata.uid, 'identity_retired', new Date().toISOString())
  }
  await cleanup(deps, agent)
}

export async function reconcileRetiredAgentCleanup(deps: Deps) {
  for (const agent of await deps.agents.retiring(25)) {
    if (agent.status.retirementStage !== 'identity_retired') continue
    const project = agent.metadata.pid ? await deps.projects.tenant(agent.metadata.pid) : null
    if (!project) continue
    await retireAgent(
      deps,
      {
        organization: { id: project.organizationId, name: project.organizationId },
        project: { id: project.id, name: project.name, organizationId: project.organizationId },
        user: { id: 'ama-system' },
        roles: ['system'],
        permissions: ['agents:write', 'sessions:write', 'vaults:write'],
        oidc: { issuer: agent.identity.issuer },
      },
      agent,
    )
  }
}
