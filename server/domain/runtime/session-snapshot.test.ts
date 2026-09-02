import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceSpec, workspaceSpec } from '../workspace'
import { type AgentSnapshot, agentSnapshotWithWorkspaceContext } from './session-snapshot'

function agentSnapshot(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: 'agentver_1',
    agentId: 'agent_1',
    projectId: 'project_1',
    version: 1,
    systemPrompt: 'Base instructions.',
    provider: 'workers-ai',
    model: '@cf/test/model',
    skills: [],
    subagents: [],
    allowedTools: ['read', 'bash'],
    mcpConnectors: [],
    identity: null,
    createdAt: '2026-06-25T00:00:00.000Z',
    ...overrides,
  }
}

describe('[spec: sessions/memory-store-resources] memory store volumes', () => {
  it('accepts managed memory store volumes and rejects unsafe mounts', () => {
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'ama://memories/memstore_1' }],
          [{ name: 'memory-memstore_1', mountPath: '/workspace/.ama/memory-stores/memstore_1', readOnly: true }],
        ),
      ).volumes,
    ).toEqual([{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'ama://memories/memstore_1' }])

    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'ama://memories/memstore_1' }],
          [{ name: 'memory-memstore_1', mountPath: '/workspace/custom' }],
        ),
      ),
    ).toEqual({
      fields: { 'volumeMounts.0.mountPath': 'Memory store mounts must stay under /workspace/.ama/memory-stores.' },
    })
  })

  it('requires readOnly and unique store ids per session', () => {
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'ama://memories/memstore_1' }],
          [
            JSON.parse(
              '{ "name": "memory-memstore_1", "mountPath": "/workspace/.ama/memory-stores/memstore_1", "readOnly": "bad" }',
            ),
          ],
        ),
      ),
    ).toEqual({ fields: { 'volumeMounts.0.readOnly': 'Use a boolean readOnly value.' } })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [
            { name: 'memory-a', type: 'memory', memoryRef: 'ama://memories/memstore_1' },
            { name: 'memory-b', type: 'memory', memoryRef: 'ama://memories/memstore_1' },
          ],
          [
            { name: 'memory-a', mountPath: '/workspace/.ama/memory-stores/memstore_1' },
            { name: 'memory-b', mountPath: '/workspace/.ama/memory-stores/memstore_1' },
          ],
        ),
      ),
    ).toEqual({ fields: { 'volumeMounts.1.mountPath': 'Mount path must be unique within a session.' } })
  })

  it('adds memory references to the runtime system prompt without store metadata or contents', () => {
    const augmented = agentSnapshotWithWorkspaceContext(
      agentSnapshot(),
      [
        {
          name: 'source',
          type: 'git_repository',
          url: 'https://github.com/saltbo/downstream-service.git',
          ref: 'main',
        },
        {
          name: 'Team memory',
          type: 'memory',
          memoryRef: 'ama://memories/memstore_1',
        },
      ],
      [
        { name: 'source', mountPath: '/workspace/repos/saltbo/downstream-service' },
        { name: 'Team memory', mountPath: '/workspace/.ama/memory-stores/memstore_1', readOnly: false },
      ],
    )
    expect(augmented.systemPrompt).toContain('Base instructions.')
    expect(augmented.systemPrompt).toContain('Workspace layout:')
    expect(augmented.systemPrompt).toContain(
      'https://github.com/saltbo/downstream-service.git at repos/saltbo/downstream-service',
    )
    expect(augmented.systemPrompt).toContain('Team memory')
    expect(augmented.systemPrompt).toContain('.ama/memory-stores/memstore_1')
  })
})

describe('[spec: sessions/identity-materialization] Realmroot workspace context', () => {
  it('announces the Realmroot toolbox without exposing credential material', () => {
    const augmented = agentSnapshotWithWorkspaceContext(
      agentSnapshot({
        identity: {
          identityId: 'identity_1',
          agentId: 'rr_agent_1',
          issuer: 'https://realmroot.example.com/api/auth',
          subject: 'rr_agent_1',
          username: 'runner',
          runtime: 'codex',
          credentialRef: 'ama://vaults/vault_1/credentials/cred_1',
        },
      }),
      [],
      [],
    )

    expect(augmented.systemPrompt).toContain('Realmroot Toolbox')
    expect(augmented.systemPrompt).not.toContain('ama://vaults/')
  })
})
