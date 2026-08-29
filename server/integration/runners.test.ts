import { SELF } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { asRunnerAuthorization, dpopHeaders, expectAuthRequired, setupOidcProvider, signIn, signInUser } from './auth'

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

async function createRunnerCredential(authorization: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify(createResourceBody({ name: `Runner credentials ${crypto.randomUUID()}` })),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { metadata: { uid: string } }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.metadata.uid}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Self-hosted runner token',
      type: 'opaque',
      secret: { stringData: { value: 'raw-runner-credential' } },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const credential = (await credentialRes.json()) as {
    metadata: { uid: string }
    status: { activeVersion: { metadata: { uid: string }; spec: { secretRef: string } } }
  }
  return {
    id: credential.metadata.uid,
    activeVersion: {
      id: credential.status.activeVersion.metadata.uid,
      secretRef: credential.status.activeVersion.spec.secretRef,
    },
  }
}

describe('[CF] /api/v1/runners', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  it('registers a runner with a vault secret ref and serves the heartbeat singleton [spec: runners/heartbeat]', async () => {
    const authorization = await signIn()
    const runnerAuthorization = asRunnerAuthorization(authorization)
    const environment = await createSelfHostedEnvironment(authorization)
    const credential = await createRunnerCredential(authorization)

    const runnerRes = await jsonFetch('/api/v1/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Local runner',
        environmentId: environment.id,
        secretRef: credential.activeVersion.secretRef,
        maxConcurrent: 2,
        metadata: { pool: 'default' },
      }),
    })
    expect(runnerRes.status).toBe(201)
    const runner = (await runnerRes.json()) as Record<string, unknown>
    expect(runner).toMatchObject({
      state: 'offline',
      environmentId: environment.id,
      runtimes: [],
      secretRef: credential.activeVersion.secretRef,
      maxConcurrent: 2,
      archivedAt: null,
      lastHeartbeatAt: null,
    })
    expect(runner.organizationId).toBeUndefined()
    expect(JSON.stringify(runner)).not.toContain('raw-runner-credential')
    const runnerId = runner.id as string

    const emptyHeartbeatRes = await jsonFetch(`/api/v1/runners/${runnerId}/heartbeat`, authorization)
    expect(emptyHeartbeatRes.status).toBe(200)
    await expect(emptyHeartbeatRes.json()).resolves.toMatchObject({
      runnerId,
      state: 'offline',
      currentLoad: 0,
      lastHeartbeatAt: null,
    })

    const putHeartbeatRes = await jsonFetch(`/api/v1/runners/${runnerId}/heartbeat`, runnerAuthorization, {
      method: 'PUT',
      body: JSON.stringify({
        state: 'active',
        runtimeUsage: [
          {
            runtime: 'claude-code',
            windows: [{ label: '5-Hour', utilization: 23, resetsAt: '2026-06-12T08:30:00.000Z' }],
          },
        ],
        runtimes: [{ runtime: 'claude-code', models: ['claude-sonnet-4-6'], version: '2.0.1', state: 'ready' }],
      }),
    })
    expect(putHeartbeatRes.status).toBe(200)
    const heartbeat = (await putHeartbeatRes.json()) as Record<string, unknown>
    expect(heartbeat).toMatchObject({
      runnerId,
      state: 'active',
      currentLoad: 0,
      runtimeUsage: [{ runtime: 'claude-code', windows: [{ label: '5-Hour', utilization: 23 }] }],
      runtimes: [{ runtime: 'claude-code', models: ['claude-sonnet-4-6'], version: '2.0.1', state: 'ready' }],
      lastHeartbeatAt: expect.any(String),
    })

    const readHeartbeatRes = await jsonFetch(`/api/v1/runners/${runnerId}/heartbeat`, authorization)
    expect(readHeartbeatRes.status).toBe(200)
    await expect(readHeartbeatRes.json()).resolves.toEqual(heartbeat)

    const readRunnerRes = await jsonFetch(`/api/v1/runners/${runnerId}`, authorization)
    expect(readRunnerRes.status).toBe(200)
    await expect(readRunnerRes.json()).resolves.toMatchObject({
      id: runnerId,
      state: 'active',
      currentLoad: 0,
      runtimes: [{ runtime: 'claude-code', models: ['claude-sonnet-4-6'], version: '2.0.1', state: 'ready' }],
      lastHeartbeatAt: expect.any(String),
    })
  })

  it('rejects secret refs that are not active vault credentials', async () => {
    const authorization = asRunnerAuthorization(await signIn())
    const res = await jsonFetch('/api/v1/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bad credential runner',
        secretRef: 'ama://vaults/vault_missing/credentials/cred_missing',
      }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { secretRef: expect.stringContaining('not an active vault credential') } },
      },
    })
  })

  it('rejects raw secret material in runner metadata', async () => {
    const authorization = asRunnerAuthorization(await signIn())
    const res = await jsonFetch('/api/v1/runners', authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Leaky runner',
        metadata: { apiKey: 'raw-secret-value' },
      }),
    })
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: { type: 'validation_error', message: 'Runner metadata must not contain raw secret material' },
    })
  })

  it('updates runner management fields and archives via PATCH', async () => {
    const authorization = await signIn()
    const runnerAuthorization = asRunnerAuthorization(authorization)
    const runnerRes = await jsonFetch('/api/v1/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Managed runner' }),
    })
    expect(runnerRes.status).toBe(201)
    const runner = (await runnerRes.json()) as { id: string }

    const patchRes = await jsonFetch(`/api/v1/runners/${runner.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Renamed runner',
        state: 'draining',
        maxConcurrent: 4,
      }),
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      id: runner.id,
      name: 'Renamed runner',
      state: 'draining',
      maxConcurrent: 4,
      archivedAt: null,
    })

    const archiveRes = await jsonFetch(`/api/v1/runners/${runner.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    const archived = (await archiveRes.json()) as { archivedAt: string | null }
    expect(archived.archivedAt).toEqual(expect.any(String))

    const liveListRes = await jsonFetch('/api/v1/runners', authorization)
    expect(liveListRes.status).toBe(200)
    const liveList = (await liveListRes.json()) as { data: Array<{ id: string }> }
    expect(liveList.data.map((entry) => entry.id)).not.toContain(runner.id)

    const archivedListRes = await jsonFetch('/api/v1/runners?archived=true', authorization)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ id: string }> }
    expect(archivedList.data.map((entry) => entry.id)).toContain(runner.id)

    const restoreRes = await jsonFetch(`/api/v1/runners/${runner.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(restoreRes.status).toBe(200)
    await expect(restoreRes.json()).resolves.toMatchObject({ id: runner.id, archivedAt: null })
  })

  it('filters runner lists by state and environment', async () => {
    const authorization = await signIn()
    const activeRunnerAuthorization = asRunnerAuthorization(authorization)
    const environment = await createSelfHostedEnvironment(authorization)
    const activeRunnerRes = await jsonFetch('/api/v1/runners', activeRunnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Active env runner', environmentId: environment.id }),
    })
    const activeRunner = (await activeRunnerRes.json()) as { id: string }
    await jsonFetch(`/api/v1/runners/${activeRunner.id}/heartbeat`, activeRunnerAuthorization, {
      method: 'PUT',
      body: JSON.stringify({ state: 'active' }),
    })
    const offlineRunnerAuthorization = asRunnerAuthorization(await signInUser('offline-runner'))
    const offlineRunnerRes = await jsonFetch('/api/v1/runners', offlineRunnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Offline runner' }),
    })
    const offlineRunner = (await offlineRunnerRes.json()) as { id: string }

    const activeListRes = await jsonFetch('/api/v1/runners?state=active', authorization)
    const activeList = (await activeListRes.json()) as { data: Array<{ id: string; state: string }> }
    expect(activeList.data.map((entry) => entry.id)).toContain(activeRunner.id)
    expect(activeList.data.map((entry) => entry.id)).not.toContain(offlineRunner.id)

    const environmentListRes = await jsonFetch(`/api/v1/runners?environmentId=${environment.id}`, authorization)
    const environmentList = (await environmentListRes.json()) as { data: Array<{ id: string }> }
    expect(environmentList.data.map((entry) => entry.id)).toEqual([activeRunner.id])
  })

  it('keeps disabled runners from heartbeating themselves active', async () => {
    const authorization = await signIn()
    const runnerAuthorization = asRunnerAuthorization(authorization)
    const runnerRes = await jsonFetch('/api/v1/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Disabled runner' }),
    })
    const runner = (await runnerRes.json()) as { id: string }
    const disableRes = await jsonFetch(`/api/v1/runners/${runner.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'disabled' }),
    })
    expect(disableRes.status).toBe(200)

    const heartbeatRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, runnerAuthorization, {
      method: 'PUT',
      body: JSON.stringify({ state: 'active' }),
    })
    expect(heartbeatRes.status).toBe(409)
    await expect(heartbeatRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Disabled runners cannot heartbeat until re-enabled by an operator' },
    })
  })

  it('requires authentication for every runner endpoint', async () => {
    const missingListRes = await SELF.fetch('https://example.com/api/v1/runners')
    expect(missingListRes.status).toBe(401)
    expectAuthRequired(await missingListRes.json())

    const missingHeartbeatRes = await SELF.fetch('https://example.com/api/v1/runners/runner_x/heartbeat', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'active' }),
    })
    expect(missingHeartbeatRes.status).toBe(401)
    expectAuthRequired(await missingHeartbeatRes.json())
  })

  it('guards the runner relay channel: 426 without upgrade, 404 for missing runner, 101 for valid runner [spec: runners/channel]', async () => {
    const authorization = await signIn()
    const runnerAuthorization = asRunnerAuthorization(authorization)

    // 426: non-WebSocket upgrade request
    const noUpgradeRes = await jsonFetch('/api/v1/runners/runner_missing/channel', runnerAuthorization)
    expect(noUpgradeRes.status).toBe(426)
    await expect(noUpgradeRes.json()).resolves.toMatchObject({
      error: { type: 'conflict' },
    })

    // 404: runner not found with upgrade header
    const missingRes = await SELF.fetch('https://example.com/api/v1/runners/runner_missing/channel', {
      headers: {
        ...dpopHeaders(runnerAuthorization, 'GET', '/api/v1/runners/runner_missing/channel'),
        upgrade: 'websocket',
      },
    })
    expect(missingRes.status).toBe(404)

    // 101: valid environment-bound runner → WebSocket upgrade accepted
    const environment = await createSelfHostedEnvironment(authorization)
    const runnerRes = await jsonFetch('/api/v1/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Channel test runner', environmentId: environment.id }),
    })
    expect(runnerRes.status).toBe(201)
    const runner = (await runnerRes.json()) as { id: string }

    const channelRes = await SELF.fetch(`https://example.com/api/v1/runners/${runner.id}/channel`, {
      headers: {
        ...dpopHeaders(runnerAuthorization, 'GET', `/api/v1/runners/${runner.id}/channel`),
        upgrade: 'websocket',
      },
    })
    expect(channelRes.status).toBe(101)
    expect(channelRes.webSocket).toBeTruthy()
    const socket = channelRes.webSocket as WebSocket
    socket.accept()
    socket.close()
  })

  it('binds Realmroot runner tokens to their registered runner', async () => {
    const operatorAuthorization = await signIn()
    const runnerAuthorization = asRunnerAuthorization(operatorAuthorization)
    const environment = await createSelfHostedEnvironment(operatorAuthorization)

    const consoleRegisterRes = await jsonFetch('/api/v1/runners', operatorAuthorization, {
      method: 'POST',
      body: JSON.stringify({ name: 'Console registration bypass', environmentId: environment.id }),
    })
    expect(consoleRegisterRes.status).toBe(403)

    const legacyRunnerRes = await jsonFetch('/api/v1/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Runner legacy auth mode bypass',
        environmentId: environment.id,
        authMode: 'bearer',
      }),
    })
    expect(legacyRunnerRes.status).toBe(400)
    await expect(legacyRunnerRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
      },
    })

    const runnerRes = await jsonFetch('/api/v1/runners', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Realmroot device runner',
        environmentId: environment.id,
      }),
    })
    expect(runnerRes.status).toBe(201)
    const runner = (await runnerRes.json()) as { id: string; authMode: string }
    expect(runner.authMode).toBe('realmroot')

    // Console identities can manage/read runners but cannot perform runner work-loop writes.
    const readWithOperatorRes = await jsonFetch(`/api/v1/runners/${runner.id}`, operatorAuthorization)
    expect(readWithOperatorRes.status).toBe(200)
    const readHeartbeatWithOperatorRes = await jsonFetch(
      `/api/v1/runners/${runner.id}/heartbeat`,
      operatorAuthorization,
    )
    expect(readHeartbeatWithOperatorRes.status).toBe(200)
    const operatorHeartbeatRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, operatorAuthorization, {
      method: 'PUT',
      body: JSON.stringify({ state: 'active' }),
    })
    expect(operatorHeartbeatRes.status).toBe(403)
    await expect(operatorHeartbeatRes.json()).resolves.toMatchObject({
      error: { type: 'forbidden' },
    })
    const channelPath = `/api/v1/runners/${runner.id}/channel`
    const operatorChannelRes = await SELF.fetch(`https://example.com${channelPath}`, {
      headers: { ...dpopHeaders(operatorAuthorization, 'GET', channelPath), upgrade: 'websocket' },
    })
    expect(operatorChannelRes.status).toBe(403)

    // A different user's runner token cannot operate it either.
    const intruderAuthorization = asRunnerAuthorization(await signInUser('intruder'))
    const intruderHeartbeatRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, intruderAuthorization, {
      method: 'PUT',
      body: JSON.stringify({ state: 'active' }),
    })
    expect([403, 404]).toContain(intruderHeartbeatRes.status)

    const invalidAuthRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, 'Bearer invalid-token', {
      method: 'PUT',
      body: JSON.stringify({ state: 'active' }),
    })
    expect(invalidAuthRes.status).toBe(401)
    expectAuthRequired(await invalidAuthRes.json())

    const heartbeatRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, runnerAuthorization, {
      method: 'PUT',
      body: JSON.stringify({ state: 'active' }),
    })
    expect(heartbeatRes.status).toBe(200)
    await expect(heartbeatRes.json()).resolves.toMatchObject({ runnerId: runner.id, state: 'active' })
  })
})
