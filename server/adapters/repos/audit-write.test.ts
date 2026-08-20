import type { AuthScope } from '@server/usecases/ports'
import { describe, expect, it, vi } from 'vitest'
import { createAuditWriteRepo } from './audit-write'

function fakeDb() {
  const values = vi.fn().mockResolvedValue(undefined)
  return {
    db: { insert: vi.fn(() => ({ values })) } as never,
    values,
  }
}

function auth(overrides: Partial<AuthScope> = {}): AuthScope {
  return {
    organization: { id: 'org_1', name: 'Org' },
    project: { id: 'project_1', name: 'Project' },
    user: { id: 'controller_1' },
    roles: [],
    permissions: [],
    ...overrides,
  }
}

describe('audit write actor attribution', () => {
  it('records a stable Realmroot act identity as an agent actor', async () => {
    const { db, values } = fakeDb()
    await createAuditWriteRepo(db).record(
      auth({ agentActor: { issuer: 'https://realmroot.example.test', subject: 'agent_1' } }),
      { action: 'agent.create', resourceType: 'agent', outcome: 'success' },
    )
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'agent',
        actorUserId: 'agent_1',
        controllerUserId: 'controller_1',
      }),
    )
  })

  it('does not classify an ordinary controller identity as an agent', async () => {
    const { db, values } = fakeDb()
    await createAuditWriteRepo(db).record(auth(), {
      action: 'agent.create',
      resourceType: 'agent',
      outcome: 'success',
    })
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'user', actorUserId: 'controller_1', controllerUserId: null }),
    )
  })
})
