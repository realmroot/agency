import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { createLeaseRepo } from '@server/adapters/repos/leases'
import { createRunnerRepo } from '@server/adapters/repos/runners'
import { createRuntimeOrchestrationRepoFromBinding } from '@server/adapters/repos/runtime-orchestration'
import { createDb } from '@server/db/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { asRunnerAuthorization, dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn } from './auth'

const DEFAULT_ENBOR_RUNNER_CAPABILITY = 'enbor'
const EMPTY_PACKAGES = { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], webi: [] } as const

function createResourceBody(metadata: { name: string; description?: string }, spec: Record<string, unknown> = {}) {
  return { metadata, spec }
}

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...dpopHeaders(authorization, init.method ?? 'GET', path),
      ...init.headers,
    },
  })
}

async function runnerJsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await jsonFetch(path, asRunnerAuthorization(authorization), init)
}

async function createSelfHostedEnvironment(authorization: string) {
  const res = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify(
      createResourceBody(
        {
          name: `Self-hosted workspace ${crypto.randomUUID()}`,
        },
        {
          type: 'self_hosted',
          networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true },
          packages: EMPTY_PACKAGES,
        },
      ),
    ),
  })
  expect(res.status).toBe(201)
  const environment = (await res.json()) as { metadata: { uid: string } }
  return { id: environment.metadata.uid }
}

async function createAgent(authorization: string) {
  const res = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    body: JSON.stringify(
      createResourceBody(
        {
          name: `Runner-backed agent ${crypto.randomUUID()}`,
        },
        {
          systemPrompt: 'Use Enbor-owned self-hosted runner work.',
          allowedTools: ['bash'],
          provider: 'workers-ai',
          model: '@cf/moonshotai/kimi-k2.6',
        },
      ),
    ),
  })
  expect(res.status).toBe(201)
  const agent = (await res.json()) as { metadata: { uid: string } }
  return { id: agent.metadata.uid }
}

async function createSessionEnvFrom(authorization: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify(createResourceBody({ name: `Runner runtime secrets ${crypto.randomUUID()}` })),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { metadata: { uid: string } }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.metadata.uid}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Downstream agent session key',
      type: 'opaque',
      secret: { stringData: { value: 'raw-downstream-agent-key' } },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const credential = (await credentialRes.json()) as { status: { activeVersion: { spec: { secretRef: string } } } }
  return [{ type: 'secret', name: 'DOWNSTREAM_AGENT_KEY', secretRef: credential.status.activeVersion.spec.secretRef }]
}

async function createSelfHostedSession(
  authorization: string,
  agentId: string,
  environmentId: string,
  executionOverrides: Record<string, unknown> = {},
) {
  const res = await jsonFetch('/api/v1/sessions', authorization, {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Run the first queued self-hosted task.',
      spec: {
        agentId,
        environmentId,
        runtime: 'enbor',
        ...executionOverrides,
      },
    }),
  })
  const body = await res.clone().text()
  expect(res.status, body).toBe(201)
  const session = (await res.json()) as { metadata: { uid: string }; status: { phase: string; reason: string | null } }
  return {
    ...session,
    id: session.metadata.uid,
    state: session.status.phase,
    stateReason: session.status.reason,
  }
}

