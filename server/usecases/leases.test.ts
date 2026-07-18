import type { WorkspaceManifest } from '@server/domain/workspace'
import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { claimLease, materializeWorkItemPayload } from './leases'
import {
  type AuthScope,
  type LeaseRecord,
  type RunnerAuthRecord,
  RunnerConflictError,
  type WorkItemClaimCandidate,
  type WorkItemRecord,
} from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

const RUNTIME_REQUIREMENT = { runtime: 'claude-code', model: 'claude-opus-4' }
const scope = { organizationId: 'org_1', projectId: 'project_1' }

function runner(overrides: Partial<RunnerAuthRecord> = {}): RunnerAuthRecord {
  return {
    id: 'runner_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Runner',
    environmentId: null,
    secretRef: null,
    authMode: 'oidc',
    state: 'active',
    currentLoad: 0,
    maxConcurrent: 2,
    runtimeUsage: [],
    runtimes: [{ runtime: 'claude-code', models: ['claude-opus-4'], state: 'ready' }],
    metadata: {},
    oidcSubject: 'sub_1',
    oidcClientId: 'cid',
    lastHeartbeatAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

const lease: LeaseRecord = {
  id: 'lease_1',
  workItemId: 'work_1',
  runnerId: 'runner_1',
  state: 'active',
  expiresAt: '2999-01-01T00:00:00.000Z',
  renewedAt: null,
  resumeToken: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function candidate(overrides: Partial<WorkItemClaimCandidate> = {}): WorkItemClaimCandidate {
  return {
    state: 'available',
    availableAt: '2026-01-01T00:00:00.000Z',
    environmentId: null,
    sessionId: 'session_1',
    rawPayload: { type: 'session.start', runtimeRequirement: RUNTIME_REQUIREMENT },
    ...overrides,
  }
}

function fakeDeps(overrides: {
  leases?: Partial<Deps['leases']>
  workItems?: Partial<Deps['workItems']>
  resolveEnv?: Deps['runtimeSecrets']['resolveEnv']
  resolveWorkspaceManifest?: Deps['runtimeSecrets']['resolveWorkspaceManifest']
}): Deps {
  const leases: Deps['leases'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => lease,
    claimCandidate: async () => candidate(),
    expireStale: async () => {},
    claim: async () => ({ lease, sessionId: 'session_1' }),
    failClaim: async () => {},
    finish: async () => lease,
    prepareSessionChannel: async () => ({ ok: false, status: 409, message: 'n/a' }),
    rollbackSessionChannel: async () => {},
    ...overrides.leases,
  }
  const workItems: Deps['workItems'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    rawPayload: async () => ({ type: 'session.start' }),
    activeLeaseRunnerId: async () => null,
    ...overrides.workItems,
  }
  const runtimeSecrets: Deps['runtimeSecrets'] = {
    resolveEnv: overrides.resolveEnv ?? (async () => ({})),
    resolveWorkspaceManifest: overrides.resolveWorkspaceManifest ?? (async () => ({ root: '/workspace', mounts: [] })),
  }
  return { leases, workItems, runtimeSecrets } as unknown as Deps
}

describe('[spec: runners/claim-eligibility] claimLease', () => {
  it('claims an eligible available work item', async () => {
    const result = await claimLease(fakeDeps({}), auth, runner(), { workItemId: 'work_1', leaseDurationSeconds: 60 })
    expect(result.id).toBe('lease_1')
  })

  it('rejects an inactive runner', async () => {
    await expect(
      claimLease(fakeDeps({}), auth, runner({ state: 'draining' }), { workItemId: 'work_1', leaseDurationSeconds: 60 }),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })

  it('404s when the work item is missing', async () => {
    const error = await claimLease(fakeDeps({ leases: { claimCandidate: async () => null } }), auth, runner(), {
      workItemId: 'work_missing',
      leaseDurationSeconds: undefined,
    }).catch((e) => e)
    expect(error).toBeInstanceOf(RunnerConflictError)
    expect((error as RunnerConflictError).status).toBe(404)
  })

  it('conflicts when the runner does not report the required runtime', async () => {
    await expect(
      claimLease(fakeDeps({}), auth, runner({ runtimes: [] }), {
        workItemId: 'work_1',
        leaseDurationSeconds: 60,
      }),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })

  it('maps the at-capacity claim race to a conflict', async () => {
    await expect(
      claimLease(fakeDeps({ leases: { claim: async () => 'at_capacity' } }), auth, runner(), {
        workItemId: 'work_1',
        leaseDurationSeconds: 60,
      }),
    ).rejects.toThrow('Runner is at capacity')
  })

  it('maps the lost work-item race to a conflict', async () => {
    await expect(
      claimLease(fakeDeps({ leases: { claim: async () => 'work_item_lost' } }), auth, runner(), {
        workItemId: 'work_1',
        leaseDurationSeconds: 60,
      }),
    ).rejects.toThrow('claimed by another runner')
  })

  it('fails the claim when claim-time secret resolution fails', async () => {
    const failClaim = vi.fn(async () => {})
    await expect(
      claimLease(
        fakeDeps({
          leases: {
            claimCandidate: async () =>
              candidate({
                rawPayload: { type: 'session.start', runtimeRequirement: RUNTIME_REQUIREMENT, envFrom: [{}] },
              }),
            failClaim,
          },
          resolveEnv: async () => {
            throw new Error('credential revoked')
          },
        }),
        auth,
        runner(),
        { workItemId: 'work_1', leaseDurationSeconds: 60 },
      ),
    ).rejects.toThrow('credential revoked')
    expect(failClaim).toHaveBeenCalledOnce()
  })

  it('validates workspace references at claim time even without envFrom entries', async () => {
    const resolveWorkspaceManifest = vi.fn(async () => ({ root: '/workspace', mounts: [] }) satisfies WorkspaceManifest)
    await claimLease(
      fakeDeps({
        leases: {
          claimCandidate: async () =>
            candidate({
              rawPayload: {
                type: 'session.start',
                runtimeRequirement: RUNTIME_REQUIREMENT,
                volumes: [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' }],
              },
            }),
        },
        resolveWorkspaceManifest,
      }),
      auth,
      runner(),
      { workItemId: 'work_1', leaseDurationSeconds: 60 },
    )
    expect(resolveWorkspaceManifest).toHaveBeenCalledWith(
      scope,
      [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' }],
      [],
    )
  })

  it('validates workspace mounts at claim time without volume definitions', async () => {
    const resolveWorkspaceManifest = vi.fn(async () => ({ root: '/workspace', mounts: [] }) satisfies WorkspaceManifest)
    await claimLease(
      fakeDeps({
        leases: {
          claimCandidate: async () =>
            candidate({
              rawPayload: {
                type: 'session.start',
                runtimeRequirement: RUNTIME_REQUIREMENT,
                volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }],
              },
            }),
        },
        resolveWorkspaceManifest,
      }),
      auth,
      runner(),
      { workItemId: 'work_1', leaseDurationSeconds: 60 },
    )
    expect(resolveWorkspaceManifest).toHaveBeenCalledWith(scope, [], [{ name: 'workspace', mountPath: '/workspace' }])
  })

  it('uses the default lease duration when leaseDurationSeconds is not provided', async () => {
    const claims: Array<{ leaseDurationSeconds: number }> = []
    const deps = fakeDeps({
      leases: {
        claim: async (input) => {
          claims.push(input as { leaseDurationSeconds: number })
          return { lease, sessionId: 'session_1' }
        },
      },
    })
    await claimLease(deps, auth, runner(), { workItemId: 'work_1', leaseDurationSeconds: undefined })
    expect(claims[0]?.leaseDurationSeconds).toBe(60)
  })

  it('conflicts when the work item is not yet available (availableAt in the future)', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    await expect(
      claimLease(
        fakeDeps({ leases: { claimCandidate: async () => candidate({ availableAt: future }) } }),
        auth,
        runner(),
        { workItemId: 'work_1', leaseDurationSeconds: 60 },
      ),
    ).rejects.toThrow('Work item is not available')
  })

  it('conflicts when the work item is in a non-available state', async () => {
    await expect(
      claimLease(
        fakeDeps({ leases: { claimCandidate: async () => candidate({ state: 'claimed' }) } }),
        auth,
        runner(),
        { workItemId: 'work_1', leaseDurationSeconds: 60 },
      ),
    ).rejects.toThrow('Work item is not available')
  })

  it('conflicts when the runner environment does not match the work item environment', async () => {
    await expect(
      claimLease(
        fakeDeps({
          leases: {
            claimCandidate: async () => candidate({ environmentId: 'env_other' }),
          },
        }),
        auth,
        runner({ environmentId: 'env_mine' }),
        { workItemId: 'work_1', leaseDurationSeconds: 60 },
      ),
    ).rejects.toThrow('Runner is not eligible for this work item')
  })

  it('conflicts when the runner has no ready entry for the required runtime', async () => {
    await expect(
      claimLease(
        fakeDeps({}),
        auth,
        runner({
          runtimes: [{ runtime: 'node', models: [], state: 'ready' }],
        }),
        { workItemId: 'work_1', leaseDurationSeconds: 60 },
      ),
    ).rejects.toThrow('Runner is not eligible for this work item')
  })

  it('uses a non-Error message when claim-time secret resolution fails with a non-Error throw', async () => {
    const failClaim = vi.fn(async () => {})
    await expect(
      claimLease(
        fakeDeps({
          leases: {
            claimCandidate: async () =>
              candidate({
                rawPayload: { type: 'session.start', runtimeRequirement: RUNTIME_REQUIREMENT, envFrom: [{}] },
              }),
            failClaim,
          },
          resolveEnv: async () => {
            throw 'string error'
          },
        }),
        auth,
        runner(),
        { workItemId: 'work_1', leaseDurationSeconds: 60 },
      ),
    ).rejects.toThrow('Runner secret resolution failed')
    expect(failClaim).toHaveBeenCalledOnce()
  })
})

describe('materializeWorkItemPayload', () => {
  it('passes through a non-session-start payload unchanged', async () => {
    const deps = fakeDeps({ workItems: { rawPayload: async () => ({ type: 'maintenance', foo: 1 }) } })
    const payload = await materializeWorkItemPayload(deps, scope, { id: 'work_1' } as WorkItemRecord)
    expect(payload).toEqual({ type: 'maintenance', foo: 1 })
  })

  it('returns an empty object when rawPayload returns null', async () => {
    const deps = fakeDeps({ workItems: { rawPayload: async () => null } })
    const payload = await materializeWorkItemPayload(deps, scope, { id: 'work_1' } as WorkItemRecord)
    expect(payload).toEqual({})
  })

  it('strips declared secret fields from a session-start payload when no refs are present', async () => {
    const deps = fakeDeps({
      workItems: {
        rawPayload: async () => ({ type: 'session.start', envFrom: [], volumes: [], volumeMounts: [] }),
      },
    })
    const payload = await materializeWorkItemPayload(deps, scope, { id: 'work_1' } as WorkItemRecord)
    expect(payload).toEqual({ type: 'session.start' })
  })

  it('treats non-array envFrom as empty and strips it from the runtime payload', async () => {
    const deps = fakeDeps({
      workItems: {
        rawPayload: async () => ({ type: 'session.start', envFrom: 'not-an-array' }),
      },
    })
    const payload = await materializeWorkItemPayload(deps, scope, { id: 'work_1' } as WorkItemRecord)
    expect(payload).toEqual({ type: 'session.start' })
  })

  it('resolves envFrom into env for session starts', async () => {
    const deps = fakeDeps({
      workItems: {
        rawPayload: async () => ({
          type: 'session.start',
          env: { EXISTING: 'a' },
          envFrom: [{ type: 'secret', name: 'TOKEN', secretRef: 'ama://vaults/v/credentials/c/versions/ver' }],
        }),
      },
      resolveEnv: async () => ({ TOKEN: 'secret' }),
    })
    const payload = await materializeWorkItemPayload(deps, scope, { id: 'work_1' } as WorkItemRecord)
    expect(payload.env).toEqual({ EXISTING: 'a', TOKEN: 'secret' })
    expect(payload).not.toHaveProperty('envFrom')
  })

  it('resolves envFrom when no env exists yet in the payload', async () => {
    const deps = fakeDeps({
      workItems: {
        rawPayload: async () => ({
          type: 'session.start',
          envFrom: [{ type: 'secret', name: 'API_KEY', secretRef: 'ama://vaults/v/credentials/c/versions/ver' }],
        }),
      },
      resolveEnv: async () => ({ API_KEY: 'mysecret' }),
    })
    const payload = await materializeWorkItemPayload(deps, scope, { id: 'work_1' } as WorkItemRecord)
    expect(payload.env).toEqual({ API_KEY: 'mysecret' })
    expect(payload).not.toHaveProperty('envFrom')
  })
})
