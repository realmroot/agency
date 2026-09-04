import type { AgentVersionRow } from '@shared/runtime-rows'
import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceSpec, workspaceSpec } from '../workspace'
import {
  type AgentSnapshot,
  agentSnapshotWithWorkspaceContext,
  agentSubagentReferences,
  createAgentSnapshot,
  createSessionSubagentSnapshot,
} from './session-snapshot'

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

function agentVersion(overrides: Partial<AgentVersionRow> = {}): AgentVersionRow {
  return {
    id: 'agentver_reviewer_2',
    agentId: 'agent_reviewer',
    projectId: 'project_1',
    version: 2,
    systemPrompt: 'Review carefully.',
    providerId: 'anthropic',
    model: 'claude-sonnet',
    skills: '["enbor@review"]',
    subagents: '[{"agentId":"agent_nested","name":"nested"}]',
    allowedTools: '["read","grep"]',
    mcpConnectors: '["github"]',
    identityId: 'identity_reviewer',
    identitySnapshot: '{"identityId":"identity_reviewer","credentialRef":"enbor://vaults/secret"}',
    createdAt: '2026-06-25T00:00:00.000Z',
    ...overrides,
  }
}

describe('[spec: agents/subagent-references] session sub-agent snapshots', () => {
  it('reads only named Agent references from a parent version', () => {
    expect(
      agentSubagentReferences(agentVersion({ subagents: '[{"agentId":"agent_reviewer","name":"reviewer"}]' })),
    ).toEqual([{ agentId: 'agent_reviewer', name: 'reviewer' }])
  })

  it('projects the referenced current version without its Identity or nested sub-agents', () => {
    const subagent = createSessionSubagentSnapshot(
      { id: 'agent_reviewer', name: 'Reviewer', description: null },
      agentVersion(),
      'reviewer',
    )

    expect(subagent).toEqual({
      agentId: 'agent_reviewer',
      agentVersionId: 'agentver_reviewer_2',
      version: 2,
      name: 'reviewer',
      description: 'Reviewer',
      systemPrompt: 'Review carefully.',
      provider: 'anthropic',
      model: 'claude-sonnet',
      skills: ['enbor@review'],
      allowedTools: ['read', 'grep'],
      mcpConnectors: ['github'],
    })
    expect(subagent).not.toHaveProperty('identity')
    expect(subagent).not.toHaveProperty('subagents')
    expect(createAgentSnapshot(agentVersion(), [subagent]).subagents).toEqual([subagent])
  })
})

describe('[spec: sessions/memory-store-resources] memory store volumes', () => {
  it('accepts managed memory store volumes and rejects unsafe mounts', () => {
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'enbor://memories/memstore_1' }],
          [{ name: 'memory-memstore_1', mountPath: '/workspace/.enbor/memory-stores/memstore_1', readOnly: true }],
        ),
      ).volumes,
    ).toEqual([{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'enbor://memories/memstore_1' }])

    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'enbor://memories/memstore_1' }],
          [{ name: 'memory-memstore_1', mountPath: '/workspace/custom' }],
        ),
      ),
    ).toEqual({
      fields: { 'volumeMounts.0.mountPath': 'Memory store mounts must stay under /workspace/.enbor/memory-stores.' },
    })
  })

  it('requires readOnly and unique store ids per session', () => {
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [{ name: 'memory-memstore_1', type: 'memory', memoryRef: 'enbor://memories/memstore_1' }],
          [
            JSON.parse(
              '{ "name": "memory-memstore_1", "mountPath": "/workspace/.enbor/memory-stores/memstore_1", "readOnly": "bad" }',
            ),
          ],
        ),
      ),
    ).toEqual({ fields: { 'volumeMounts.0.readOnly': 'Use a boolean readOnly value.' } })
    expect(
      normalizeWorkspaceSpec(
        workspaceSpec(
          [
            { name: 'memory-a', type: 'memory', memoryRef: 'enbor://memories/memstore_1' },
            { name: 'memory-b', type: 'memory', memoryRef: 'enbor://memories/memstore_1' },
          ],
          [
            { name: 'memory-a', mountPath: '/workspace/.enbor/memory-stores/memstore_1' },
            { name: 'memory-b', mountPath: '/workspace/.enbor/memory-stores/memstore_1' },
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
          memoryRef: 'enbor://memories/memstore_1',
        },
      ],
      [
        { name: 'source', mountPath: '/workspace/repos/saltbo/downstream-service' },
        { name: 'Team memory', mountPath: '/workspace/.enbor/memory-stores/memstore_1', readOnly: false },
      ],
    )
    expect(augmented.systemPrompt).toContain('Base instructions.')
    expect(augmented.systemPrompt).toContain('Workspace layout:')
    expect(augmented.systemPrompt).toContain(
      'https://github.com/saltbo/downstream-service.git at repos/saltbo/downstream-service',
    )
    expect(augmented.systemPrompt).toContain('Team memory')
    expect(augmented.systemPrompt).toContain('.enbor/memory-stores/memstore_1')
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
          credentialRef: 'enbor://vaults/vault_1/credentials/cred_1',
        },
      }),
      [],
      [],
    )

    expect(augmented.systemPrompt).toContain('Realmroot Toolbox')
    expect(augmented.systemPrompt).not.toContain('enbor://vaults/')
  })
})
