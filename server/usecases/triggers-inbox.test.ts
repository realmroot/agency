import type { Agent } from '@server/domain/agent'
import { resourceMetadata } from '@server/domain/resource'
import type { Trigger } from '@server/domain/trigger'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import type { AuthScope, InboxProvisioningFields } from './ports'

vi.mock('./inbox-subscriptions', () => ({
  initialInboxProvisioning: vi.fn(),
  reconcileInboxSubscription: vi.fn(),
  removeInboxSubscription: vi.fn(),
}))

import { initialInboxProvisioning, reconcileInboxSubscription, removeInboxSubscription } from './inbox-subscriptions'
import { createTrigger, deleteTrigger, updateTrigger } from './triggers'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

const provisioning = {
  subscriptionId: 'sub_0123456789abcdef0123456789abcdef',
  callbackTokenHash: 'token-hash',
  callbackTokenCiphertext: 'token-ciphertext',
  etag: null,
  registeredAgentSubject: null,
  transitionTargetSubject: null,
  phase: 'pending',
  errorMessage: null,
} as const satisfies InboxProvisioningFields

function agent(bound: boolean): Agent {
  return {
    metadata: resourceMetadata({
      uid: 'agent_1',
      pid: 'project_1',
      name: 'Agent',
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    }),
    spec: {
      systemPrompt: 'Work.',
      provider: null,
      model: null,
      skills: [],
      subagents: [],
      allowedTools: [],
      mcpConnectors: [],
      identity: bound
        ? {
            identityId: 'identity_1',
            agentId: '019ff41a-7da6-708f-8b05-49a4cc6d5300',
            issuer: 'https://id.realmroot.dev/api/auth',
            subject: '019ff41a-7da6-708f-8b05-49a4cc6d5300',
            username: 'agent',
            runtime: 'ama',
            credentialRef: 'ama://vaults/vault_1/credentials/credential_1',
          }
        : null,
    },
    status: { phase: 'active', currentVersionId: 'agentver_1', version: 1 },
  }
}

