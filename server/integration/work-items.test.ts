import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { asRunnerAuthorization, dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn } from './auth'
import { createIdentitySession, createReadyAgent, type ReadyAgent } from './v2-resources'

const DEFAULT_AMA_RUNNER_CAPABILITY = 'ama'
const EMPTY_PACKAGES = { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] } as const

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
  if (res.status !== 201) {
    throw new Error(`Session creation failed: ${res.status} ${await res.text()}`)
  }
  const environment = (await res.json()) as { metadata: { uid: string } }
  return { id: environment.metadata.uid }
}

async function createAgent(authorization: string) {
  const agent = await createReadyAgent(authorization, {
    name: `Runner-backed agent ${crypto.randomUUID()}`,
    systemPrompt: 'Use AMA-owned self-hosted runner work.',
  })
  return { ...agent, id: agent.metadata.uid }
}

async function createSelfHostedSession(
  authorization: string,
  agent: ReadyAgent,
  environmentId: string,
  executionOverrides: Record<string, unknown> = {},
) {
  void environmentId
  void executionOverrides
  const res = await createIdentitySession(authorization, agent, { prompt: 'Run the first queued self-hosted task.' })
  if (res.status !== 201) {
    throw new Error(`Session creation failed: ${res.status} ${await res.text()}`)
  }
  const session = (await res.json()) as {
    metadata: { uid: string }
    status: { phase: string; reason: string | null }
  }
  return { ...session, id: session.metadata.uid, state: session.status.phase, stateReason: session.status.reason }
}

async function registerActiveRunner(authorization: string, environmentId: string) {
  const runnerAuthorization = asRunnerAuthorization(authorization)
  const runnerRes = await jsonFetch('/api/v1/runners', runnerAuthorization, {
    method: 'POST',
    body: JSON.stringify({ name: `Bound runner ${crypto.randomUUID()}`, environmentId }),
  })
  expect(runnerRes.status).toBe(201)
  const runner = (await runnerRes.json()) as { id: string }
  const heartbeatRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, runnerAuthorization, {
    method: 'PUT',
    body: JSON.stringify({
      state: 'active',
      runtimes: [
        {
          runtime: DEFAULT_AMA_RUNNER_CAPABILITY,
          models: ['@cf/moonshotai/kimi-k2.6'],
          state: 'ready',
        },
      ],
    }),
  })
  expect(heartbeatRes.status).toBe(200)
  return runner
}

