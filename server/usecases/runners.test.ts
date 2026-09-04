import { describe, expect, it, vi } from 'vitest'
import type { RunnerOidcContext } from '../domain/runner-queue'
import type { Deps } from './deps'
import { type AuthScope, type RunnerAuthRecord, RunnerConflictError, RunnerValidationError } from './ports'
import { recordRunnerHeartbeat, registerRunner, updateRunner } from './runners'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

const consoleOidc: RunnerOidcContext = {
  isRunnerToken: false,
  subject: 'sub_1',
  clientId: null,
}

const runnerOidc: RunnerOidcContext = {
  isRunnerToken: true,
  subject: 'sub_1',
  clientId: 'realmroot-cli',
}

function runnerRecord(overrides: Partial<RunnerAuthRecord> = {}): RunnerAuthRecord {
  return {
    id: 'runner_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Runner',
    environmentId: null,
    secretRef: null,
    authMode: 'realmroot',
    state: 'offline',
    currentLoad: 0,
    maxConcurrent: 1,
    runtimeUsage: [],
    runtimes: [],
    metadata: {},
    oidcSubject: null,
    oidcClientId: null,
    lastHeartbeatAt: null,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function fakeDeps(repo: Partial<Deps['runners']> = {}): Deps {
  const runners: Deps['runners'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    findForMachineRegistration: async () => null,
    insert: async (input) => runnerRecord({ name: input.name, environmentId: input.environmentId }),
    reregister: async (_p, id, input) => runnerRecord({ id, name: input.name }),
    update: async (_p, id, fields) => runnerRecord({ id, ...fields }),
    heartbeat: async (_p, id, fields) => runnerRecord({ id, ...fields, lastHeartbeatAt: '2026-02-02T00:00:00.000Z' }),
    delete: async () => true,
    environmentUsable: async () => true,
    secretRefUsable: async () => ({ credentialMissing: false, versionMissing: false }),
    ...repo,
  }
  return { runners } as unknown as Deps
}

describe('[spec: runners/register] registerRunner', () => {
  it('inserts a new runner when references are usable', async () => {
    const result = await registerRunner(fakeDeps(), auth, runnerOidc, {
      name: 'Local runner',
      environmentId: 'env_1',
      secretRef: 'enbor://vaults/vault_1/credentials/cred_1',
      authMode: 'realmroot',
      maxConcurrent: 2,
      metadata: { pool: 'default' },
    })
    expect(result.reregistered).toBe(false)
    expect(result.runner.name).toBe('Local runner')
  })

  it('rejects raw secret material in metadata', async () => {
    await expect(
      registerRunner(fakeDeps(), auth, runnerOidc, {
        name: 'Leaky',
        environmentId: undefined,
        secretRef: undefined,
        authMode: 'realmroot',
        maxConcurrent: 1,
        metadata: { apiKey: 'raw' },
      }),
    ).rejects.toBeInstanceOf(RunnerValidationError)
  })

  it('conflicts when the environment is unavailable', async () => {
    await expect(
      registerRunner(fakeDeps({ environmentUsable: async () => false }), auth, runnerOidc, {
        name: 'Runner',
        environmentId: 'env_missing',
        secretRef: undefined,
        authMode: 'realmroot',
        maxConcurrent: 1,
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })

  it('rejects an invalid secret reference', async () => {
    await expect(
      registerRunner(
        fakeDeps({ secretRefUsable: async () => ({ credentialMissing: true, versionMissing: false }) }),
        auth,
        runnerOidc,
        {
          name: 'Runner',
          environmentId: undefined,
          secretRef: 'enbor://vaults/vault_1/credentials/cred_missing',
          authMode: 'realmroot',
          maxConcurrent: 1,
          metadata: {},
        },
      ),
    ).rejects.toBeInstanceOf(RunnerValidationError)
  })

  it('re-registers a machine-bound Realmroot runner instead of inserting', async () => {
    const existing = runnerRecord({ id: 'runner_realmroot', authMode: 'realmroot', oidcSubject: 'sub_1' })
    const result = await registerRunner(
      fakeDeps({ findForMachineRegistration: async () => existing }),
      auth,
      { ...consoleOidc, isRunnerToken: true, clientId: 'realmroot-cli' },
      {
        name: 'Realmroot runner',
        environmentId: undefined,
        secretRef: undefined,
        authMode: 'realmroot',
        maxConcurrent: 1,
        metadata: { machineId: 'mac-1' },
      },
    )
    expect(result.reregistered).toBe(true)
    expect(result.runner.id).toBe('runner_realmroot')
  })

  it('rejects a runner token trying to register a legacy auth mode', async () => {
    await expect(
      registerRunner(
        fakeDeps(),
        auth,
        { ...consoleOidc, isRunnerToken: true, clientId: 'realmroot-cli' },
        {
          name: 'Bad mode',
          environmentId: undefined,
          secretRef: undefined,
          authMode: 'oidc' as never,
          maxConcurrent: 1,
          metadata: {},
        },
      ),
    ).rejects.toBeInstanceOf(RunnerValidationError)
  })

  it('rejects an invalid secret version reference', async () => {
    await expect(
      registerRunner(
        fakeDeps({ secretRefUsable: async () => ({ credentialMissing: false, versionMissing: true }) }),
        auth,
        runnerOidc,
        {
          name: 'Runner',
          environmentId: undefined,
          secretRef: 'enbor://vaults/vault_1/credentials/cred_1/versions/ver_bad',
          authMode: 'realmroot',
          maxConcurrent: 1,
          metadata: {},
        },
      ),
    ).rejects.toBeInstanceOf(RunnerValidationError)
  })

  it('conflicts when a reusable row belongs to a different project', async () => {
    const existing = runnerRecord({
      id: 'runner_other',
      projectId: 'project_other',
      authMode: 'realmroot',
      oidcSubject: 'sub_1',
    })
    await expect(
      registerRunner(
        fakeDeps({ findForMachineRegistration: async () => existing }),
        auth,
        { ...consoleOidc, isRunnerToken: true, clientId: 'realmroot-cli' },
        {
          name: 'Conflicting runner',
          environmentId: undefined,
          secretRef: undefined,
          authMode: 'realmroot',
          maxConcurrent: 1,
          metadata: { machineId: 'mac-2' },
        },
      ),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })
})

describe('updateRunner', () => {
  it('updates management fields while preserving omitted values', async () => {
    const update = vi.fn(fakeDeps().runners.update)
    const current = runnerRecord({ state: 'active', maxConcurrent: 2, metadata: { pool: 'default' } })

    const result = await updateRunner(fakeDeps({ update }), 'project_1', current, { name: 'Renamed' })

    expect(result.name).toBe('Renamed')
    expect(update).toHaveBeenCalledWith(
      'project_1',
      'runner_1',
      expect.objectContaining({ state: 'active', maxConcurrent: 2, metadata: { pool: 'default' } }),
      expect.any(String),
    )
    expect(update.mock.calls[0]?.[2]).not.toHaveProperty('deletedAt')
  })

  it('rejects secret material in metadata', async () => {
    await expect(
      updateRunner(fakeDeps(), 'project_1', runnerRecord(), { metadata: { token: 'x' } }),
    ).rejects.toBeInstanceOf(RunnerValidationError)
  })
})

describe('recordRunnerHeartbeat', () => {
  it('records a heartbeat for a live runner', async () => {
    const updated = await recordRunnerHeartbeat(fakeDeps(), 'project_1', runnerRecord(), { state: 'active' })
    expect(updated.lastHeartbeatAt).toEqual(expect.any(String))
  })

  it('rejects deleted runners', async () => {
    await expect(
      recordRunnerHeartbeat(fakeDeps(), 'project_1', runnerRecord({ deletedAt: '2026-01-02T00:00:00.000Z' }), {
        state: 'active',
      }),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })

  it('rejects disabled runners', async () => {
    await expect(
      recordRunnerHeartbeat(fakeDeps(), 'project_1', runnerRecord({ state: 'disabled' }), { state: 'active' }),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })

  it('rejects secret material in runtimes', async () => {
    await expect(
      recordRunnerHeartbeat(fakeDeps(), 'project_1', runnerRecord(), {
        runtimes: [{ secretToken: 'raw' } as never],
      }),
    ).rejects.toBeInstanceOf(RunnerValidationError)
  })

  it('defaults state to active when no state is provided in the heartbeat', async () => {
    const updated = await recordRunnerHeartbeat(fakeDeps(), 'project_1', runnerRecord({ state: 'offline' }), {})
    expect(updated.state).toBe('active')
  })

  it('retries available work for the exact active runner scope when heartbeat reports spare capacity', async () => {
    const retryAvailableWork = vi.fn()
    const updated = runnerRecord({
      id: 'runner_ready',
      organizationId: 'org_ready',
      projectId: 'project_ready',
      environmentId: 'env_ready',
      state: 'active',
      currentLoad: 1,
      maxConcurrent: 2,
    })
    const deps = {
      ...fakeDeps({ heartbeat: async () => updated }),
      runnerChannel: { retryAvailableWork },
    } as unknown as Deps

    await recordRunnerHeartbeat(deps, 'project_1', runnerRecord(), {})

    expect(retryAvailableWork).toHaveBeenCalledOnce()
    expect(retryAvailableWork).toHaveBeenCalledWith({
      runnerId: 'runner_ready',
      organizationId: 'org_ready',
      projectId: 'project_ready',
      environmentId: 'env_ready',
    })
  })

  it.each([
    { boundary: 'non-active state', updated: { state: 'draining' as const, environmentId: 'env_1' } },
    { boundary: 'no environment', updated: { state: 'active' as const, environmentId: null } },
    {
      boundary: 'at capacity',
      updated: { state: 'active' as const, environmentId: 'env_1', currentLoad: 1, maxConcurrent: 1 },
    },
  ])('does not retry available work at the $boundary boundary', async ({ updated }) => {
    const retryAvailableWork = vi.fn()
    const deps = {
      ...fakeDeps({ heartbeat: async () => runnerRecord(updated) }),
      runnerChannel: { retryAvailableWork },
    } as unknown as Deps

    await recordRunnerHeartbeat(deps, 'project_1', runnerRecord(), {})

    expect(retryAvailableWork).not.toHaveBeenCalled()
  })
})