async function registerActiveRunner(
  authorization: string,
  environmentId: string,
  options: { runtimeNames?: string[]; maxConcurrent?: number } = {},
) {
  const runtimeNames = options.runtimeNames ?? [DEFAULT_ENBOR_RUNNER_CAPABILITY]
  const runnerAuthorization = asRunnerAuthorization(authorization)
  const runnerRes = await jsonFetch('/api/v1/runners', runnerAuthorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Lease runner ${crypto.randomUUID()}`,
      environmentId,
      maxConcurrent: options.maxConcurrent ?? 2,
    }),
  })
  expect(runnerRes.status).toBe(201)
  const runner = (await runnerRes.json()) as { id: string }
  const heartbeatRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, runnerAuthorization, {
    method: 'PUT',
    body: JSON.stringify({
      state: 'active',
      runtimes: runtimeNames.map((runtime) => ({
        runtime,
        models: ['@cf/moonshotai/kimi-k2.6'],
        state: 'ready',
      })),
    }),
  })
  expect(heartbeatRes.status).toBe(200)
  return runner
}

async function availableWorkItem(authorization: string, sessionId: string) {
  const res = await jsonFetch(`/api/v1/work-items?state=available&sessionId=${sessionId}`, authorization)
  expect(res.status).toBe(200)
  const list = (await res.json()) as { data: Array<{ id: string }> }
  expect(list.data.length).toBeGreaterThan(0)
  return list.data[0]
}

async function claimLease(authorization: string, workItemId: string, runnerId: string, leaseDurationSeconds = 90) {
  return await jsonFetch('/api/v1/leases', asRunnerAuthorization(authorization), {
    method: 'POST',
    body: JSON.stringify({ workItemId, runnerId, leaseDurationSeconds }),
  })
}

describe('[CF] /api/v1/leases', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  it('claims a specific work item, opens the channel, renews, and completes the lease [spec: runners/lease-claim]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const envFrom = await createSessionEnvFrom(authorization)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, {
      env: { DOWNSTREAM_API_URL: 'https://downstream.example.test' },
      envFrom,
    })

    const workItem = await availableWorkItem(authorization, session.id)
    const operatorClaimRes = await jsonFetch('/api/v1/leases', authorization, {
      method: 'POST',
      body: JSON.stringify({ workItemId: workItem.id, runnerId: runner.id, leaseDurationSeconds: 90 }),
    })
    expect(operatorClaimRes.status).toBe(403)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as Record<string, unknown>
    expect(lease).toMatchObject({
      workItemId: workItem.id,
      runnerId: runner.id,
      state: 'active',
      expiresAt: expect.any(String),
      renewedAt: null,
      resumeToken: null,
    })
    // The lease no longer embeds the work item: details come from /work-items.
    expect(lease.workItem).toBeUndefined()
    const leaseId = lease.id as string
    const sessionProject = await env.DB.prepare('SELECT project_id FROM sessions WHERE id = ?')
      .bind(session.id)
      .first<{ project_id: string }>()

    const stalePendingClose = await createRuntimeOrchestrationRepoFromBinding(env.DB).updateSessionWhenState(
      sessionProject!.project_id,
      session.id,
      'pending',
      {
        state: 'closed',
        stateReason: 'closing',
        closedAt: null,
        updatedAt: new Date().toISOString(),
      },
    )
    expect(stalePendingClose).toBe(false)
    await expect(
      runnerJsonFetch(`/api/v1/leases/${leaseId}`, authorization).then((response) => response.json()),
    ).resolves.toMatchObject({
      id: leaseId,
      state: 'active',
    })

    const reservedRunnerDeleteRes = await jsonFetch(`/api/v1/runners/${runner.id}`, authorization, {
      method: 'DELETE',
    })
    expect(reservedRunnerDeleteRes.status).toBe(409)

    const operatorRenewRes = await jsonFetch(`/api/v1/leases/${leaseId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ leaseDurationSeconds: 120 }),
    })
    expect(operatorRenewRes.status).toBe(403)

    const runningSessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    expect(runningSessionRes.status).toBe(200)
    await expect(runningSessionRes.json()).resolves.toMatchObject({
      metadata: { uid: session.id },
      status: { phase: 'running', reason: null, startedAt: expect.any(String) },
    })

    const leasedWorkRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    expect(leasedWorkRes.status).toBe(200)
    const leasedWork = (await leasedWorkRes.json()) as {
      state: string
      attempts: number
      leaseId: string
      runnerId: string
      payload: { env?: Record<string, string>; envFrom?: unknown[] }
    }
    expect(leasedWork).toMatchObject({ state: 'leased', attempts: 1, leaseId, runnerId: runner.id })
    // Console reads retain persisted secret references even while a runner
    // holds the active lease; only the bound runner identity may materialize.
    expect(leasedWork.payload.env).toEqual({ DOWNSTREAM_API_URL: 'https://downstream.example.test' })
    expect(leasedWork.payload.envFrom).toEqual(envFrom)
    expect(JSON.stringify(leasedWork)).not.toContain('raw-downstream-agent-key')

    // The same item cannot be claimed twice.
    const conflictRes = await claimLease(authorization, workItem.id, runner.id)
    expect(conflictRes.status).toBe(409)

    const renewRes = await runnerJsonFetch(`/api/v1/leases/${leaseId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ leaseDurationSeconds: 120 }),
    })
    expect(renewRes.status).toBe(200)
    await expect(renewRes.json()).resolves.toMatchObject({
      id: leaseId,
      state: 'active',
      renewedAt: expect.any(String),
    })

    const explicitExpiry = new Date(Date.now() + 120_000).toISOString()
    const renewByExpiryRes = await runnerJsonFetch(`/api/v1/leases/${leaseId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ expiresAt: explicitExpiry }),
    })
    expect(renewByExpiryRes.status).toBe(200)
    await expect(renewByExpiryRes.json()).resolves.toMatchObject({ id: leaseId, expiresAt: explicitExpiry })

    const completeRes = await runnerJsonFetch(`/api/v1/leases/${leaseId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(200)
    const completedLease = (await completeRes.json()) as Record<string, unknown>
    expect(completedLease).toMatchObject({ id: leaseId, state: 'completed' })
    // Outcomes land on the work item, not the lease.
    expect(completedLease.result).toBeUndefined()

    const succeededWorkRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    await expect(succeededWorkRes.json()).resolves.toMatchObject({
      id: workItem.id,
      state: 'succeeded',
      result: { ok: true },
    })

    const completedSessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(completedSessionRes.json()).resolves.toMatchObject({
      metadata: { uid: session.id },
      status: { phase: 'idle', reason: null },
    })
  })

  it('rolls back the complete transition when releasing runner load fails [issue #158]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const memoryStoreRes = await jsonFetch('/api/v1/memory-stores', authorization, {
      method: 'POST',
      body: JSON.stringify(createResourceBody({ name: `Atomic rollback memory ${crypto.randomUUID()}` })),
    })
    expect(memoryStoreRes.status).toBe(201)
    const memoryStore = (await memoryStoreRes.json()) as { metadata: { uid: string } }
    const memoryStoreId = memoryStore.metadata.uid
    const memoryPath = 'atomic-rollback.md'
    const memoryRes = await jsonFetch(`/api/v1/memory-stores/${memoryStoreId}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: memoryPath, content: 'original memory\n' }),
    })
    expect(memoryRes.status).toBe(201)
    const runner = await registerActiveRunner(authorization, environment.id, { runtimeNames: ['codex'] })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, {
      runtime: 'codex',
      volumes: [{ name: 'memory', type: 'memory', memoryRef: `enbor://memories/${memoryStoreId}` }],
      volumeMounts: [
        { name: 'memory', mountPath: `/workspace/.enbor/memory-stores/${memoryStoreId}`, readOnly: false },
      ],
    })
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const readState = async () => ({
      workItem: await env.DB.prepare('SELECT state, runner_id, lease_id, result, error FROM work_items WHERE id = ?')
        .bind(workItem.id)
        .first(),
      lease: await env.DB.prepare('SELECT state, resume_token FROM leases WHERE id = ?').bind(lease.id).first(),
      runner: await env.DB.prepare('SELECT current_load FROM runners WHERE id = ?').bind(runner.id).first(),
      session: await env.DB.prepare('SELECT state, state_reason, resume_token FROM sessions WHERE id = ?')
        .bind(session.id)
        .first(),
      memories: (
        await env.DB.prepare(
          'SELECT path, content, deleted_at FROM memory_store_memories WHERE store_id = ? ORDER BY id',
        )
          .bind(memoryStoreId)
          .all()
      ).results,
    })
    const before = await readState()
    expect(before).toEqual({
      workItem: { state: 'leased', runner_id: runner.id, lease_id: lease.id, result: null, error: null },
      lease: { state: 'active', resume_token: null },
      runner: { current_load: 1 },
      session: { state: 'running', state_reason: null, resume_token: null },
      memories: [{ path: memoryPath, content: 'original memory\n', deleted_at: null }],
    })

    const triggerName = 'issue_158_abort_target_runner_update'
    await env.DB.prepare(`DROP TRIGGER IF EXISTS ${triggerName}`).run()
    await env.DB.prepare(
      `CREATE TRIGGER ${triggerName}
       BEFORE UPDATE ON runners
       WHEN OLD.id = '${runner.id}'
       BEGIN
         SELECT RAISE(ABORT, 'issue 158 injected runner update failure');
       END`,
    ).run()
    try {
      let patchFailed = false
      try {
        const finishRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
          method: 'PATCH',
          body: JSON.stringify({
            state: 'completed',
            resumeToken: 'codex-thread-rollback',
            result: {
              ok: true,
              memoryStores: [
                {
                  memoryRef: `enbor://memories/${memoryStoreId}`,
                  memories: [{ path: memoryPath, content: 'replacement memory\n' }],
                },
              ],
            },
          }),
        })
        patchFailed = !finishRes.ok
      } catch {
        patchFailed = true
      }

      expect(patchFailed).toBe(true)
      await expect(readState()).resolves.toEqual(before)
    } finally {
      await env.DB.prepare(`DROP TRIGGER IF EXISTS ${triggerName}`).run()
    }
  })

  it('does not partially finish a lease at its expiry timestamp [spec: runners/lease-lifecycle]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const memoryStoreRes = await jsonFetch('/api/v1/memory-stores', authorization, {
      method: 'POST',
      body: JSON.stringify(createResourceBody({ name: `Expiry fence memory ${crypto.randomUUID()}` })),
    })
    expect(memoryStoreRes.status).toBe(201)
    const memoryStore = (await memoryStoreRes.json()) as { metadata: { uid: string } }
    const memoryStoreId = memoryStore.metadata.uid
    const memoryPath = 'expiry-fence.md'
    const memoryRes = await jsonFetch(`/api/v1/memory-stores/${memoryStoreId}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: memoryPath, content: 'before expiry\n' }),
    })
    expect(memoryRes.status).toBe(201)
    const runner = await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, {
      volumes: [{ name: 'memory', type: 'memory', memoryRef: `enbor://memories/${memoryStoreId}` }],
      volumeMounts: [
        { name: 'memory', mountPath: `/workspace/.enbor/memory-stores/${memoryStoreId}`, readOnly: false },
      ],
    })
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string; expiresAt: string }
    const scope = await env.DB.prepare('SELECT organization_id, project_id FROM work_items WHERE id = ?')
      .bind(workItem.id)
      .first<{ organization_id: string; project_id: string }>()
    expect(scope).not.toBeNull()

    const before = {
      workItem: await env.DB.prepare('SELECT state, result, error FROM work_items WHERE id = ?')
        .bind(workItem.id)
        .first(),
      lease: await env.DB.prepare('SELECT state FROM leases WHERE id = ?').bind(lease.id).first(),
      runner: await env.DB.prepare('SELECT current_load FROM runners WHERE id = ?').bind(runner.id).first(),
      session: await env.DB.prepare('SELECT state, state_reason FROM sessions WHERE id = ?').bind(session.id).first(),
      memories: (
        await env.DB.prepare(
          'SELECT path, content, deleted_at FROM memory_store_memories WHERE store_id = ? ORDER BY id',
        )
          .bind(memoryStoreId)
          .all()
      ).results,
    }
    expect(before).toEqual({
      workItem: { state: 'leased', result: null, error: null },
      lease: { state: 'active' },
      runner: { current_load: 1 },
      session: { state: 'running', state_reason: null },
      memories: [{ path: memoryPath, content: 'before expiry\n', deleted_at: null }],
    })

    const finished = await createLeaseRepo(createDb(env)).finish(
      {
        organizationId: scope!.organization_id,
        projectId: scope!.project_id,
        leaseId: lease.id,
        state: 'completed',
        result: {
          ok: true,
          memoryStores: [
            {
              memoryRef: `enbor://memories/${memoryStoreId}`,
              memories: [{ path: memoryPath, content: 'after expiry\n' }],
            },
          ],
        },
      },
      lease.expiresAt,
    )

    expect(finished).toBeNull()
    await expect(
      Promise.all([
        env.DB.prepare('SELECT state, result, error FROM work_items WHERE id = ?').bind(workItem.id).first(),
        env.DB.prepare('SELECT state FROM leases WHERE id = ?').bind(lease.id).first(),
        env.DB.prepare('SELECT current_load FROM runners WHERE id = ?').bind(runner.id).first(),
        env.DB.prepare('SELECT state, state_reason FROM sessions WHERE id = ?').bind(session.id).first(),
        env.DB.prepare('SELECT path, content, deleted_at FROM memory_store_memories WHERE store_id = ? ORDER BY id')
          .bind(memoryStoreId)
          .all()
          .then((result) => result.results),
      ]),
    ).resolves.toEqual([before.workItem, before.lease, before.runner, before.session, before.memories])
  })

  it('[spec: runners/heartbeat-load-recovery] preserves max capacity across concurrent claims and heartbeat repair', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id, { maxConcurrent: 1 })
    const firstSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const secondSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const firstWorkItem = await availableWorkItem(authorization, firstSession.id)
    const secondWorkItem = await availableWorkItem(authorization, secondSession.id)
    const scope = await env.DB.prepare('SELECT organization_id, project_id FROM work_items WHERE id = ?')
      .bind(firstWorkItem.id)
      .first<{ organization_id: string; project_id: string }>()
    expect(scope).not.toBeNull()

    const db = createDb(env)
    const leases = createLeaseRepo(db)
    const runners = createRunnerRepo(db)
    const timestamp = new Date().toISOString()
    const [firstClaim, _heartbeat, secondClaim] = await Promise.all([
      leases.claim(
        {
          organizationId: scope!.organization_id,
          projectId: scope!.project_id,
          workItemId: firstWorkItem.id,
          runnerId: runner.id,
          leaseDurationSeconds: 90,
        },
        timestamp,
      ),
      runners.heartbeat(
        scope!.project_id,
        runner.id,
        {
          state: 'active',
          runtimeUsage: [],
          runtimes: [
            {
              runtime: DEFAULT_ENBOR_RUNNER_CAPABILITY,
              models: ['@cf/moonshotai/kimi-k2.6'],
              state: 'ready',
            },
          ],
          metadata: {},
        },
        timestamp,
      ),
      leases.claim(
        {
          organizationId: scope!.organization_id,
          projectId: scope!.project_id,
          workItemId: secondWorkItem.id,
          runnerId: runner.id,
          leaseDurationSeconds: 90,
        },
        timestamp,
      ),
    ])

    const claims = [firstClaim, secondClaim]
    expect(claims.filter((claim) => typeof claim === 'object')).toHaveLength(1)
    expect(claims.filter((claim) => claim === 'at_capacity')).toHaveLength(1)
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM leases WHERE runner_id = ? AND state = 'active'")
        .bind(runner.id)
        .first(),
    ).resolves.toEqual({ count: 1 })
    await expect(
      env.DB.prepare('SELECT current_load FROM runners WHERE id = ?').bind(runner.id).first(),
    ).resolves.toEqual({ current_load: 1 })
  })

  it('decrements runner load once when duplicate terminal finishes share a timestamp [issue #158]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id, {
      maxConcurrent: 2,
      runtimeNames: ['codex'],
    })
    const firstSession = await createSelfHostedSession(authorization, agent.id, environment.id, { runtime: 'codex' })
    const secondSession = await createSelfHostedSession(authorization, agent.id, environment.id, { runtime: 'codex' })
    const firstWorkItem = await availableWorkItem(authorization, firstSession.id)
    const secondWorkItem = await availableWorkItem(authorization, secondSession.id)
    const firstClaim = await claimLease(authorization, firstWorkItem.id, runner.id)
    const secondClaim = await claimLease(authorization, secondWorkItem.id, runner.id)
    expect(firstClaim.status).toBe(201)
    expect(secondClaim.status).toBe(201)
    const firstLease = (await firstClaim.json()) as { id: string }
    const secondLease = (await secondClaim.json()) as { id: string }
    const scope = await env.DB.prepare('SELECT organization_id, project_id FROM work_items WHERE id = ?')
      .bind(firstWorkItem.id)
      .first<{ organization_id: string; project_id: string }>()
    expect(scope).not.toBeNull()

    const repo = createLeaseRepo(createDb(env))
    const timestamp = new Date().toISOString()
    const input = {
      organizationId: scope!.organization_id,
      projectId: scope!.project_id,
      leaseId: firstLease.id,
      state: 'completed' as const,
    }
    const winner = await repo.finish({ ...input, result: { ok: true } }, timestamp)
    const loser = await repo.finish({ ...input, resumeToken: 'codex-thread-loser', result: { ok: false } }, timestamp)

    expect(winner).toMatchObject({ id: firstLease.id, state: 'completed', resumeToken: null })
    expect(loser).toBeNull()
    await expect(
      env.DB.prepare('SELECT current_load FROM runners WHERE id = ?').bind(runner.id).first(),
    ).resolves.toEqual({ current_load: 1 })
    await expect(
      env.DB.prepare('SELECT id, state, resume_token, settlement_id FROM leases WHERE id IN (?, ?) ORDER BY id')
        .bind(firstLease.id, secondLease.id)
        .all(),
    ).resolves.toMatchObject({
      results: expect.arrayContaining([
        {
          id: firstLease.id,
          state: 'completed',
          resume_token: null,
          settlement_id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        },
        { id: secondLease.id, state: 'active', resume_token: null, settlement_id: null },
      ]),
    })
    await expect(
      env.DB.prepare('SELECT resume_token FROM sessions WHERE id = ?').bind(firstSession.id).first(),
    ).resolves.toEqual({ resume_token: null })
  })

  it('does not create an active lease after its Session is deleted or atomically marked closing', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const deletedSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const deletedWork = await availableWorkItem(authorization, deletedSession.id)
    await env.DB.prepare('UPDATE sessions SET deleted_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), deletedSession.id)
      .run()

    expect((await claimLease(authorization, deletedWork.id, runner.id)).status).toBe(409)
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM leases WHERE work_item_id = ? AND state = 'active'")
        .bind(deletedWork.id)
        .first(),
    ).resolves.toEqual({ count: 0 })

    const closingSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const closingWork = await availableWorkItem(authorization, closingSession.id)
    const closingProject = await env.DB.prepare('SELECT project_id FROM sessions WHERE id = ?')
      .bind(closingSession.id)
      .first<{ project_id: string }>()
    await expect(
      createRuntimeOrchestrationRepoFromBinding(env.DB).updateSessionWhenState(
        closingProject!.project_id,
        closingSession.id,
        'pending',
        {
          state: 'closed',
          stateReason: 'closing',
          closedAt: null,
          updatedAt: new Date().toISOString(),
        },
      ),
    ).resolves.toBe(true)

    expect((await claimLease(authorization, closingWork.id, runner.id)).status).toBe(409)
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM leases WHERE work_item_id = ? AND state = 'active'")
        .bind(closingWork.id)
        .first(),
    ).resolves.toEqual({ count: 0 })
  })

  it('syncs writable memory store snapshots when self-hosted work completes', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const memoryStoreRes = await jsonFetch('/api/v1/memory-stores', authorization, {
      method: 'POST',
      body: JSON.stringify(createResourceBody({ name: `Maintainer memory ${crypto.randomUUID()}` })),
    })
    expect(memoryStoreRes.status).toBe(201)
    const memoryStore = (await memoryStoreRes.json()) as { metadata: { uid: string } }
    const memoryStoreId = memoryStore.metadata.uid
    const memoryRes = await jsonFetch(`/api/v1/memory-stores/${memoryStoreId}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: 'downstream-operator-heartbeat.md', content: 'initial heartbeat\n' }),
    })
    expect(memoryRes.status).toBe(201)
    const runner = await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, {
      volumes: [{ name: 'memory', type: 'memory', memoryRef: `enbor://memories/${memoryStoreId}` }],
      volumeMounts: [
        { name: 'memory', mountPath: `/workspace/.enbor/memory-stores/${memoryStoreId}`, readOnly: false },
      ],
    })
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const completeRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        state: 'completed',
        result: {
          exitCode: 0,
          memoryStores: [
            {
              memoryRef: `enbor://memories/${memoryStoreId}`,
              memories: [{ path: 'downstream-operator-heartbeat.md', content: 'updated heartbeat\n' }],
            },
          ],
        },
      }),
    })
    expect(completeRes.status).toBe(200)

    const memoriesRes = await jsonFetch(`/api/v1/memory-stores/${memoryStoreId}/memories`, authorization)
    expect(memoriesRes.status).toBe(200)
    await expect(memoriesRes.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          spec: expect.objectContaining({ path: 'downstream-operator-heartbeat.md', content: 'updated heartbeat\n' }),
        }),
      ],
    })
  })

  it('ignores snapshots for deleted memory stores when self-hosted work completes', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const memoryStoreRes = await jsonFetch('/api/v1/memory-stores', authorization, {
      method: 'POST',
      body: JSON.stringify(createResourceBody({ name: `Deleted maintainer memory ${crypto.randomUUID()}` })),
    })
    expect(memoryStoreRes.status).toBe(201)
    const memoryStore = (await memoryStoreRes.json()) as { metadata: { uid: string } }
    const memoryStoreId = memoryStore.metadata.uid
    const runner = await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, {
      volumes: [{ name: 'memory', type: 'memory', memoryRef: `enbor://memories/${memoryStoreId}` }],
      volumeMounts: [
        { name: 'memory', mountPath: `/workspace/.enbor/memory-stores/${memoryStoreId}`, readOnly: false },
      ],
    })
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const deleteRes = await jsonFetch(`/api/v1/memory-stores/${memoryStoreId}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)

    const completeRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        state: 'completed',
        result: {
          exitCode: 0,
          memoryStores: [
            {
              memoryRef: `enbor://memories/${memoryStoreId}`,
              memories: [{ path: 'downstream-operator-heartbeat.md', content: 'late heartbeat\n' }],
            },
          ],
        },
      }),
    })
    expect(completeRes.status).toBe(200)
    await expect(completeRes.json()).resolves.toMatchObject({ state: 'completed' })
  })

  it('queues a prompt on the same self-hosted session while its leased work item is still running', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const workItem = await availableWorkItem(authorization, session.id)

    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)

    const messageRes = await jsonFetch(`/api/v1/sessions/${session.id}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', content: 'Reviewer rejected this task; resume it.' }),
    })
    expect(messageRes.status).toBe(201)
    await expect(messageRes.json()).resolves.toMatchObject({
      sessionId: session.id,
      type: 'prompt',
      delivery: 'live',
      state: 'delivered',
    })

    const availableRes = await jsonFetch(`/api/v1/work-items?state=available&sessionId=${session.id}`, authorization)
    expect(availableRes.status).toBe(200)
    const available = (await availableRes.json()) as {
      data: Array<{ sessionId: string; state: string; payload: Record<string, unknown> }>
    }
    expect(available.data).toEqual([])
  })

  it('rejects claims for inactive runners, missing work, and over-capacity runners', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)

    const offlineRunnerRes = await runnerJsonFetch('/api/v1/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Offline runner',
        environmentId: environment.id,
      }),
    })
    const offlineRunner = (await offlineRunnerRes.json()) as { id: string }
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const workItem = await availableWorkItem(authorization, session.id)

    const inactiveClaimRes = await claimLease(authorization, workItem.id, offlineRunner.id)
    expect(inactiveClaimRes.status).toBe(409)
    await expect(inactiveClaimRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Runner is not active' },
    })

    const staleRunner = await registerActiveRunner(authorization, environment.id)
    await env.DB.prepare('UPDATE runners SET last_heartbeat_at = ? WHERE id = ?')
      .bind('2026-01-01T00:00:00.000Z', staleRunner.id)
      .run()
    const staleClaimRes = await claimLease(authorization, workItem.id, staleRunner.id)
    expect(staleClaimRes.status).toBe(409)
    await expect(staleClaimRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Runner is not active' },
    })

    const runner = await registerActiveRunner(authorization, environment.id, { maxConcurrent: 1 })
    const missingClaimRes = await claimLease(authorization, 'work_missing', runner.id)
    expect(missingClaimRes.status).toBe(404)

    const missingRunnerClaimRes = await claimLease(authorization, workItem.id, 'runner_missing')
    expect(missingRunnerClaimRes.status).toBe(404)

    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)

    const secondSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const secondWorkItem = await availableWorkItem(authorization, secondSession.id)
    const capacityClaimRes = await claimLease(authorization, secondWorkItem.id, runner.id)
    expect(capacityClaimRes.status).toBe(409)
    await expect(capacityClaimRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Runner is at capacity' },
    })
  })

  it('rejects claims when runner runtimes do not match the required runtime', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    // Queue the work before any runner exists so session creation does not gate
    // on runner eligibility; the capability mismatch is enforced at claim time.
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const runner = await registerActiveRunner(authorization, environment.id, { runtimeNames: ['node'] })
    const workItem = await availableWorkItem(authorization, session.id)

    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(409)
    await expect(claimRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Runner is not eligible for this work item' },
    })
  })

  it('does not auto-select an environment whose only active runner heartbeat is stale', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)

    await env.DB.prepare('UPDATE runners SET last_heartbeat_at = ? WHERE id = ?')
      .bind('2026-01-01T00:00:00.000Z', runner.id)
      .run()

    const sessionRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'Do not route this session to a crashed runner.',
        spec: { agentId: agent.id, runtime: 'enbor' },
      }),
    })
    expect(sessionRes.status).toBe(409)
    await expect(sessionRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: expect.stringContaining('No environment has an active runner') },
    })
  })

  it('requeues interrupted work with the bound target runtime session id [spec: runners/lease-recovery]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id, {
      runtimeNames: ['claude-code'],
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, { runtime: 'claude-code' })
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const renewRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'active', leaseDurationSeconds: 90, resumeToken: session.id }),
    })
    expect(renewRes.status).toBe(200)
    await expect(renewRes.json()).resolves.toMatchObject({ id: lease.id, resumeToken: session.id })

    const interruptRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'interrupted', resumeToken: session.id }),
    })
    expect(interruptRes.status).toBe(200)
    await expect(interruptRes.json()).resolves.toMatchObject({
      id: lease.id,
      state: 'expired',
      resumeToken: session.id,
    })

    const requeuedRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    const requeued = (await requeuedRes.json()) as {
      state: string
      payload: Record<string, unknown>
      runnerId: string | null
    }
    expect(requeued).toMatchObject({ state: 'available', runnerId: null })
    expect(requeued.payload).toMatchObject({ resume: true, resumeToken: session.id })

    const sessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(sessionRes.json()).resolves.toMatchObject({
      metadata: { uid: session.id },
      status: { phase: 'pending', reason: 'waiting-for-runner-recovery' },
    })

    const expiredStartupWindow = new Date(Date.now() - 10 * 60_000).toISOString()
    await env.DB.prepare('UPDATE sessions SET created_at = ? WHERE id = ?').bind(expiredStartupWindow, session.id).run()

    const sessionsRes = await jsonFetch('/api/v1/sessions', authorization)
    expect(sessionsRes.status).toBe(200)
    const sessions = (await sessionsRes.json()) as {
      data: Array<{ metadata: { uid: string }; status: { phase: string; reason: string | null } }>
    }
    expect(sessions.data).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ uid: session.id }),
        status: expect.objectContaining({ phase: 'pending', reason: 'waiting-for-runner-recovery' }),
      }),
    )

    const reclaimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(reclaimRes.status).toBe(201)
    const reclaimedLease = (await reclaimRes.json()) as { id: string }
    expect(reclaimedLease.id).not.toBe(lease.id)

    const runningSessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(runningSessionRes.json()).resolves.toMatchObject({
      metadata: { uid: session.id },
      status: { phase: 'running', reason: null },
    })

    const completeRes = await runnerJsonFetch(`/api/v1/leases/${reclaimedLease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(200)

    const completedSessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(completedSessionRes.json()).resolves.toMatchObject({
      metadata: { uid: session.id },
      status: { phase: 'idle', reason: null },
    })
  })

  it('rejects caller-assigned runtimes when their target session id differs from the Enbor session [spec: runners/session-runtime-binding]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id, {
      runtimeNames: ['claude-code'],
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, { runtime: 'claude-code' })
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const bindRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'active', leaseDurationSeconds: 90, resumeToken: session.id }),
    })
    expect(bindRes.status).toBe(200)
    await expect(bindRes.json()).resolves.toMatchObject({ id: lease.id, resumeToken: session.id })

    const conflictRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'active', leaseDurationSeconds: 90, resumeToken: 'runtime-session-2' }),
    })
    expect(conflictRes.status).toBe(409)
    await expect(conflictRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: `Runtime claude-code must use Enbor session ${session.id} as its resume token; got runtime-session-2`,
      },
    })

    const leaseRes = await jsonFetch(`/api/v1/leases/${lease.id}`, authorization)
    await expect(leaseRes.json()).resolves.toMatchObject({ id: lease.id, resumeToken: session.id })
    const workItemRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    await expect(workItemRes.json()).resolves.toMatchObject({
      id: workItem.id,
      payload: { resume: true, resumeToken: session.id },
    })
    const stored = await env.DB.prepare('SELECT resume_token FROM sessions WHERE id = ?')
      .bind(session.id)
      .first<{ resume_token: string | null }>()
    expect(stored).toEqual({ resume_token: null })
  })

  it('locks provider-assigned runtime session ids on the Enbor session [spec: runners/session-runtime-binding]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id, {
      runtimeNames: ['codex'],
    })
    const session = await createSelfHostedSession(authorization, agent.id, environment.id, { runtime: 'codex' })
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const bindRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'active', leaseDurationSeconds: 90, resumeToken: 'codex-thread-1' }),
    })
    expect(bindRes.status).toBe(200)
    await expect(bindRes.json()).resolves.toMatchObject({ id: lease.id, resumeToken: 'codex-thread-1' })

    const conflictRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'active', leaseDurationSeconds: 90, resumeToken: 'codex-thread-2' }),
    })
    expect(conflictRes.status).toBe(409)
    await expect(conflictRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: `Enbor session ${session.id} is already bound to resume token codex:codex-thread-1`,
      },
    })

    const stored = await env.DB.prepare('SELECT resume_token FROM sessions WHERE id = ?')
      .bind(session.id)
      .first<{ resume_token: string | null }>()
    expect(stored).toEqual({ resume_token: 'codex-thread-1' })
  })

  it('marks failed work and surfaces the error on the work item and session [spec: runners/lease-lifecycle]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const failRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'failed', error: { message: 'Command failed' } }),
    })
    expect(failRes.status).toBe(200)
    await expect(failRes.json()).resolves.toMatchObject({ id: lease.id, state: 'failed' })

    const failedWorkRes = await jsonFetch(`/api/v1/work-items/${workItem.id}`, authorization)
    await expect(failedWorkRes.json()).resolves.toMatchObject({
      id: workItem.id,
      state: 'failed',
      error: { message: 'Command failed' },
    })

    const sessionRes = await jsonFetch(`/api/v1/sessions/${session.id}`, authorization)
    await expect(sessionRes.json()).resolves.toMatchObject({
      metadata: { uid: session.id },
      status: { phase: 'error', reason: 'runner-failed' },
    })

    // A finished lease can no longer be renewed or completed again.
    const staleRenewRes = await runnerJsonFetch(`/api/v1/leases/${lease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ leaseDurationSeconds: 60 }),
    })
    expect(staleRenewRes.status).toBe(409)
  })

  it('returns expired leases to available work predictably', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent.id, environment.id)
    const workItem = await availableWorkItem(authorization, session.id)
    const claimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(claimRes.status).toBe(201)
    const lease = (await claimRes.json()) as { id: string }

    const expired = new Date(Date.now() - 60_000).toISOString()
    await env.DB.prepare('UPDATE leases SET expires_at = ? WHERE id = ?').bind(expired, lease.id).run()

    // Lease maintenance sweeps stale leases back to available work; work-item reads are passive.
    const sweptRes = await jsonFetch('/api/v1/leases', authorization)
    expect(sweptRes.status).toBe(200)
    const listRes = await jsonFetch(`/api/v1/work-items?sessionId=${session.id}`, authorization)
    const list = (await listRes.json()) as { data: Array<{ id: string; state: string }> }
    expect(list.data).toEqual([expect.objectContaining({ id: workItem.id, state: 'available' })])

    const expiredLeaseRes = await jsonFetch(`/api/v1/leases/${lease.id}`, authorization)
    expect(expiredLeaseRes.status).toBe(200)
    await expect(expiredLeaseRes.json()).resolves.toMatchObject({ id: lease.id, state: 'expired' })

    // The runner can claim the recovered work again.
    const reclaimRes = await claimLease(authorization, workItem.id, runner.id)
    expect(reclaimRes.status).toBe(201)
    const reclaimed = (await reclaimRes.json()) as { id: string }
    expect(reclaimed.id).not.toBe(lease.id)
  })

  it('filters lease lists by runner and state', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    const runner = await registerActiveRunner(authorization, environment.id)
    const otherRunner = await registerActiveRunner(authorization, environment.id)

    const firstSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const firstWorkItem = await availableWorkItem(authorization, firstSession.id)
    const firstClaim = await claimLease(authorization, firstWorkItem.id, runner.id)
    expect(firstClaim.status).toBe(201)
    const firstLease = (await firstClaim.json()) as { id: string }

    const secondSession = await createSelfHostedSession(authorization, agent.id, environment.id)
    const secondWorkItem = await availableWorkItem(authorization, secondSession.id)
    const secondClaim = await claimLease(authorization, secondWorkItem.id, otherRunner.id)
    expect(secondClaim.status).toBe(201)
    const secondLease = (await secondClaim.json()) as { id: string }

    const completeRes = await runnerJsonFetch(`/api/v1/leases/${secondLease.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(200)

    const runnerListRes = await jsonFetch(`/api/v1/leases?runnerId=${runner.id}`, authorization)
    const runnerList = (await runnerListRes.json()) as { data: Array<{ id: string }> }
    expect(runnerList.data.map((entry) => entry.id)).toEqual([firstLease.id])

    const activeListRes = await jsonFetch('/api/v1/leases?state=active', authorization)
    const activeList = (await activeListRes.json()) as { data: Array<{ id: string; state: string }> }
    expect(activeList.data.map((entry) => entry.id)).toContain(firstLease.id)
    expect(activeList.data.map((entry) => entry.id)).not.toContain(secondLease.id)

    const completedListRes = await jsonFetch(`/api/v1/leases?runnerId=${otherRunner.id}&state=completed`, authorization)
    const completedList = (await completedListRes.json()) as { data: Array<{ id: string; state: string }> }
    expect(completedList.data).toEqual([expect.objectContaining({ id: secondLease.id, state: 'completed' })])
  })
})
