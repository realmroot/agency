import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceSpec, workspaceMountPath, workspaceSpec, workspaceSystemPromptBlock } from './workspace'

describe('[spec: sessions/workspace-volumes] workspace domain helpers', () => {
  it('builds prompt context for repositories and memory stores', () => {
    const spec = workspaceSpec(
      [
        { name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' },
        {
          name: 'memory',
          type: 'memory',
          memoryRef: 'enbor://memories/store_1',
        },
      ],
      [
        { name: 'repo', mountPath: '/workspace/src' },
        { name: 'memory', mountPath: '/workspace/.enbor/memory-stores/store_1', readOnly: false },
      ],
    )
    const block = workspaceSystemPromptBlock(spec)
    expect(block).toContain('https://github.com/saltbo/slink.git at src')
    expect(block).toContain('memory (writable) at .enbor/memory-stores/store_1')
  })

  it('returns null when no prompt-visible volumes are present', () => {
    expect(workspaceSystemPromptBlock(workspaceSpec([], []))).toBeNull()
  })

  it('formats workspace-root and external prompt paths', () => {
    const block = workspaceSystemPromptBlock(
      workspaceSpec(
        [
          { name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' },
          { name: 'memory', type: 'memory', memoryRef: 'enbor://memories/store_1' },
        ],
        [
          { name: 'repo', mountPath: '/workspace' },
          { name: 'memory', mountPath: '/external/memory', readOnly: true },
        ],
      ),
    )
    expect(block).toContain('https://github.com/saltbo/slink.git at .')
    expect(block).toContain('memory (readOnly) at /external/memory')
  })

  it('uses default prompt mount paths when mounts are omitted', () => {
    const block = workspaceSystemPromptBlock(
      workspaceSpec(
        [
          { name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' },
          { name: '', type: 'memory', memoryRef: 'enbor://memories/store_1' },
        ],
        [],
      ),
    )
    expect(block).toContain('https://github.com/saltbo/slink.git at repos/github.com/saltbo/slink')
    expect(block).toContain('store_1 (readOnly) at .enbor/memory-stores/store_1')
  })

  it('builds prompt context for repository-only and memory-only workspaces', () => {
    const repositoryBlock = workspaceSystemPromptBlock(
      workspaceSpec(
        [{ name: 'repo', type: 'git_repository', url: undefined as never }],
        [{ name: 'repo', mountPath: '/workspace/src' }],
      ),
    )
    expect(repositoryBlock).toContain('- Repositories:')
    expect(repositoryBlock).not.toContain('- Memory stores:')
    expect(repositoryBlock).toContain('-  at src')

    const memoryBlock = workspaceSystemPromptBlock(
      workspaceSpec(
        [{ name: 'memory', type: 'memory', memoryRef: undefined as never }],
        [{ name: 'memory', mountPath: '/workspace/.enbor/memory-stores/fallback', readOnly: true }],
      ),
    )
    expect(memoryBlock).not.toContain('- Repositories:')
    expect(memoryBlock).toContain('- Memory stores:')
    expect(memoryBlock).toContain('memory (readOnly) at .enbor/memory-stores/fallback')
  })

  it('normalizes valid git and memory volumes', () => {
    const result = normalizeWorkspaceSpec(
      workspaceSpec(
        [
          {
            name: 'repo',
            type: 'git_repository',
            url: 'https://github.com/saltbo/slink.git?ignored=1',
            ref: 'main',
            secretRef: 'enbor://vaults/v/credentials/c/versions/ver',
          },
          JSON.parse(`{
            "name": "memory",
            "type": "memory",
            "memoryRef": "enbor://memories/store_1",
            "storeName": "Store",
            "description": "Notes",
            "memories": [{ "path": "notes.md", "content": "hello" }]
          }`),
        ],
        [
          { name: 'repo', mountPath: 'src' },
          { name: 'memory', mountPath: '/workspace/.enbor/memory-stores/store_1', readOnly: true },
        ],
      ),
    )
    expect(result).toEqual({
      volumes: [
        {
          name: 'repo',
          type: 'git_repository',
          url: 'https://github.com/saltbo/slink.git',
          ref: 'main',
          secretRef: 'enbor://vaults/v/credentials/c/versions/ver',
        },
        {
          name: 'memory',
          type: 'memory',
          memoryRef: 'enbor://memories/store_1',
        },
      ],
      volumeMounts: [
        { name: 'repo', mountPath: '/workspace/src', readOnly: true },
        { name: 'memory', mountPath: '/workspace/.enbor/memory-stores/store_1', readOnly: true },
      ],
    })
  })

  it('normalizes minimal git and memory volumes without optional fields', () => {
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [
            { name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' },
            { name: 'memory', type: 'memory', memoryRef: 'enbor://memories/store_1' },
          ],
          [
            { name: 'repo', mountPath: '/workspace/repo' },
            { name: 'memory', mountPath: '/workspace/.enbor/memory-stores/store_1' },
          ],
        ),
      ),
    ).toEqual({
      volumes: [
        { name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' },
        { name: 'memory', type: 'memory', memoryRef: 'enbor://memories/store_1' },
      ],
      volumeMounts: [
        { name: 'repo', mountPath: '/workspace/repo', readOnly: true },
        { name: 'memory', mountPath: '/workspace/.enbor/memory-stores/store_1', readOnly: true },
      ],
    })
  })

  it('normalizes a writable empty directory with declarative seed projections', () => {
    const volume = {
      name: 'runtime-state',
      type: 'empty_dir' as const,
      seedFrom: [
        {
          type: 'secret' as const,
          secretRef: 'enbor://vaults/v/credentials/c',
          items: [{ key: 'state.json', path: 'identities/issuer/runtime.json' }],
        },
      ],
    }
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [volume],
          [{ name: 'runtime-state', mountPath: '/workspace/.enbor/runtime-state', readOnly: false }],
        ),
      ),
    ).toEqual({
      volumes: [volume],
      volumeMounts: [{ name: 'runtime-state', mountPath: '/workspace/.enbor/runtime-state', readOnly: false }],
    })
  })

  it('rejects invalid workspace declarations', () => {
    expect(normalizeWorkspaceSpec(workspaceSpec([], [{ name: 'x', mountPath: '/tmp/x' }]))).toEqual({
      fields: { 'volumeMounts.0.mountPath': 'Volume mount path must stay under /workspace.' },
    })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [
            { name: 'dup', type: 'secret', secretRef: 'enbor://vaults/v' },
            { name: 'dup', type: 'secret', secretRef: 'enbor://vaults/v2' },
          ],
          [],
        ),
      ),
    ).toEqual({ fields: { 'volumes.1.name': 'Volume names must be unique.' } })
    expect(
      normalizeWorkspaceSpec(workspaceSpec([{ name: 'repo', type: 'git_repository', url: 'ssh://bad' }], [])),
    ).toEqual({
      fields: { 'volumes.0.url': 'Use a safe HTTPS Git repository URL.' },
    })
    expect(normalizeWorkspaceSpec(workspaceSpec([{ name: 'memory', type: 'memory', memoryRef: 'bad' }], []))).toEqual({
      fields: { 'volumes.0.memoryRef': 'Memory reference must use enbor://memories/{storeId}.' },
    })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory', type: 'memory', memoryRef: 'enbor://memories/m' }],
          [JSON.parse('{ "name": "memory", "mountPath": "/workspace/.enbor/memory-stores/m", "readOnly": "bad" }')],
        ),
      ),
    ).toEqual({ fields: { 'volumeMounts.0.readOnly': 'Use a boolean readOnly value.' } })
    expect(normalizeWorkspaceSpec(workspaceSpec([], [{ name: 'bad', mountPath: 'bad//path' }]))).toEqual({
      fields: { 'volumeMounts.0.mountPath': 'Volume mount path must stay under /workspace.' },
    })
    expect(normalizeWorkspaceSpec(workspaceSpec([], [{ name: 'bad', mountPath: 'bad\\path' }]))).toEqual({
      fields: { 'volumeMounts.0.mountPath': 'Volume mount path must stay under /workspace.' },
    })
    expect(normalizeWorkspaceSpec(workspaceSpec([], [{ name: 'bad', mountPath: '' }]))).toEqual({
      fields: { 'volumeMounts.0.mountPath': 'Volume mount path must stay under /workspace.' },
    })
    expect(
      normalizeWorkspaceSpec(workspaceSpec([{ name: 'memory', type: 'memory', memoryRef: 1 as never }], [])),
    ).toEqual({ fields: { 'volumes.0.memoryRef': 'Memory reference must use enbor://memories/{storeId}.' } })
  })

  it('rejects missing or conflicting mounts', () => {
    expect(normalizeWorkspaceSpec(workspaceSpec([{ name: 'state', type: 'empty_dir' }], []))).toEqual({
      fields: { 'volumes.0.name': 'Empty directory volume must have a matching volume mount.' },
    })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'state', type: 'empty_dir' }],
          [{ name: 'state', mountPath: '/workspace/.enbor/state', readOnly: true }],
        ),
      ),
    ).toEqual({ fields: { 'volumeMounts.0.readOnly': 'Empty directory volumes must be writable.' } })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec([{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' }], []),
      ),
    ).toEqual({ fields: { 'volumes.0.name': 'Repository volume must have a matching volume mount.' } })
    expect(
      normalizeWorkspaceSpec(workspaceSpec([{ name: 'memory', type: 'memory', memoryRef: 'enbor://memories/m' }], [])),
    ).toEqual({ fields: { 'volumes.0.name': 'Memory store volume must have a matching volume mount.' } })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory', type: 'memory', memoryRef: 'enbor://memories/m' }],
          [{ name: 'memory', mountPath: '/workspace/memory' }],
        ),
      ),
    ).toEqual({
      fields: { 'volumeMounts.0.mountPath': 'Memory store mounts must stay under /workspace/.enbor/memory-stores.' },
    })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [
            { name: 'memory1', type: 'memory', memoryRef: 'enbor://memories/m1' },
            { name: 'memory2', type: 'memory', memoryRef: 'enbor://memories/m2' },
          ],
          [
            { name: 'memory1', mountPath: '/workspace/.enbor/memory-stores/shared' },
            { name: 'memory2', mountPath: '/workspace/.enbor/memory-stores/shared' },
          ],
        ),
      ),
    ).toEqual({ fields: { 'volumeMounts.1.mountPath': 'Mount path must be unique within a session.' } })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' }],
          [{ name: 'repo', mountPath: '/workspace/.enbor/repo' }],
        ),
      ),
    ).toEqual({
      fields: {
        'volumeMounts.0.mountPath': 'Repository mount path must stay under /workspace outside /workspace/.enbor.',
      },
    })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [
            { name: 'repo1', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' },
            { name: 'repo2', type: 'git_repository', url: 'https://github.com/saltbo/slink.git' },
          ],
          [
            { name: 'repo1', mountPath: '/workspace/src' },
            { name: 'repo2', mountPath: '/workspace/src' },
          ],
        ),
      ),
    ).toEqual({ fields: { 'volumeMounts.1.mountPath': 'Mount path must be unique within a session.' } })
  })

  it('keeps non-git non-memory volumes and resolves mount fallbacks', () => {
    const volume = { name: 'secret', type: 'secret', secretRef: 'enbor://vaults/v' } as const
    expect(normalizeWorkspaceSpec(workspaceSpec([volume], []))).toEqual({ volumes: [volume], volumeMounts: [] })
    expect(workspaceMountPath('missing', [], '/workspace/default')).toBe('/workspace/default')
    expect(workspaceMountPath('repo', [{ name: 'repo', mountPath: '/workspace/src' }], '/workspace/default')).toBe(
      '/workspace/src',
    )
  })
})
