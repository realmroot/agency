import { env } from 'cloudflare:workers'
import { createRuntimeOrchestrationRepoFromBinding } from '@server/adapters/repos/runtime-orchestration'
import { describe, expect, it } from 'vitest'

const timestamp = '2026-09-03T00:00:00.000Z'

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

async function seedPendingSession(metadata: Record<string, unknown>) {
  const projectId = id('project')
  const organizationId = id('org')
  const agentId = id('agent')
  const sessionId = id('session')
  const sandboxId = id('sandbox')
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(projectId, organizationId, projectId, timestamp, timestamp),
    env.DB.prepare(
      'INSERT INTO agents (id, project_id, name, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(agentId, projectId, 'Agent', 'Test agent', timestamp, timestamp),
    env.DB.prepare(
      'INSERT INTO sessions (id, agent_id, organization_id, project_id, durable_object_name, sandbox_id, state, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      sessionId,
      agentId,
      organizationId,
      projectId,
      sessionId,
      sandboxId,
      'pending',
      JSON.stringify(metadata),
      timestamp,
      timestamp,
    ),
  ])
  return { projectId, sessionId, sandboxId, repo: createRuntimeOrchestrationRepoFromBinding(env.DB) }
}

describe('[CF] cloud Session startup and close claims', () => {
  it('rejects runtime reads, CAS, startup leases, and runner recovery writes after Session deletion', async () => {
    const seeded = await seedPendingSession({ retained: true })
    await env.DB.prepare('UPDATE sessions SET deleted_at = ? WHERE id = ?').bind(timestamp, seeded.sessionId).run()

    await expect(seeded.repo.findSession(seeded.projectId, seeded.sessionId)).resolves.toBeNull()
    await expect(seeded.repo.sessionState(seeded.projectId, seeded.sessionId)).resolves.toBeNull()
    await expect(seeded.repo.sessionMetadata(seeded.projectId, seeded.sessionId)).resolves.toBeNull()
    await seeded.repo.updateSession(seeded.projectId, seeded.sessionId, {
      state: 'running',
      metadata: JSON.stringify({ revived: true }),
      updatedAt: '2026-09-03T00:01:00.000Z',
    })
    await expect(
      seeded.repo.updateSessionWhenState(seeded.projectId, seeded.sessionId, 'pending', {
        state: 'running',
        updatedAt: '2026-09-03T00:01:00.000Z',
      }),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.acquirePendingStartupLease(
        seeded.projectId,
        seeded.sessionId,
        null,
        id('startup'),
        '2026-09-03T00:05:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.acquireTurnLease(
        seeded.projectId,
        seeded.sessionId,
        id('turn'),
        '2026-09-03T00:05:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.claimSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        id('cleanup'),
        '2026-09-03T00:05:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(false)
    await seeded.repo.requeueSessionForRunnerRecovery(seeded.projectId, seeded.sessionId, timestamp)

    await expect(
      env.DB.prepare('SELECT state, metadata, deleted_at FROM sessions WHERE id = ?').bind(seeded.sessionId).first(),
    ).resolves.toEqual({ state: 'pending', metadata: '{"retained":true}', deleted_at: timestamp })
  })

  it('[spec: runtime/idle-retention] atomically patches runtime metadata over a concurrent Inbox backfill', async () => {
    const seeded = await seedPendingSession({ beforeStartup: true })
    const startupId = id('startup')
    await expect(
      seeded.repo.acquirePendingStartupLease(
        seeded.projectId,
        seeded.sessionId,
        null,
        startupId,
        '2026-09-03T00:05:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(true)
    const oldRead = await seeded.repo.findSession(seeded.projectId, seeded.sessionId)
    expect(JSON.parse(oldRead?.metadata ?? '{}')).toEqual({ beforeStartup: true })
    const currentMetadata = {
      beforeStartup: true,
      concurrentField: 'preserved',
      annotations: { 'ama.dev/idle-timeout-seconds': '60' },
    }
    await env.DB.prepare('UPDATE sessions SET metadata = ? WHERE id = ?')
      .bind(JSON.stringify(currentMetadata), seeded.sessionId)
      .run()

    await expect(
      seeded.repo.completeCloudSessionStart(
        seeded.projectId,
        seeded.sessionId,
        null,
        startupId,
        {
          state: 'idle',
          sandboxId: seeded.sandboxId,
          activeTurnId: 'startup_lease',
          turnLeaseExpiresAt: '2026-09-03T00:05:00.000Z',
          startedAt: timestamp,
          updatedAt: timestamp,
        },
        { runtimeMode: 'live', runtimeBackend: 'ama-cloud' },
      ),
    ).resolves.toBe(true)

    const started = await seeded.repo.findSession(seeded.projectId, seeded.sessionId)
    expect(JSON.parse(started?.metadata ?? '{}')).toEqual({
      ...currentMetadata,
      runtimeMode: 'live',
      runtimeBackend: 'ama-cloud',
    })
  })

  it('[spec: runtime/idle-retention] atomically patches startup failure without overwriting a concurrent backfill', async () => {
    const seeded = await seedPendingSession({ beforeStartup: true })
    const startupId = id('startup')
    await seeded.repo.acquirePendingStartupLease(
      seeded.projectId,
      seeded.sessionId,
      null,
      startupId,
      '2026-09-03T00:05:00.000Z',
      timestamp,
    )
    const currentMetadata = {
      beforeStartup: true,
      concurrentField: 'preserved',
      annotations: { 'ama.dev/idle-timeout-seconds': '60' },
    }
    await env.DB.prepare('UPDATE sessions SET metadata = ? WHERE id = ?')
      .bind(JSON.stringify(currentMetadata), seeded.sessionId)
      .run()

    await expect(
      seeded.repo.failCloudSessionStart(
        seeded.projectId,
        seeded.sessionId,
        null,
        startupId,
        { state: 'error', stateReason: 'startup failed', updatedAt: timestamp },
        { runtimeBackend: 'ama-cloud', error: { message: 'startup failed' } },
      ),
    ).resolves.toBe(true)

    const failed = await seeded.repo.findSession(seeded.projectId, seeded.sessionId)
    expect(failed).toMatchObject({ state: 'error', stateReason: 'startup failed' })
    expect(JSON.parse(failed?.metadata ?? '{}')).toEqual({
      ...currentMetadata,
      runtimeBackend: 'ama-cloud',
      error: { message: 'startup failed' },
    })
  })

  it('[spec: runtime/idle-retention] expires only an unowned pending generation older than the lifecycle lease window', async () => {
    const activeStartup = await seedPendingSession({ case: 'active-startup' })
    await env.DB.prepare('UPDATE sessions SET active_turn_id = ?, turn_lease_expires_at = ? WHERE id = ?')
      .bind('startup_live', '2026-09-03T01:30:00.000Z', activeStartup.sessionId)
      .run()

    const recentlyReopened = await seedPendingSession({ case: 'recently-reopened' })
    await env.DB.prepare('UPDATE sessions SET started_at = ? WHERE id = ?')
      .bind('2026-09-03T00:55:00.000Z', recentlyReopened.sessionId)
      .run()

    const abandoned = await seedPendingSession({ case: 'abandoned' })
    const expiredBefore = '2026-09-03T00:30:00.000Z'
    const sweptAt = '2026-09-03T01:00:00.000Z'
    await activeStartup.repo.markExpiredPendingSessions(activeStartup.projectId, expiredBefore, sweptAt)
    await recentlyReopened.repo.markExpiredPendingSessions(recentlyReopened.projectId, expiredBefore, sweptAt)
    await abandoned.repo.markExpiredPendingSessions(abandoned.projectId, expiredBefore, sweptAt)

    await expect(
      activeStartup.repo.findSession(activeStartup.projectId, activeStartup.sessionId),
    ).resolves.toMatchObject({ state: 'pending', activeTurnId: 'startup_live' })
    await expect(
      recentlyReopened.repo.findSession(recentlyReopened.projectId, recentlyReopened.sessionId),
    ).resolves.toMatchObject({ state: 'pending', startedAt: '2026-09-03T00:55:00.000Z' })
    await expect(abandoned.repo.findSession(abandoned.projectId, abandoned.sessionId)).resolves.toMatchObject({
      state: 'error',
      stateReason: 'Session runtime startup timed out',
    })
  })

  it('[spec: sessions/close] lets the startup lease atomically fence close until expiry', async () => {
    const seeded = await seedPendingSession({ runtime: 'ama' })
    const startupId = id('startup')
    await seeded.repo.acquirePendingStartupLease(
      seeded.projectId,
      seeded.sessionId,
      null,
      startupId,
      '2026-09-03T00:05:00.000Z',
      timestamp,
    )
    await seeded.repo.completeCloudSessionStart(
      seeded.projectId,
      seeded.sessionId,
      null,
      startupId,
      {
        state: 'idle',
        sandboxId: seeded.sandboxId,
        activeTurnId: 'startup_lease',
        turnLeaseExpiresAt: '2026-09-03T00:05:00.000Z',
        updatedAt: timestamp,
      },
      { runtimeBackend: 'ama-cloud' },
    )

    await expect(
      seeded.repo.claimSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        'cleanup_1',
        '2026-09-03T00:10:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.claimSessionClose(
        seeded.projectId,
        seeded.sessionId,
        'wrong_sandbox',
        'cleanup_1',
        '2026-09-03T00:10:00.000Z',
        '2026-09-03T00:06:00.000Z',
      ),
    ).resolves.toBe(false)
    await env.DB.prepare('UPDATE sessions SET turn_lease_expires_at = ? WHERE id = ?')
      .bind('2026-09-02T23:59:00.000Z', seeded.sessionId)
      .run()

    await expect(
      seeded.repo.claimSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        'cleanup_1',
        '2026-09-03T00:10:00.000Z',
        '2026-09-03T00:06:00.000Z',
      ),
    ).resolves.toBe(true)
    await expect(seeded.repo.findSession(seeded.projectId, seeded.sessionId)).resolves.toMatchObject({
      state: 'closed',
      stateReason: 'closing',
      closedAt: null,
    })
    await expect(
      seeded.repo.leakedSandboxSessions(['closed', 'error'], 20, '2026-09-03T00:00:00.000Z'),
    ).resolves.not.toContainEqual(expect.objectContaining({ id: seeded.sessionId }))
    await expect(
      seeded.repo.completeSessionClose(
        seeded.projectId,
        seeded.sessionId,
        'wrong_sandbox',
        'cleanup_1',
        '2026-09-03T00:07:00.000Z',
      ),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.completeSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        'cleanup_1',
        '2026-09-03T00:07:00.000Z',
      ),
    ).resolves.toBe(true)
    await expect(seeded.repo.findSession(seeded.projectId, seeded.sessionId)).resolves.toMatchObject({
      state: 'closed',
      stateReason: null,
      sandboxId: seeded.sandboxId,
      closedAt: '2026-09-03T00:07:00.000Z',
      metadata: JSON.stringify({
        runtime: 'ama',
        runtimeBackend: 'ama-cloud',
        sandboxDestroyedAt: '2026-09-03T00:07:00.000Z',
      }),
    })
  })

  it('[spec: sessions/close] stamps only the exact terminal sandbox without overwriting current metadata', async () => {
    const seeded = await seedPendingSession({ original: true })
    const currentMetadata = { original: true, concurrentField: 'preserved' }
    await env.DB.prepare("UPDATE sessions SET state = 'error', metadata = ? WHERE id = ?")
      .bind(JSON.stringify(currentMetadata), seeded.sessionId)
      .run()

    await expect(
      seeded.repo.claimSandboxCleanup(
        seeded.sessionId,
        seeded.sandboxId,
        'cleanup_1',
        '2026-09-03T00:10:00.000Z',
        '2026-09-03T00:07:00.000Z',
      ),
    ).resolves.toBe(true)
    await expect(
      seeded.repo.stampSandboxDestroyed(seeded.sessionId, 'wrong_sandbox', 'cleanup_1', '2026-09-03T00:08:00.000Z'),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.stampSandboxDestroyed(seeded.sessionId, seeded.sandboxId, 'cleanup_1', '2026-09-03T00:08:00.000Z'),
    ).resolves.toBe(true)
    await expect(
      seeded.repo.stampSandboxDestroyed(seeded.sessionId, seeded.sandboxId, 'cleanup_1', '2026-09-03T00:09:00.000Z'),
    ).resolves.toBe(false)

    const stamped = await seeded.repo.findSession(seeded.projectId, seeded.sessionId)
    expect(JSON.parse(stamped?.metadata ?? '{}')).toEqual({
      ...currentMetadata,
      sandboxDestroyedAt: '2026-09-03T00:08:00.000Z',
    })
  })

  it('[spec: runtime/idle-retention] lets one approval atomically acquire idle and fence duplicate approval and close', async () => {
    const seeded = await seedPendingSession({ runtime: 'ama' })
    await env.DB.prepare("UPDATE sessions SET state = 'idle' WHERE id = ?").bind(seeded.sessionId).run()

    await expect(
      seeded.repo.acquireIdleTurnLease(
        seeded.projectId,
        seeded.sessionId,
        'approval_turn_1',
        '2026-09-03T00:05:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(true)
    await expect(
      seeded.repo.acquireIdleTurnLease(
        seeded.projectId,
        seeded.sessionId,
        'approval_turn_2',
        '2026-09-03T00:05:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.claimSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        'cleanup_1',
        '2026-09-03T00:10:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(false)
    await expect(seeded.repo.findSession(seeded.projectId, seeded.sessionId)).resolves.toMatchObject({
      state: 'running',
      activeTurnId: 'approval_turn_1',
      sandboxId: seeded.sandboxId,
    })
  })

  it('[spec: sessions/close] fences late startup writes across close, finalize, and reopen generations', async () => {
    const seeded = await seedPendingSession({ retained: true })
    const oldStartupId = id('startup')
    await expect(
      seeded.repo.acquirePendingStartupLease(
        seeded.projectId,
        seeded.sessionId,
        null,
        oldStartupId,
        '2026-09-03T00:01:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(true)

    const cleanupId = id('cleanup')
    await expect(
      seeded.repo.claimSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        cleanupId,
        '2026-09-03T00:10:00.000Z',
        '2026-09-03T00:02:00.000Z',
      ),
    ).resolves.toBe(true)
    await expect(
      seeded.repo.completeSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        cleanupId,
        '2026-09-03T00:03:00.000Z',
      ),
    ).resolves.toBe(true)

    const newStartedAt = '2026-09-03T00:04:00.000Z'
    await expect(
      seeded.repo.claimSessionReopen(seeded.projectId, seeded.sessionId, seeded.sandboxId, newStartedAt),
    ).resolves.toBe(true)
    await expect(
      seeded.repo.completeCloudSessionStart(
        seeded.projectId,
        seeded.sessionId,
        null,
        oldStartupId,
        { state: 'running', updatedAt: '2026-09-03T00:05:00.000Z' },
        { staleCompletion: true },
      ),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.failCloudSessionStart(
        seeded.projectId,
        seeded.sessionId,
        null,
        oldStartupId,
        { state: 'error', updatedAt: '2026-09-03T00:05:00.000Z' },
        { staleFailure: true },
      ),
    ).resolves.toBe(false)

    const reopened = await seeded.repo.findSession(seeded.projectId, seeded.sessionId)
    expect(reopened).toMatchObject({ state: 'pending', startedAt: newStartedAt, sandboxId: seeded.sandboxId })
    expect(JSON.parse(reopened?.metadata ?? '{}')).toEqual({ retained: true })

    const newStartupId = id('startup')
    await seeded.repo.acquirePendingStartupLease(
      seeded.projectId,
      seeded.sessionId,
      newStartedAt,
      newStartupId,
      '2026-09-03T00:07:00.000Z',
      '2026-09-03T00:05:00.000Z',
    )
    await seeded.repo.failCloudSessionStart(
      seeded.projectId,
      seeded.sessionId,
      newStartedAt,
      newStartupId,
      { state: 'error', updatedAt: '2026-09-03T00:06:00.000Z' },
      { currentFailure: true },
    )
    await expect(
      seeded.repo.leakedSandboxSessions(['closed', 'error'], 20, '2026-09-03T00:10:00.000Z'),
    ).resolves.toContainEqual(expect.objectContaining({ id: seeded.sessionId, sandboxId: seeded.sandboxId }))
  })

  it('[spec: sessions/close] gives one cleanup owner the sandbox and lets watchdog take over a stale close', async () => {
    const seeded = await seedPendingSession({ retained: true })
    const explicitCleanupId = id('cleanup')
    await expect(
      seeded.repo.claimSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        explicitCleanupId,
        '2026-09-03T00:02:00.000Z',
        timestamp,
      ),
    ).resolves.toBe(true)

    await expect(
      seeded.repo.claimSandboxCleanup(
        seeded.sessionId,
        seeded.sandboxId,
        'watchdog_early',
        '2026-09-03T00:03:00.000Z',
        '2026-09-03T00:01:00.000Z',
      ),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.leakedSandboxSessions(['closed', 'error'], 20, '2026-09-02T23:59:00.000Z'),
    ).resolves.not.toContainEqual(expect.objectContaining({ id: seeded.sessionId }))

    const watchdogCleanupId = id('cleanup')
    await expect(
      seeded.repo.leakedSandboxSessions(['closed', 'error'], 20, '2026-09-03T00:04:00.000Z'),
    ).resolves.toContainEqual(expect.objectContaining({ id: seeded.sessionId, sandboxId: seeded.sandboxId }))
    await expect(
      seeded.repo.claimSandboxCleanup(
        seeded.sessionId,
        seeded.sandboxId,
        watchdogCleanupId,
        '2026-09-03T00:06:00.000Z',
        '2026-09-03T00:04:00.000Z',
      ),
    ).resolves.toBe(true)
    await expect(
      seeded.repo.completeSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        explicitCleanupId,
        '2026-09-03T00:05:00.000Z',
      ),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.failSessionClose(
        seeded.projectId,
        seeded.sessionId,
        seeded.sandboxId,
        explicitCleanupId,
        'stale explicit close failure',
        '2026-09-03T00:05:00.000Z',
      ),
    ).resolves.toBe(false)
    await expect(
      seeded.repo.stampSandboxDestroyed(
        seeded.sessionId,
        seeded.sandboxId,
        watchdogCleanupId,
        '2026-09-03T00:05:00.000Z',
      ),
    ).resolves.toBe(true)
    await expect(seeded.repo.findSession(seeded.projectId, seeded.sessionId)).resolves.toMatchObject({
      state: 'closed',
      stateReason: null,
      closedAt: '2026-09-03T00:05:00.000Z',
      activeTurnId: null,
      turnLeaseExpiresAt: null,
    })
  })
})