describe('[CF] /api/v1/work-items', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  it('lists queued session work with state filters and intact payload references [spec: runners/queue-work] [spec: runners/work-items]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent, environment.id)
    expect(session).toMatchObject({ state: 'pending', stateReason: 'waiting-for-runner' })

    const listRes = await jsonFetch(`/api/v1/work-items?sessionId=${session.id}`, authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      data: Array<Record<string, unknown>>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(list.data).toEqual([
      expect.objectContaining({
        state: 'available',
        sessionId: session.id,
        environmentId: environment.id,
        runnerId: null,
        leaseId: null,
        attempts: 0,
        payload: expect.objectContaining({
          type: 'session.start',
          sessionId: session.id,
          runtimeRequirement: { runtime: DEFAULT_AMA_RUNNER_CAPABILITY },
          envFrom: [],
          env: expect.objectContaining({ REALMROOT_STATE_DIR: '/workspace/.ama/realmroot-state' }),
        }),
      }),
    ])
    expect(list.data[0].organizationId).toBeUndefined()
    expect(JSON.stringify(list.data)).toContain('"type":"secret"')
    expect(list.pagination).toMatchObject({ limit: 50, hasMore: false, nextCursor: null })

    const availableRes = await jsonFetch(`/api/v1/work-items?sessionId=${session.id}&state=available`, authorization)
    const available = (await availableRes.json()) as { data: Array<{ id: string }> }
    expect(available.data).toHaveLength(1)

    const leasedRes = await jsonFetch(`/api/v1/work-items?sessionId=${session.id}&state=leased`, authorization)
    const leased = (await leasedRes.json()) as { data: Array<{ id: string }> }
    expect(leased.data).toHaveLength(0)

    const searchRes = await jsonFetch(`/api/v1/work-items?sessionId=${session.id}&search=session.start`, authorization)
    const searched = (await searchRes.json()) as { data: Array<{ id: string }> }
    expect(searched.data).toHaveLength(1)
  })

  it('reads a single work item and returns 404 for unknown ids', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization)
    const agent = await createAgent(authorization)
    await registerActiveRunner(authorization, environment.id)
    const session = await createSelfHostedSession(authorization, agent, environment.id)

    const listRes = await jsonFetch(`/api/v1/work-items?sessionId=${session.id}`, authorization)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    expect(list.data).toHaveLength(1)

    const readRes = await jsonFetch(`/api/v1/work-items/${list.data[0].id}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      id: list.data[0].id,
      state: 'available',
      sessionId: session.id,
    })

    const missingRes = await jsonFetch('/api/v1/work-items/work_missing', authorization)
    expect(missingRes.status).toBe(404)
    await expect(missingRes.json()).resolves.toMatchObject({
      error: { type: 'not_found', message: 'Work item not found' },
    })
  })

  it('lets runner tokens read the queue so they can pick work to claim', async () => {
    const operatorAuthorization = await signIn()
    const runnerAuthorization = asRunnerAuthorization(operatorAuthorization)
    const environment = await createSelfHostedEnvironment(operatorAuthorization)
    const agent = await createAgent(operatorAuthorization)

    await registerActiveRunner(runnerAuthorization, environment.id)

    const session = await createSelfHostedSession(operatorAuthorization, agent, environment.id)
    const listRes = await jsonFetch(`/api/v1/work-items?state=available&sessionId=${session.id}`, runnerAuthorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as { data: Array<{ id: string; state: string }> }
    expect(list.data).toEqual([expect.objectContaining({ state: 'available', sessionId: session.id })])
  })

  it('materializes secrets only for the OIDC-bound runner holding the active lease [spec: runners/work-items]', async () => {
    const operatorAuthorization = await signIn()
    const runnerAuthorization = asRunnerAuthorization(operatorAuthorization)
    const environment = await createSelfHostedEnvironment(operatorAuthorization)
    const agent = await createAgent(operatorAuthorization)
    const runner = await registerActiveRunner(runnerAuthorization, environment.id)
    const session = await createSelfHostedSession(operatorAuthorization, agent, environment.id)
    const listRes = await jsonFetch(`/api/v1/work-items?sessionId=${session.id}`, runnerAuthorization)
    const list = (await listRes.json()) as { data: Array<{ id: string }> }
    const workItemId = list.data[0]!.id

    const claimRes = await jsonFetch('/api/v1/leases', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ workItemId, runnerId: runner.id, leaseDurationSeconds: 90 }),
    })
    expect(claimRes.status).toBe(201)

    const consoleRead = await jsonFetch(`/api/v1/work-items/${workItemId}`, operatorAuthorization)
    expect(consoleRead.status).toBe(200)
    const consoleWork = (await consoleRead.json()) as { payload: Record<string, unknown> }
    expect(consoleWork.payload).toMatchObject({
      envFrom: [],
      env: { REALMROOT_STATE_DIR: '/workspace/.ama/realmroot-state' },
    })
    expect(JSON.stringify(consoleWork)).not.toContain('raw-ak-agent-key')

    const runnerRead = await jsonFetch(`/api/v1/work-items/${workItemId}`, runnerAuthorization)
    expect(runnerRead.status).toBe(200)
    const runnerWork = (await runnerRead.json()) as { payload: Record<string, unknown> }
    expect(runnerWork.payload).not.toHaveProperty('envFrom')
    expect(runnerWork.payload).toMatchObject({
      env: { REALMROOT_STATE_DIR: '/workspace/.ama/realmroot-state' },
      workspaceManifest: {
        mounts: [expect.objectContaining({ name: 'realmroot-agent-state', type: 'secret', readOnly: false })],
      },
    })
  })
})
