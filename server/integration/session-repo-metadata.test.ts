import { env } from 'cloudflare:workers'
import { createSessionRepo } from '@server/adapters/repos/sessions'
import { createDb } from '@server/db/client'
import { describe, expect, it } from 'vitest'

const timestamp = '2026-09-02T00:00:00.000Z'

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

describe('[CF] Session repository metadata annotations', () => {
  it('[spec: triggers/inbox-routing] atomically sets only a missing annotation while preserving current and zero-valued annotation metadata', async () => {
    const projectId = id('project')
    const organizationId = id('org')
    const agentId = id('agent')
    const missingSessionId = id('session_missing')
    const explicitSessionId = id('session_explicit')
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(projectId, organizationId, projectId, timestamp, timestamp),
      env.DB.prepare(
        'INSERT INTO agents (id, project_id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(agentId, projectId, 'Agent', 'Test agent', timestamp, timestamp),
    ])
    const initialMissing = JSON.stringify({ annotations: { source: 'inbox-trigger' }, revision: 'initial' })
    const explicitZero = JSON.stringify({
      annotations: { source: 'inbox-trigger', 'enbor.dev/idle-timeout-seconds': '0' },
      retained: 'explicit',
    })
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        missingSessionId,
        agentId,
        organizationId,
        projectId,
        missingSessionId,
        'idle',
        initialMissing,
        timestamp,
        timestamp,
      ),
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        explicitSessionId,
        agentId,
        organizationId,
        projectId,
        explicitSessionId,
        'idle',
        explicitZero,
        timestamp,
        timestamp,
      ),
    ])
    const currentMissing = JSON.stringify({
      annotations: { source: 'inbox-trigger' },
      revision: 'concurrent-current',
    })
    await env.DB.prepare('UPDATE sessions SET metadata = ? WHERE id = ?').bind(currentMissing, missingSessionId).run()
    const repo = createSessionRepo(createDb(env))

    await repo.setMetadataAnnotationIfMissing(
      projectId,
      missingSessionId,
      'enbor.dev/idle-timeout-seconds',
      '60',
      timestamp,
    )
    await repo.setMetadataAnnotationIfMissing(
      projectId,
      explicitSessionId,
      'enbor.dev/idle-timeout-seconds',
      '60',
      timestamp,
    )

    const rows = await env.DB.prepare('SELECT id, metadata FROM sessions WHERE id IN (?, ?)')
      .bind(missingSessionId, explicitSessionId)
      .all<{ id: string; metadata: string }>()
    const metadataById = Object.fromEntries(rows.results.map((row) => [row.id, JSON.parse(row.metadata)]))
    expect(metadataById).toEqual({
      [missingSessionId]: {
        annotations: { source: 'inbox-trigger', 'enbor.dev/idle-timeout-seconds': '60' },
        revision: 'concurrent-current',
      },
      [explicitSessionId]: {
        annotations: { source: 'inbox-trigger', 'enbor.dev/idle-timeout-seconds': '0' },
        retained: 'explicit',
      },
    })
  })
})
