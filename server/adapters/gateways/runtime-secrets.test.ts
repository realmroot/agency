import type { EnvFromEntry } from '@server/domain/runtime/execution-inputs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'

const secretVersionForResolutionMock = vi.fn()
const vaultVersionsForResolutionMock = vi.fn()
const findActiveMemoryStoreResourceMock = vi.fn()
const decryptSecretValueMock = vi.fn()

vi.mock('../repos/runtime-orchestration', () => ({
  createRuntimeOrchestrationRepo: () => ({
    secretVersionForResolution: secretVersionForResolutionMock,
    vaultVersionsForResolution: vaultVersionsForResolutionMock,
    findActiveMemoryStoreResource: findActiveMemoryStoreResourceMock,
  }),
}))

vi.mock('../../vault-crypto', () => ({
  decryptSecretValue: decryptSecretValueMock,
}))

const { createRuntimeSecretGateway } = await import('./runtime-secrets')

const env = { AMA_VAULT_ENCRYPTION_KEY: 'x'.repeat(32) } as unknown as Env
const fakeDb = {} as Parameters<typeof createRuntimeSecretGateway>[1]

const scope = { organizationId: 'org_1', projectId: 'project_1' }
const items: EnvFromEntry[] = [
  { type: 'secret', name: 'API_KEY', secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1' },
]

describe('[spec: runtime-secrets/gateway] createRuntimeSecretGateway', () => {
  beforeEach(() => {
    secretVersionForResolutionMock.mockReset()
    vaultVersionsForResolutionMock.mockReset()
    findActiveMemoryStoreResourceMock.mockReset()
    decryptSecretValueMock.mockReset()
  })

  it('returns env and workspace resolver methods', () => {
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    expect(typeof gateway.resolveEnv).toBe('function')
    expect(typeof gateway.resolveWorkspaceManifest).toBe('function')
  })

  it('decrypts the stored ciphertext for an Enbor credential version', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { value: 'cipher' } }),
      secretRef: 'ama://vaults/vault_1/credentials/cred_1/versions/ver_1',
    })
    decryptSecretValueMock.mockResolvedValueOnce('secret-value')
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    const result = await gateway.resolveEnv(scope, items)
    expect(result).toEqual({ API_KEY: 'secret-value' })
    expect(decryptSecretValueMock).toHaveBeenCalledWith(env, 'cipher')
  })

  it('returns an empty map when envFrom is empty', async () => {
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    const result = await gateway.resolveEnv(scope, [])
    expect(result).toEqual({})
  })

  it('throws when a secret reference cannot be resolved', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce(null)
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(gateway.resolveEnv(scope, items)).rejects.toThrow('cannot be resolved')
  })

  it('throws when the credential is revoked by vault policy', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce({ state: 'revoked', metadata: '{}', secretRef: 'ref' })
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(gateway.resolveEnv(scope, items)).rejects.toThrow('revoked by vault policy')
  })

  it('rejects unsupported envFrom entries and ambiguous data keys', async () => {
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(
      gateway.resolveEnv(scope, [{ type: 'configmap' as never, name: 'BAD', secretRef: 'ref' }]),
    ).rejects.toThrow('unsupported type configmap')

    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { one: '1', two: '2' } }),
      secretRef: 'ref',
    })
    decryptSecretValueMock.mockResolvedValueOnce('one').mockResolvedValueOnce('two')
    await expect(gateway.resolveEnv(scope, [{ type: 'secret', name: 'TOKEN', secretRef: 'ref' }])).rejects.toThrow(
      'must specify a data key',
    )
  })

  it('resolves a selected env data key', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { token: 'cipher-token', other: 'cipher-other' } }),
      secretRef: 'ref',
    })
    decryptSecretValueMock.mockResolvedValueOnce('secret-token').mockResolvedValueOnce('ignored')
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(
      gateway.resolveEnv(scope, [{ type: 'secret', name: 'TOKEN', key: 'token', secretRef: 'ref' }]),
    ).resolves.toEqual({ TOKEN: 'secret-token' })
  })

  it('expands all credential data keys when envFrom only declares secretRef', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { API_TOKEN: 'cipher-token', SERVICE_URL: 'cipher-url' } }),
      secretRef: 'ref',
    })
    decryptSecretValueMock.mockResolvedValueOnce('secret-token').mockResolvedValueOnce('https://service.test')
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(gateway.resolveEnv(scope, [{ type: 'secret', secretRef: 'ref' }])).resolves.toEqual({
      API_TOKEN: 'secret-token',
      SERVICE_URL: 'https://service.test',
    })
  })

  it('rejects duplicate or invalid credential data keys during envFrom expansion', async () => {
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    secretVersionForResolutionMock
      .mockResolvedValueOnce({
        state: 'active',
        metadata: JSON.stringify({ encryptedSecretData: { token: 'cipher-explicit' } }),
        secretRef: 'ref-explicit',
      })
      .mockResolvedValueOnce({
        state: 'active',
        metadata: JSON.stringify({ encryptedSecretData: { TOKEN: 'cipher-token' } }),
        secretRef: 'ref-duplicate',
      })
    decryptSecretValueMock.mockResolvedValueOnce('explicit-token').mockResolvedValueOnce('secret-token')
    await expect(
      gateway.resolveEnv(scope, [
        { type: 'secret', name: 'TOKEN', key: 'token', secretRef: 'ref-explicit' },
        { type: 'secret', secretRef: 'ref-duplicate' },
      ]),
    ).rejects.toThrow('duplicate environment variable TOKEN')

    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { 'bad-key': 'cipher' } }),
      secretRef: 'ref-invalid',
    })
    decryptSecretValueMock.mockResolvedValueOnce('secret')
    await expect(gateway.resolveEnv(scope, [{ type: 'secret', secretRef: 'ref-invalid' }])).rejects.toThrow(
      'invalid environment variable bad-key',
    )
  })

  it('rejects invalid encrypted metadata and missing env data keys', async () => {
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    secretVersionForResolutionMock.mockResolvedValueOnce({ state: 'active', metadata: '{}', secretRef: 'ref' })
    await expect(gateway.resolveEnv(scope, [{ type: 'secret', name: 'TOKEN', secretRef: 'ref' }])).rejects.toThrow(
      'cannot be resolved',
    )

    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { token: 'cipher' } }),
      secretRef: 'ref',
    })
    decryptSecretValueMock.mockResolvedValueOnce(42)
    await expect(gateway.resolveEnv(scope, [{ type: 'secret', name: 'TOKEN', secretRef: 'ref' }])).rejects.toThrow(
      'cannot be resolved',
    )

    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { token: 'cipher' } }),
      secretRef: 'ref',
    })
    decryptSecretValueMock.mockResolvedValueOnce('secret')
    await expect(
      gateway.resolveEnv(scope, [{ type: 'secret', name: 'TOKEN', key: 'missing', secretRef: 'ref' }]),
    ).rejects.toThrow('has no data key missing')
  })

  it('[spec: sessions/secret-projection] materializes projected git, memory, and single-secret workspace mounts', async () => {
    secretVersionForResolutionMock
      .mockResolvedValueOnce({
        state: 'active',
        metadata: JSON.stringify({ encryptedSecretData: { GH_USERNAME: 'u', GH_TOKEN: 'p' } }),
        secretRef: 'git-ref',
      })
      .mockResolvedValueOnce({
        state: 'active',
        metadata: JSON.stringify({ encryptedSecretData: { APP_CONFIG: 'c' } }),
        secretRef: 'secret-ref',
      })
    decryptSecretValueMock
      .mockResolvedValueOnce('git-user')
      .mockResolvedValueOnce('git-pass')
      .mockResolvedValueOnce('secret-config')
    findActiveMemoryStoreResourceMock.mockResolvedValueOnce({
      type: 'memory',
      memoryRef: 'ama://memories/store_1',
      name: 'Memory',
      description: 'Notes',
      mountPath: '/workspace/.ama/memory-stores/store_1',
      memories: [{ path: 'notes.md', content: 'hello' }],
    })
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(
      gateway.resolveWorkspaceManifest(
        scope,
        [
          {
            name: 'repo',
            type: 'git_repository',
            url: 'https://github.com/saltbo/slink.git',
            ref: 'main',
            secretRef: 'git-ref',
            items: [
              { key: 'GH_USERNAME', path: 'username' },
              { key: 'GH_TOKEN', path: 'password' },
            ],
          },
          {
            name: 'memory',
            type: 'memory',
            memoryRef: 'ama://memories/store_1',
          },
          {
            name: 'secret',
            type: 'secret',
            secretRef: 'secret-ref',
            items: [{ key: 'APP_CONFIG', path: 'config.json' }],
          },
        ],
        [
          { name: 'repo', mountPath: '/workspace/repo' },
          { name: 'memory', mountPath: '/workspace/.ama/memory-stores/store_1', readOnly: false },
          { name: 'secret', mountPath: '/workspace/.ama/secrets/custom' },
        ],
      ),
    ).resolves.toEqual({
      root: '/workspace',
      mounts: [
        {
          type: 'git_repository',
          name: 'repo',
          mountPath: '/workspace/repo',
          url: 'https://github.com/saltbo/slink.git',
          ref: 'main',
          credential: { username: 'git-user', password: 'git-pass' },
        },
        {
          type: 'memory',
          name: 'memory',
          mountPath: '/workspace/.ama/memory-stores/store_1',
          memoryRef: 'ama://memories/store_1',
          readOnly: false,
          files: [{ path: 'notes.md', content: 'hello' }],
        },
        {
          type: 'secret',
          name: 'secret',
          mountPath: '/workspace/.ama/secrets/custom',
          readOnly: true,
          files: [{ path: 'config.json', content: 'secret-config' }],
        },
      ],
    })
  })

  it('materializes whole-vault secret mounts and token git credentials', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { token: 'git-token' } }),
      secretRef: 'git-ref',
    })
    vaultVersionsForResolutionMock.mockResolvedValueOnce([
      {
        state: 'active',
        name: 'api',
        secretRef: 'api-ref',
        metadata: JSON.stringify({ encryptedSecretData: { value: 'api-cipher' } }),
      },
      { state: 'revoked', name: 'old', secretRef: 'old-ref', metadata: '{}' },
    ])
    decryptSecretValueMock.mockResolvedValueOnce('user:pass').mockResolvedValueOnce('api-secret')
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(
      gateway.resolveWorkspaceManifest(
        scope,
        [
          { name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git', secretRef: 'git-ref' },
          { name: 'vault', type: 'secret', secretRef: 'ama://vaults/vault_1' },
        ],
        [],
      ),
    ).resolves.toEqual({
      root: '/workspace',
      mounts: [
        {
          type: 'git_repository',
          name: 'repo',
          mountPath: '/workspace/repos/github.com/saltbo/slink',
          url: 'https://github.com/saltbo/slink.git',
          credential: { username: 'user', password: 'pass' },
        },
        {
          type: 'secret',
          name: 'vault',
          mountPath: '/workspace/.ama/secrets/vault',
          readOnly: true,
          files: [{ path: 'api/value', content: 'api-secret' }],
        },
      ],
    })
  })

  it('materializes public git repositories and memory files', async () => {
    findActiveMemoryStoreResourceMock.mockResolvedValueOnce({
      type: 'memory',
      memoryRef: 'ama://memories/store_1',
      name: 'Memory',
      description: null,
      mountPath: '/workspace/.ama/memory-stores/store_1',
      memories: [],
    })
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    await expect(
      gateway.resolveWorkspaceManifest(
        scope,
        [
          { name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' },
          { name: 'memory', type: 'memory', memoryRef: 'ama://memories/store_1' },
        ],
        [],
      ),
    ).resolves.toEqual({
      root: '/workspace',
      mounts: [
        {
          type: 'git_repository',
          name: 'repo',
          mountPath: '/workspace/repos/github.com/saltbo/slink',
          url: 'https://github.com/saltbo/slink.git',
        },
        {
          type: 'memory',
          name: 'memory',
          mountPath: '/workspace/.ama/memory-stores/store_1',
          memoryRef: 'ama://memories/store_1',
          readOnly: true,
          files: [],
        },
      ],
    })
  })

  it('[spec: sessions/identity-materialization] resolves emptyDir seed projections without exposing secret references', async () => {
    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { 'state.json': 'cipher' } }),
      secretRef: 'identity-state-ref',
    })
    decryptSecretValueMock.mockResolvedValueOnce('private-state')
    const gateway = createRuntimeSecretGateway(env, fakeDb)

    await expect(
      gateway.resolveWorkspaceManifest(
        scope,
        [
          {
            name: 'runtime-state',
            type: 'empty_dir',
            seedFrom: [
              {
                type: 'secret',
                secretRef: 'identity-state-ref',
                items: [{ key: 'state.json', path: 'identities/issuer/runtime.json' }],
              },
            ],
          },
        ],
        [{ name: 'runtime-state', mountPath: '/workspace/.ama/runtime-state', readOnly: false }],
      ),
    ).resolves.toEqual({
      root: '/workspace',
      mounts: [
        {
          type: 'empty_dir',
          name: 'runtime-state',
          mountPath: '/workspace/.ama/runtime-state',
          readOnly: false,
          files: [{ path: 'identities/issuer/runtime.json', content: 'private-state' }],
        },
      ],
    })
  })

  it('rejects unresolved workspace secrets and unsafe file names', async () => {
    const gateway = createRuntimeSecretGateway(env, fakeDb)
    secretVersionForResolutionMock.mockResolvedValueOnce({ state: 'revoked', metadata: '{}', secretRef: 'git-ref' })
    await expect(
      gateway.resolveWorkspaceManifest(
        scope,
        [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git', secretRef: 'git-ref' }],
        [],
      ),
    ).rejects.toThrow('cannot be resolved')

    secretVersionForResolutionMock.mockResolvedValueOnce(null)
    vaultVersionsForResolutionMock.mockResolvedValueOnce(null)
    await expect(
      gateway.resolveWorkspaceManifest(scope, [{ name: 'secret', type: 'secret', secretRef: 'missing' }], []),
    ).rejects.toThrow('cannot be resolved')

    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: { '../bad': 'cipher' } }),
      secretRef: 'secret-ref',
    })
    decryptSecretValueMock.mockResolvedValueOnce('secret')
    await expect(
      gateway.resolveWorkspaceManifest(scope, [{ name: 'secret', type: 'secret', secretRef: 'secret-ref' }], []),
    ).rejects.toThrow('cannot be mounted as a file')

    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: '{bad json',
      secretRef: 'secret-ref',
    })
    await expect(
      gateway.resolveEnv(scope, [{ type: 'secret', name: 'TOKEN', secretRef: 'secret-ref' }]),
    ).rejects.toThrow('cannot be resolved')

    secretVersionForResolutionMock.mockResolvedValueOnce({
      state: 'active',
      metadata: JSON.stringify({ encryptedSecretData: {} }),
      secretRef: 'secret-ref',
    })
    await expect(
      gateway.resolveEnv(scope, [{ type: 'secret', name: 'TOKEN', secretRef: 'secret-ref' }]),
    ).rejects.toThrow('must specify a data key')
  })
})