function record(source: Trigger['spec']['source'] = { type: 'inbox' }): Trigger {
  const timestamp = '2026-08-30T00:00:00.000Z'
  return {
    metadata: resourceMetadata({
      uid: 'trigger_1',
      pid: 'project_1',
      name: 'Inbox trigger',
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    spec: {
      source,
      suspend: false,
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: 'agent_1',
          environmentId: null,
          runtime: 'ama',
          promptTemplate: 'Triage it.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
    },
    status: {
      phase: 'active',
      nextDueAt: source.type === 'schedule' ? '2026-08-30T01:00:00.000Z' : null,
      lastDispatchedAt: null,
      lastRunId: null,
      subscription:
        source.type === 'inbox' ? { id: provisioning.subscriptionId, phase: 'active', errorMessage: null } : null,
    },
  }
}

function deps(bound = true) {
  let current = record()
  const insert = vi.fn(async (input) => {
    current = {
      ...record(input.config.source),
      spec: { ...record(input.config.source).spec, template: input.config.template, suspend: input.config.suspend },
    }
    return current
  })
  const update = vi.fn(async (_projectId, _triggerId, fields) => {
    current = {
      ...current,
      metadata: { ...current.metadata, archivedAt: fields.archivedAt },
      spec: { source: fields.config.source, suspend: fields.config.suspend, template: fields.config.template },
      status: { ...current.status, nextDueAt: fields.config.nextDueAt },
    }
    return current
  })
  return {
    agents: { find: vi.fn(async () => agent(bound)) },
    triggers: {
      agentUsable: vi.fn(async () => null),
      environmentUsable: vi.fn(async () => null),
      insert,
      update,
      find: vi.fn(async () => current),
      delete: vi.fn(async () => true),
    },
  } as unknown as Deps
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(initialInboxProvisioning).mockResolvedValue({ token: 'callback-token', fields: provisioning })
  vi.mocked(reconcileInboxSubscription).mockImplementation(async (_deps, trigger) => trigger)
  vi.mocked(removeInboxSubscription).mockResolvedValue()
})

describe('[spec: triggers/inbox-provisioning] Trigger orchestration', () => {
  it('requires a Realmroot-bound Agent for Inbox creation and updates', async () => {
    const config = {
      name: 'Inbox trigger',
      source: { type: 'inbox' as const },
      suspend: false,
      template: record().spec.template,
      nextDueAt: null,
    }
    await expect(createTrigger(deps(false), auth, { config })).rejects.toThrow(/Realmroot-bound Agent/)
    await expect(
      updateTrigger(deps(false), auth, record({ type: 'http' }), { source: { type: 'inbox' } }),
    ).rejects.toThrow(/Realmroot-bound Agent/)
  })

  it('creates and reconciles one Inbox Subscription with the initial token', async () => {
    const fake = deps()
    const created = await createTrigger(fake, auth, {
      config: {
        name: 'Inbox trigger',
        source: { type: 'inbox' },
        suspend: false,
        template: record().spec.template,
        nextDueAt: null,
      },
    })
    expect(initialInboxProvisioning).toHaveBeenCalledWith(fake)
    expect(fake.triggers.insert).toHaveBeenCalledWith(
      expect.objectContaining({ inboxProvisioning: provisioning }),
      expect.any(String),
    )
    expect(reconcileInboxSubscription).toHaveBeenCalledWith(fake, created, 'callback-token')
  })

  it('enters, maintains, and leaves Inbox lifecycle through updates', async () => {
    const enteringDeps = deps()
    const entered = await updateTrigger(enteringDeps, auth, record({ type: 'http' }), { source: { type: 'inbox' } })
    expect(enteringDeps.triggers.update).toHaveBeenCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({ inboxProvisioning: provisioning }),
      expect.any(String),
    )
    expect(reconcileInboxSubscription).toHaveBeenCalledWith(enteringDeps, entered.trigger, 'callback-token')

    vi.clearAllMocks()
    const existingDeps = deps()
    await updateTrigger(existingDeps, auth, record(), { name: 'Renamed' })
    expect(initialInboxProvisioning).not.toHaveBeenCalled()
    expect(reconcileInboxSubscription).toHaveBeenCalledWith(existingDeps, expect.anything(), undefined)

    vi.clearAllMocks()
    const leavingDeps = deps()
    await updateTrigger(leavingDeps, auth, record(), { source: { type: 'http' } })
    expect(removeInboxSubscription).toHaveBeenCalledWith(
      leavingDeps,
      expect.objectContaining({ metadata: expect.anything() }),
    )
    expect(leavingDeps.triggers.update).toHaveBeenCalledWith(
      'project_1',
      'trigger_1',
      expect.objectContaining({ inboxProvisioning: null }),
      expect.any(String),
    )
  })

  it('rejects Inbox schedule timing and preserves Inbox source without an explicit source patch', async () => {
    await expect(
      updateTrigger(deps(), auth, record(), { source: { type: 'inbox' }, nextDueAt: '2026-08-30T01:00:00.000Z' }),
    ).rejects.toThrow(/schedule/)
    const result = await updateTrigger(deps(), auth, record(), { suspend: true })
    expect(result.trigger.spec.source).toEqual({ type: 'inbox' })
    expect(result.trigger.status.nextDueAt).toBeNull()
  })

  it('removes the remote Subscription before deleting an Inbox Trigger', async () => {
    const fake = deps()
    await expect(deleteTrigger(fake, auth, 'trigger_1')).resolves.toBe(true)
    expect(removeInboxSubscription).toHaveBeenCalledWith(fake, expect.objectContaining({ metadata: expect.anything() }))
    expect(fake.triggers.delete).toHaveBeenCalledWith('project_1', 'trigger_1')
  })
})
