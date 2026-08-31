import type { Environment, EnvironmentConfig, EnvironmentVersion } from '@server/domain/environment'
import { resourceMetadata } from '@server/domain/resource'
import { describe, expect, it } from 'vitest'
import type { Deps } from './deps'
import { createEnvironment, updateEnvironment } from './environments'
import { type AuthScope, EnvironmentArchivedError, EnvironmentValidationError } from './ports'

const auth: AuthScope = {
  organization: { id: 'org_1', name: 'Org' },
  project: { id: 'project_1', name: 'Project' },
  user: { id: 'user_1' },
  roles: [],
  permissions: [],
}

function config(overrides: Partial<EnvironmentConfig> = {}): EnvironmentConfig {
  return {
    scope: 'project',
    type: 'cloud',
    networking: { type: 'open', allowMcpServers: false, allowPackageManagers: true },
    packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], webi: [] },
    variables: {},
    ...overrides,
  }
}

function environmentRecord(
  overrides: {
    metadata?: Partial<Environment['metadata']>
    spec?: Partial<Environment['spec']>
    status?: Partial<Environment['status']>
  } = {},
): Environment {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    metadata: {
      ...resourceMetadata({
        uid: 'env_1',
        pid: 'project_1',
        name: 'Workspace',
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...overrides.metadata,
    },
    spec: { ...config(), ...overrides.spec },
    status: { phase: 'active', currentVersionId: 'envver_1', version: 1, ...overrides.status },
  }
}

function environmentVersion(
  environment: Environment,
  cfg: EnvironmentConfig,
  createdAt: string,
  values: Partial<EnvironmentVersion> = {},
): EnvironmentVersion {
  return {
    metadata: resourceMetadata({
      uid: 'envver_new',
      pid: environment.metadata.pid,
      name: 'v2',
      createdAt,
      updatedAt: createdAt,
    }),
    spec: cfg,
    status: { environmentId: environment.metadata.uid, version: 2 },
    ...values,
  }
}

function fakeDeps(overrides: { repo?: Partial<Deps['environments']> } = {}): Deps {
  const repo: Deps['environments'] = {
    list: async () => ({ rows: [], hasMore: false }),
    find: async () => null,
    insertVersion: async (environment, cfg, createdAt): Promise<EnvironmentVersion> =>
      environmentVersion(environment, cfg, createdAt),
    listVersions: async () => [],
    findVersion: async () => null,
    insert: async (input, createdAt): Promise<Environment> =>
      environmentRecord({
        metadata: {
          uid: 'env_new',
          name: input.name,
          description: input.description,
          createdAt,
          updatedAt: createdAt,
        },
        spec: input.config,
        status: { currentVersionId: null, version: 0 },
      }),
    setCurrentVersion: async () => {},
    update: async () => {},
    unarchive: async () => {},
    connectorAvailable: async () => true,
    ...overrides.repo,
  }
  return {
    agents: undefined as unknown as Deps['agents'],
    environments: repo,
    providers: undefined as unknown as Deps['providers'],
    providerCatalog: undefined as unknown as Deps['providerCatalog'],
    vaults: undefined as unknown as Deps['vaults'],
    secretStore: undefined as unknown as Deps['secretStore'],
    connectors: undefined as unknown as Deps['connectors'],
    policies: undefined as unknown as Deps['policies'],
    budgets: undefined as unknown as Deps['budgets'],
    usageRecords: undefined as unknown as Deps['usageRecords'],
    auditRecords: undefined as unknown as Deps['auditRecords'],
    triggers: undefined as unknown as Deps['triggers'],
    triggerDispatch: undefined as unknown as Deps['triggerDispatch'],
    projects: undefined as unknown as Deps['projects'],
    runners: undefined as unknown as Deps['runners'],
    workItems: undefined as unknown as Deps['workItems'],
    leases: undefined as unknown as Deps['leases'],
    runtimeSecrets: undefined as unknown as Deps['runtimeSecrets'],
    cloudTurnQueue: undefined as unknown as Deps['cloudTurnQueue'],
    runnerChannel: undefined as unknown as Deps['runnerChannel'],
    cloudRuntime: undefined as unknown as Deps['cloudRuntime'],
    runtimeWorkspace: undefined as unknown as Deps['runtimeWorkspace'],
    sandboxExecutor: undefined as unknown as Deps['sandboxExecutor'],
    amaTurnExecutor: undefined as unknown as Deps['amaTurnExecutor'],
    sessionOrchestration: undefined as unknown as Deps['sessionOrchestration'],
    sessionEventStore: undefined as unknown as Deps['sessionEventStore'],
    sessions: undefined as unknown as Deps['sessions'],
    createApprovalGate: undefined as unknown as Deps['createApprovalGate'],
    rereadStartedSession: false,
    audit: { record: async () => {} },
    policy: {
      resolveToolPolicy: async () => ({}),
      resolveMcpPolicy: async () => ({}),
      evaluateMcpTool: async () => ({ allowed: true, category: 'mcp', rule: null, message: '' }),
      resolveEffective: async () => ({
        source: { type: 'platform_default', id: 'workers-ai-default' },
        sources: [],
        toolPolicy: {},
        mcpPolicy: {},
        sandboxPolicy: {},
      }),
      evaluateProvider: async () => ({ allowed: true, category: 'provider', rule: null, message: '' }),
      evaluateSandboxRuntime: async () => ({ allowed: true, category: 'sandbox', rule: null, message: '' }),
      policyBlocksSandboxOperation: async () => null,
      toolPolicyRequiresApproval: async () => false,
      evaluateProviderForSession: async () => ({
        decision: { allowed: true, category: 'provider', rule: null, message: '' },
        override: null,
      }),
    },
  }
}

describe('[spec: environments/create] createEnvironment', () => {
  it('inserts the environment, snapshots version 1, and sets it current', async () => {
    const setCurrent: string[] = []
    const deps = fakeDeps({
      repo: { setCurrentVersion: async (_id, versionId) => void setCurrent.push(versionId) },
    })
    const environment = await createEnvironment(deps, auth, { name: 'Node', description: null, config: config() })
    expect(environment.status.currentVersionId).toBe('envver_new')
    expect(environment.status.version).toBe(2)
    expect(setCurrent).toEqual(['envver_new'])
  })

  it('rejects redeclaring the Realmroot CLI bundled in the cloud image', async () => {
    await expect(
      createEnvironment(fakeDeps(), auth, {
        name: 'Invalid',
        description: null,
        config: config({
          packages: {
            type: 'packages',
            apt: [],
            cargo: [],
            gem: [],
            go: ['github.com/realmroot/cli@v0.4.2'],
            npm: [],
            pip: [],
            webi: [],
          },
        }),
      }),
    ).rejects.toMatchObject({ fields: { packages: expect.stringContaining('already provided') } })
  })

  it('directs self-hosted Toolbox installation to the Runner host', async () => {
    await expect(
      createEnvironment(fakeDeps(), auth, {
        name: 'Invalid',
        description: null,
        config: config({
          type: 'self_hosted',
          packages: {
            type: 'packages',
            apt: [],
            cargo: [],
            gem: [],
            go: ['github.com/realmroot/cli@v0.4.2'],
            npm: [],
            pip: [],
            webi: [],
          },
        }),
      }),
    ).rejects.toMatchObject({ fields: { packages: expect.stringContaining('Runner host PATH') } })
  })
})

describe('[spec: environments/update] updateEnvironment', () => {
  it('snapshots a new version when a runtime field changes', async () => {
    const inserted: EnvironmentConfig[] = []
    const deps = fakeDeps({
      repo: {
        insertVersion: async (environment, cfg, createdAt) => {
          inserted.push(cfg)
          return environmentVersion(environment, cfg, createdAt, {
            metadata: resourceMetadata({
              uid: 'envver_2',
              pid: environment.metadata.pid,
              name: 'v2',
              createdAt,
              updatedAt: createdAt,
            }),
          })
        },
      },
    })
    const result = await updateEnvironment(deps, auth, environmentRecord(), {
      packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: ['vite'], pip: [], webi: [] },
    })
    expect(inserted).toHaveLength(1)
    expect(result.environment.status.version).toBe(2)
    expect(result.environment.status.currentVersionId).toBe('envver_2')
  })

  it('rejects adding a Realmroot CLI declaration to an existing environment', async () => {
    await expect(
      updateEnvironment(fakeDeps(), auth, environmentRecord(), {
        packages: {
          type: 'packages',
          apt: [],
          cargo: [],
          gem: [],
          go: [],
          npm: [],
          pip: [],
          webi: ['realmroot@0.4.2'],
        },
      }),
    ).rejects.toMatchObject({ fields: { packages: expect.stringContaining('already provided') } })
  })

  it('allows metadata updates and archive for an environment with an unchanged legacy Realmroot declaration', async () => {
    const legacy = environmentRecord({
      spec: {
        packages: {
          type: 'packages',
          apt: [],
          cargo: [],
          gem: [],
          go: ['github.com/realmroot/cli@v0.4.2'],
          npm: [],
          pip: [],
          webi: [],
        },
      },
    })

    const renamed = await updateEnvironment(fakeDeps(), auth, legacy, { name: 'Renamed legacy environment' })
    expect(renamed.environment.metadata.name).toBe('Renamed legacy environment')

    const archived = await updateEnvironment(fakeDeps(), auth, legacy, { archived: true })
    expect(archived.environment.metadata.archivedAt).toEqual(expect.any(String))
  })

  it('allows an explicitly unchanged legacy package declaration', async () => {
    const packages: EnvironmentConfig['packages'] = {
      type: 'packages',
      apt: [],
      cargo: [],
      gem: [],
      go: [],
      npm: [],
      pip: [],
      webi: ['realmroot@0.4.2'],
    }
    const legacy = environmentRecord({ spec: { packages } })

    await expect(updateEnvironment(fakeDeps(), auth, legacy, { packages })).resolves.toMatchObject({
      environment: { spec: { packages } },
    })
  })

  it('does not snapshot when only name/description change', async () => {
    let versioned = false
    const deps = fakeDeps({
      repo: {
        insertVersion: async (environment, cfg, createdAt) => {
          versioned = true
          return environmentVersion(environment, cfg, createdAt)
        },
      },
    })
    const result = await updateEnvironment(deps, auth, environmentRecord(), { name: 'Renamed' })
    expect(versioned).toBe(false)
    expect(result.environment.status.version).toBe(1)
    expect(result.environment.metadata.name).toBe('Renamed')
  })

  it('archives via {archived:true} and reports the transition', async () => {
    const result = await updateEnvironment(fakeDeps(), auth, environmentRecord(), { archived: true })
    expect(result.archived).toBe(true)
    expect(result.environment.metadata.archivedAt).toEqual(expect.any(String))
  })

  it('rejects field updates on an archived environment', async () => {
    await expect(
      updateEnvironment(
        fakeDeps(),
        auth,
        environmentRecord({ metadata: { archivedAt: '2026-01-02T00:00:00.000Z' }, status: { phase: 'archived' } }),
        {
          packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: ['x'], pip: [], webi: [] },
        },
      ),
    ).rejects.toBeInstanceOf(EnvironmentArchivedError)
  })

  it('unarchives an archived environment via {archived:false}', async () => {
    const result = await updateEnvironment(
      fakeDeps(),
      auth,
      environmentRecord({ metadata: { archivedAt: '2026-01-02T00:00:00.000Z' }, status: { phase: 'archived' } }),
      {
        archived: false,
      },
    )
    expect(result.environment.metadata.archivedAt).toBeNull()
    expect(result.unarchived).toBe(true)
  })

  it('is a no-op when patching an archived environment with archived:true', async () => {
    const archived = environmentRecord({
      metadata: { archivedAt: '2026-01-02T00:00:00.000Z' },
      status: { phase: 'archived' },
    })
    const result = await updateEnvironment(fakeDeps(), auth, archived, { archived: true })
    expect(result.environment.metadata.archivedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(result.archived).toBe(false)
    expect(result.unarchived).toBe(false)
  })

  it('is a no-op when patching an archived environment with an empty patch', async () => {
    const archived = environmentRecord({
      metadata: { archivedAt: '2026-01-02T00:00:00.000Z' },
      status: { phase: 'archived' },
    })
    const result = await updateEnvironment(fakeDeps(), auth, archived, {})
    expect(result.environment.metadata.archivedAt).toBe('2026-01-02T00:00:00.000Z')
    expect(result.unarchived).toBe(false)
  })
})

describe('[spec: environments/create] createEnvironment — secret variables', () => {
  it('rejects secret material in environment variables', async () => {
    await expect(
      createEnvironment(fakeDeps(), auth, {
        name: 'x',
        description: null,
        // Deliberately malformed: a raw string where a variable descriptor is
        // expected — the create path must reject it at the input boundary.
        config: config({ variables: { API_KEY: 'raw-secret' } as unknown as EnvironmentConfig['variables'] }),
      }),
    ).rejects.toBeInstanceOf(EnvironmentValidationError)
  })
})

describe('[spec: environments/update] updateEnvironment — description branch', () => {
  it('explicitly sets description to null when provided in patch', async () => {
    const result = await updateEnvironment(
      fakeDeps(),
      auth,
      environmentRecord({ metadata: { description: 'old desc' } }),
      {
        description: null,
      },
    )
    expect(result.environment.metadata.description).toBeNull()
  })

  it('explicitly sets description to a string when provided in patch', async () => {
    const result = await updateEnvironment(fakeDeps(), auth, environmentRecord({ metadata: { description: null } }), {
      description: 'new desc',
    })
    expect(result.environment.metadata.description).toBe('new desc')
  })
})
