import { describe, expect, it } from 'vitest'
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
  runnerProjectId: null,
  runnerEnvironmentId: null,
  externalTenantId: null,
}

function runnerRecord(overrides: Partial<RunnerAuthRecord> = {}): RunnerAuthRecord {
  return {
    id: 'runner_1',
    organizationId: 'org_1',
    projectId: 'project_1',
    name: 'Runner',
    environmentId: null,
    secretRef: null,
    authMode: 'bearer',
    state: 'offline',
    currentLoad: 0,
    maxConcurrent: 1,
    runtimeUsage: [],
    runtimes: [],
    metadata: {},
    oidcSubject: null,
    oidcClientId: null,
    lastHeartbeatAt: null,
    archivedAt: null,
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
    environmentUsable: async () => true,
    secretRefUsable: async () => ({ credentialMissing: false, versionMissing: false }),
    ...repo,
  }
  return { runners } as unknown as Deps
}

describe('[spec: runners/register] registerRunner', () => {
  it('inserts a new runner when references are usable', async () => {
    const result = await registerRunner(fakeDeps(), auth, consoleOidc, {
      name: 'Local runner',
      environmentId: 'env_1',
      secretRef: 'ama://vaults/vault_1/credentials/cred_1',
      authMode: 'bearer',
      maxConcurrent: 2,
      metadata: { pool: 'default' },
    })
    expect(result.reregistered).toBe(false)
    expect(result.runner.name).toBe('Local runner')
  })

  it('rejects raw secret material in metadata', async () => {
    await expect(
      registerRunner(fakeDeps(), auth, consoleOidc, {
        name: 'Leaky',
        environmentId: undefined,
        secretRef: undefined,
        authMode: 'bearer',
        maxConcurrent: 1,
        metadata: { apiKey: 'raw' },
      }),
    ).rejects.toBeInstanceOf(RunnerValidationError)
  })

  it('conflicts when the environment is unavailable', async () => {
    await expect(
      registerRunner(fakeDeps({ environmentUsable: async () => false }), auth, consoleOidc, {
        name: 'Runner',
        environmentId: 'env_missing',
        secretRef: undefined,
        authMode: 'bearer',
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
        consoleOidc,
        {
          name: 'Runner',
          environmentId: undefined,
          secretRef: 'ama://vaults/vault_1/credentials/cred_missing',
          authMode: 'bearer',
          maxConcurrent: 1,
          metadata: {},
        },
      ),
    ).rejects.toBeInstanceOf(RunnerValidationError)
  })

  it('re-registers a machine-bound federated runner instead of inserting', async () => {
    const existing = runnerRecord({ id: 'runner_fed', authMode: 'federated', oidcSubject: 'sub_1' })
    const result = await registerRunner(
      fakeDeps({ findForMachineRegistration: async () => existing }),
      auth,
      { ...consoleOidc, isRunnerToken: true, runnerProjectId: 'project_1' },
      {
        name: 'Federated runner',
        environmentId: undefined,
        secretRef: undefined,
        authMode: 'federated',
        maxConcurrent: 1,
        metadata: { machineId: 'mac-1' },
      },
    )
    expect(result.reregistered).toBe(true)
    expect(result.runner.id).toBe('runner_fed')
  })

  it('rejects a federated runner token trying to register as non-federated', async () => {
    // runnerOidcBindingFields returns a non-null binding error
    await expect(
      registerRunner(
        fakeDeps(),
        auth,
        { ...consoleOidc, isRunnerToken: true, runnerProjectId: 'project_1' },
        {
          name: 'Bad mode',
          environmentId: undefined,
          secretRef: undefined,
          authMode: 'oidc',
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
        consoleOidc,
        {
          name: 'Runner',
          environmentId: undefined,
          secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_bad',
          authMode: 'bearer',
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
      authMode: 'federated',
      oidcSubject: 'sub_1',
    })
    await expect(
      registerRunner(
        fakeDeps({ findForMachineRegistration: async () => existing }),
        auth,
        { ...consoleOidc, isRunnerToken: true, runnerProjectId: 'project_1' },
        {
          name: 'Conflicting runner',
          environmentId: undefined,
          secretRef: undefined,
          authMode: 'federated',
          maxConcurrent: 1,
          metadata: { machineId: 'mac-2' },
        },
      ),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })
})

describe('updateRunner', () => {
  it('archives via the archived flag', async () => {
    const updated = await updateRunner(fakeDeps(), 'project_1', runnerRecord(), { archived: true })
    expect(updated.archivedAt).toEqual(expect.any(String))
  })

  it('retains existing archivedAt when archiving an already-archived runner', async () => {
    const existing = '2026-01-02T00:00:00.000Z'
    const updated = await updateRunner(fakeDeps(), 'project_1', runnerRecord({ archivedAt: existing }), {
      archived: true,
    })
    expect(updated.archivedAt).toBe(existing)
  })

  it('unarchives a runner via archived:false', async () => {
    const updated = await updateRunner(
      fakeDeps(),
      'project_1',
      runnerRecord({ archivedAt: '2026-01-02T00:00:00.000Z' }),
      { archived: false },
    )
    expect(updated.archivedAt).toBeNull()
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

  it('rejects archived runners', async () => {
    await expect(
      recordRunnerHeartbeat(fakeDeps(), 'project_1', runnerRecord({ archivedAt: '2026-01-02T00:00:00.000Z' }), {
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
})
