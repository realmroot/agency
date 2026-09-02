import { env } from 'cloudflare:workers'
import { createRuntimeOrchestrationRepoFromBinding } from '@server/adapters/repos/runtime-orchestration'
import { describe, expect, it } from 'vitest'

const maintenanceAt = '2026-09-02T00:02:00.000Z'

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

describe('[CF] runtime orchestration maintenance', () => {
  it('[spec: sessions/close] finalizes a cloud close only while state and sandbox generation still match', async () => {
    const projectId = id('project')
    const organizationId = id('org')
    const agentId = id('agent')
    const sessionId = id('session')
    const metadata = JSON.stringify({ runtime: 'ama', generation: 2 })
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(projectId, organizationId, projectId, maintenanceAt, maintenanceAt),
      env.DB.prepare(
        'INSERT INTO agents (id, project_id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(agentId, projectId, 'Agent', 'Test agent', maintenanceAt, maintenanceAt),
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, sandbox_id, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        sessionId,
        agentId,
        organizationId,
        projectId,
        sessionId,
        'sandbox_generation_2',
        'pending',
        metadata,
        maintenanceAt,
        maintenanceAt,
      ),
    ])
    const repo = createRuntimeOrchestrationRepoFromBinding(env.DB)

    await expect(
      repo.finalizeCloudSessionClose(projectId, sessionId, 'sandbox_generation_2', maintenanceAt),
    ).resolves.toBe(false)
    await env.DB.prepare("UPDATE sessions SET state = 'stopped' WHERE id = ?").bind(sessionId).run()
    await expect(
      repo.finalizeCloudSessionClose(projectId, sessionId, 'sandbox_generation_1', maintenanceAt),
    ).resolves.toBe(false)
    await expect(repo.findSession(projectId, sessionId)).resolves.toMatchObject({
      sandboxId: 'sandbox_generation_2',
      metadata,
      closedAt: null,
    })

    await expect(
      repo.finalizeCloudSessionClose(projectId, sessionId, 'sandbox_generation_2', maintenanceAt),
    ).resolves.toBe(true)
    await expect(repo.findSession(projectId, sessionId)).resolves.toMatchObject({
      state: 'closed',
      sandboxId: 'sandbox_generation_2',
      metadata: JSON.stringify({ runtime: 'ama', generation: 2, sandboxDestroyedAt: maintenanceAt }),
      closedAt: maintenanceAt,
    })
  })

  it('[spec: runtime/turn] updates a pending Session only when state and sandbox generation both match', async () => {
    const projectId = id('project')
    const organizationId = id('org')
    const agentId = id('agent')
    const sessionId = id('session')
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(projectId, organizationId, projectId, maintenanceAt, maintenanceAt),
      env.DB.prepare(
        'INSERT INTO agents (id, project_id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(agentId, projectId, 'Agent', 'Test agent', maintenanceAt, maintenanceAt),
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, sandbox_id, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        sessionId,
        agentId,
        organizationId,
        projectId,
        sessionId,
        'sandbox_generation_2',
        'pending',
        JSON.stringify({ generation: 2 }),
        maintenanceAt,
        maintenanceAt,
      ),
    ])
    const repo = createRuntimeOrchestrationRepoFromBinding(env.DB)

    await expect(
      repo.updateSessionWhenStateAndSandbox(projectId, sessionId, 'pending', 'sandbox_generation_1', {
        state: 'error',
        metadata: JSON.stringify({ generation: 1, error: 'late' }),
      }),
    ).resolves.toBe(false)
    await expect(repo.findSession(projectId, sessionId)).resolves.toMatchObject({
      state: 'pending',
      sandboxId: 'sandbox_generation_2',
      metadata: JSON.stringify({ generation: 2 }),
    })

    await expect(
      repo.updateSessionWhenStateAndSandbox(projectId, sessionId, 'pending', 'sandbox_generation_2', {
        state: 'idle',
      }),
    ).resolves.toBe(true)
    await expect(repo.findSession(projectId, sessionId)).resolves.toMatchObject({
      state: 'idle',
      sandboxId: 'sandbox_generation_2',
    })
  })

  it('[spec: sessions/idle-timeout] marks and returns the oldest bounded batch of stalled cloud Sessions', async () => {
    const projectId = id('project')
    const organizationId = id('org')
    const agentId = id('agent')
    const oldestSessionId = id('session_oldest')
    const laterSessionId = id('session_later')
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(projectId, organizationId, projectId, maintenanceAt, maintenanceAt),
      env.DB.prepare(
        'INSERT INTO agents (id, project_id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(agentId, projectId, 'Agent', 'Test agent', maintenanceAt, maintenanceAt),
    ])
    const oldestMetadata = JSON.stringify({ runtime: 'ama', generation: 1 })
    const laterMetadata = JSON.stringify({ runtime: 'ama', generation: 2 })
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, sandbox_id, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        oldestSessionId,
        agentId,
        organizationId,
        projectId,
        oldestSessionId,
        'sandbox_generation_1',
        'running',
        oldestMetadata,
        '2026-09-01T23:39:00.000Z',
        '2026-09-01T23:40:00.000Z',
      ),
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, sandbox_id, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        laterSessionId,
        agentId,
        organizationId,
        projectId,
        laterSessionId,
        'sandbox_generation_2',
        'running',
        laterMetadata,
        '2026-09-01T23:44:00.000Z',
        '2026-09-01T23:45:00.000Z',
      ),
    ])
    const repo = createRuntimeOrchestrationRepoFromBinding(env.DB)

    const stalled = await repo.markStalledCloudSessions('2026-09-01T23:50:00.000Z', maintenanceAt, 1)

    expect(stalled).toEqual([{ id: oldestSessionId, sandboxId: 'sandbox_generation_1', metadata: oldestMetadata }])
    const states = await env.DB.prepare('SELECT id, state FROM sessions WHERE id IN (?, ?) ORDER BY id')
      .bind(oldestSessionId, laterSessionId)
      .all<{ id: string; state: string }>()
    expect(Object.fromEntries(states.results.map((row) => [row.id, row.state]))).toEqual({
      [oldestSessionId]: 'error',
      [laterSessionId]: 'running',
    })
  })

  it('[spec: sessions/idle-timeout] closes and returns the oldest bounded batch of timed-out cloud Sessions', async () => {
    const projectId = id('project')
    const organizationId = id('org')
    const agentId = id('agent')
    const oldestSessionId = id('session_oldest')
    const laterSessionId = id('session_later')
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(projectId, organizationId, projectId, maintenanceAt, maintenanceAt),
      env.DB.prepare(
        'INSERT INTO agents (id, project_id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(agentId, projectId, 'Agent', 'Test agent', maintenanceAt, maintenanceAt),
    ])
    const metadata = JSON.stringify({ annotations: { 'ama.dev/idle-timeout-seconds': '60' } })
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, sandbox_id, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        oldestSessionId,
        agentId,
        organizationId,
        projectId,
        oldestSessionId,
        'sandbox_oldest',
        'idle',
        metadata,
        '2026-09-01T23:59:00.000Z',
        '2026-09-01T23:59:00.000Z',
      ),
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, sandbox_id, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        laterSessionId,
        agentId,
        organizationId,
        projectId,
        laterSessionId,
        'sandbox_later',
        'idle',
        metadata,
        '2026-09-02T00:00:00.000Z',
        '2026-09-02T00:00:00.000Z',
      ),
    ])
    const repo = createRuntimeOrchestrationRepoFromBinding(env.DB)

    const closed = await repo.markIdleTimedOutSessions(maintenanceAt, 1)

    expect(closed).toEqual([{ id: oldestSessionId, sandboxId: 'sandbox_oldest', metadata }])
    const states = await env.DB.prepare('SELECT id, state FROM sessions WHERE id IN (?, ?) ORDER BY id')
      .bind(oldestSessionId, laterSessionId)
      .all<{ id: string; state: string }>()
    expect(Object.fromEntries(states.results.map((row) => [row.id, row.state]))).toEqual({
      [oldestSessionId]: 'stopped',
      [laterSessionId]: 'idle',
    })
  })

  it('[spec: sessions/idle-timeout] stamps destruction only while the row still references that sandbox generation', async () => {
    const projectId = id('project')
    const organizationId = id('org')
    const agentId = id('agent')
    const sessionId = id('session')
    const currentMetadata = JSON.stringify({ runtime: 'ama', generation: 2 })
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(projectId, organizationId, projectId, maintenanceAt, maintenanceAt),
      env.DB.prepare(
        'INSERT INTO agents (id, project_id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(agentId, projectId, 'Agent', 'Test agent', maintenanceAt, maintenanceAt),
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, sandbox_id, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        sessionId,
        agentId,
        organizationId,
        projectId,
        sessionId,
        'sandbox_generation_2',
        'idle',
        currentMetadata,
        maintenanceAt,
        maintenanceAt,
      ),
    ])
    const repo = createRuntimeOrchestrationRepoFromBinding(env.DB)
    await repo.stampSandboxDestroyed(sessionId, 'sandbox_generation_1', maintenanceAt)

    await expect(
      env.DB.prepare('SELECT sandbox_id, metadata FROM sessions WHERE id = ?').bind(sessionId).first(),
    ).resolves.toMatchObject({ sandbox_id: 'sandbox_generation_2', metadata: currentMetadata })

    await repo.stampSandboxDestroyed(sessionId, 'sandbox_generation_2', maintenanceAt)
    await expect(
      env.DB.prepare('SELECT metadata FROM sessions WHERE id = ?').bind(sessionId).first(),
    ).resolves.toMatchObject({
      metadata: JSON.stringify({ runtime: 'ama', generation: 2, sandboxDestroyedAt: maintenanceAt }),
    })
  })
})
