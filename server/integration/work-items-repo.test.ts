import { env } from 'cloudflare:workers'
import { createWorkItemRepo } from '@server/adapters/repos/work-items'
import { drizzle } from 'drizzle-orm/d1'
import { describe, expect, it } from 'vitest'

const timestamp = '2026-09-02T00:00:00.000Z'

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

async function seedProjectWithSessions(projectId: string, sessionIds: string[]) {
  const organizationId = id('org')
  const agentId = id('agent')
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(projectId, organizationId, projectId, timestamp, timestamp),
    env.DB.prepare(
      'INSERT INTO agents (id, project_id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(agentId, projectId, 'Agent', 'Test agent', timestamp, timestamp),
  ])
  await env.DB.batch(
    sessionIds.map((sessionId) =>
      env.DB.prepare(
        'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(sessionId, agentId, organizationId, projectId, sessionId, 'running', timestamp, timestamp),
    ),
  )
  return { organizationId }
}

async function seedWorkItem(input: {
  id: string
  organizationId: string
  projectId: string
  sessionId: string
  runnerId?: string
  createdAt?: string
}) {
  await env.DB.prepare(
    'INSERT INTO work_items (id, organization_id, project_id, session_id, runner_id, type, payload, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      input.id,
      input.organizationId,
      input.projectId,
      input.sessionId,
      input.runnerId ?? null,
      'session.start',
      '{}',
      input.createdAt ?? timestamp,
      input.createdAt ?? timestamp,
      input.createdAt ?? timestamp,
    )
    .run()
}

describe('[CF] work-item repository session lookup', () => {
  it('returns no rows for an empty session set', async () => {
    const repo = createWorkItemRepo(drizzle(env.DB))

    await expect(repo.findLatestBySessions(id('project'), [])).resolves.toEqual([])
  })

  it('returns only the latest assignment in the requested project', async () => {
    const projectA = id('project_a')
    const projectB = id('project_b')
    const sessionA = id('session_a')
    const sessionB = id('session_b')
    const scopeA = await seedProjectWithSessions(projectA, [sessionA])
    const scopeB = await seedProjectWithSessions(projectB, [sessionB])
    await seedWorkItem({
      id: id('work_old'),
      organizationId: scopeA.organizationId,
      projectId: projectA,
      sessionId: sessionA,
      createdAt: '2026-09-01T00:00:00.000Z',
    })
    const latestId = id('work_latest')
    await seedWorkItem({
      id: latestId,
      organizationId: scopeA.organizationId,
      projectId: projectA,
      sessionId: sessionA,
      createdAt: '2026-09-02T00:00:00.000Z',
    })
    await seedWorkItem({
      id: id('work_foreign'),
      organizationId: scopeB.organizationId,
      projectId: projectB,
      sessionId: sessionB,
    })
    const repo = createWorkItemRepo(drizzle(env.DB))

    const rows = await repo.findLatestBySessions(projectA, [sessionA, sessionB])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: latestId, projectId: projectA, sessionId: sessionA })
  })

  it('finds every requested session across query chunks larger than 90 ids', async () => {
    const projectId = id('project_chunked')
    const sessionIds = Array.from({ length: 91 }, (_, index) => id(`session_${index}`))
    const scope = await seedProjectWithSessions(projectId, sessionIds)
    await env.DB.batch(
      sessionIds.map((sessionId, index) =>
        env.DB.prepare(
          'INSERT INTO work_items (id, organization_id, project_id, session_id, type, payload, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).bind(
          id(`work_${index}`),
          scope.organizationId,
          projectId,
          sessionId,
          'session.start',
          '{}',
          timestamp,
          timestamp,
          timestamp,
        ),
      ),
    )
    const repo = createWorkItemRepo(drizzle(env.DB))

    const rows = await repo.findLatestBySessions(projectId, sessionIds)

    expect(rows).toHaveLength(91)
    expect(new Set(rows.map((row) => row.sessionId))).toEqual(new Set(sessionIds))
  })
})
