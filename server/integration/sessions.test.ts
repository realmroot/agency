import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptWebSessionValue, hashOpaqueValue, randomOpaqueValue } from '../auth/web-session-crypto'
import type { Env } from '../env'
import { runtimeErrorMessage } from '../http/sessions'
import {
  asRunnerAuthorization,
  defaultClaims,
  dpopHeaders,
  seedPlatformProvider,
  setupOidcProvider,
  signIn,
  signInUser,
} from './auth'
import { seedPolicy } from './policy-seed'

const DEFAULT_AMA_RUNNER_CAPABILITY = 'ama'

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  const requestInit = normalizeTestRequest(path, init)
  return await SELF.fetch(`https://example.com${path}`, {
    ...requestInit,
    headers: {
      'content-type': 'application/json',
      ...dpopHeaders(authorization, requestInit.method ?? 'GET', path),
      ...requestInit.headers,
    },
  })
}

async function createBrowserSessionCookie(authorization: string) {
  const accessToken = authorization.replace(/^Bearer /, '')
  const subject = `user_e2e_${accessToken.replace(/^e2e:/, '').split(';')[0]!}`
  const sessionId = randomOpaqueValue()
  const idHash = await hashOpaqueValue(sessionId)
  const bindings = env as unknown as Env
  const now = new Date()
  await bindings.DB.prepare(
    `INSERT INTO web_auth_sessions (id_hash, subject, encrypted_access_token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      idHash,
      subject,
      await encryptWebSessionValue(bindings, accessToken, `web-session:${idHash}`),
      new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      now.toISOString(),
    )
    .run()
  return `__Host-ama_session=${sessionId}`
}

async function issueBrowserSocketTicket(sessionId: string, cookie: string) {
  const response = await SELF.fetch(`https://example.com/api/v1/sessions/${sessionId}/socket-tickets`, {
    method: 'POST',
    headers: { cookie, Origin: 'https://example.com' },
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { ticket: string; expiresAt: string }
  expect(body.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(25_000)
  expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(30_000)
  return body.ticket
}

function browserTicketUpgradeHeaders(ticket: string, origin = 'https://example.com') {
  return {
    Upgrade: 'websocket',
    Origin: origin,
    'Sec-WebSocket-Protocol': `ama-ticket, ama-ticket.${ticket}`,
  }
}

function normalizeTestRequest(path: string, init: RequestInit) {
  if (path.startsWith('/api/v1/sessions/') && init.method === 'PATCH' && typeof init.body === 'string') {
    const body = JSON.parse(init.body) as Record<string, unknown>
    const { name, metadata, ...rest } = body
    return {
      ...init,
      body: JSON.stringify({
        ...rest,
        ...(name !== undefined || metadata !== undefined ? { metadata: normalizeSessionMetadata(metadata, name) } : {}),
      }),
    }
  }
  if (path !== '/api/v1/sessions' || init.method !== 'POST' || typeof init.body !== 'string') {
    return init
  }
  const body = JSON.parse(init.body) as Record<string, unknown>
  if ('spec' in body) {
    return init
  }
  const { agentId, environmentId, runtime, prompt, name, metadata, env, envFrom, volumes, volumeMounts, ...rest } = body
  return {
    ...init,
    body: JSON.stringify({
      ...rest,
      metadata: normalizeSessionMetadata(metadata, name),
      spec: {
        agentId,
        ...(environmentId !== undefined ? { environmentId } : {}),
        runtime,
        ...(env && typeof env === 'object' ? { env } : {}),
        ...(Array.isArray(envFrom) ? { envFrom } : {}),
        ...(Array.isArray(volumes) ? { volumes } : {}),
        ...(Array.isArray(volumeMounts) ? { volumeMounts } : {}),
      },
      prompt,
    }),
  }
}

function normalizeSessionMetadata(metadata: unknown, name: unknown) {
  const record =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {}
  const { labels, annotations, name: metadataName } = record
  return {
    ...(typeof name === 'string' ? { name } : typeof metadataName === 'string' ? { name: metadataName } : {}),
    ...(labels && typeof labels === 'object' && !Array.isArray(labels) ? { labels } : {}),
    ...(annotations && typeof annotations === 'object' && !Array.isArray(annotations) ? { annotations } : {}),
  }
}

async function waitForSessionState(sessionId: string, authorization: string, state: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await jsonFetch(`/api/v1/sessions/${sessionId}`, authorization)
    const session = (await res.json()) as { status: { phase: string } }
    if (session.status.phase === state) {
      return session
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Session ${sessionId} did not reach ${state}`)
}

async function createProject(authorization: string) {
  const res = await jsonFetch('/api/v1/projects', authorization, {
    method: 'POST',
    body: JSON.stringify({ name: `Socket project ${crypto.randomUUID()}` }),
  })
  if (res.status !== 201) {
    throw new Error(`Expected agent creation to return 201, got ${res.status}: ${await res.text()}`)
  }
  const project = (await res.json()) as { id: string }
  return project.id
}

function projectHeaders(projectId?: string): HeadersInit {
  return projectId ? { 'x-ama-project-id': projectId } : {}
}

async function createEnvironment(authorization: string, data: Record<string, unknown> = {}, projectId?: string) {
  const { hostingMode, networkPolicy, packages, mcpPolicy, packageManagerPolicy, runtimeConfig, name, ...rest } = data
  const environmentPackages =
    packages && !Array.isArray(packages)
      ? packages
      : {
          type: 'packages',
          apt: [],
          cargo: [],
          gem: [],
          go: [],
          npm: Array.isArray(packages)
            ? packages.map((item) =>
                item && typeof item === 'object'
                  ? `${(item as { name?: string }).name ?? ''}${(item as { version?: string }).version ? `@${(item as { version?: string }).version}` : ''}`
                  : String(item),
              )
            : ['@earendil-works/pi-agent-core@prebuilt'],
          pip: [],
        }
  const networking =
    networkPolicy && typeof networkPolicy === 'object' && (networkPolicy as { mode?: unknown }).mode === 'offline'
      ? { type: 'closed', allowMcpServers: false, allowPackageManagers: false }
      : networkPolicy &&
          typeof networkPolicy === 'object' &&
          (networkPolicy as { mode?: unknown }).mode === 'restricted'
        ? {
            type: 'limited',
            allowMcpServers: false,
            allowPackageManagers: true,
            allowedHosts: ((networkPolicy as { allowedHosts?: unknown }).allowedHosts as string[] | undefined) ?? [
              'registry.npmjs.org',
            ],
          }
        : { type: 'open', allowMcpServers: true, allowPackageManagers: true }
  const res = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    headers: projectHeaders(projectId),
    body: JSON.stringify({
      metadata: { name: typeof name === 'string' ? name : `AMA workspace ${crypto.randomUUID()}` },
      spec: {
        type: hostingMode === 'self_hosted' ? 'self_hosted' : 'cloud',
        networking,
        packages: environmentPackages,
        ...rest,
      },
    }),
  })
  if (res.status !== 201) {
    throw new Error(`Expected environment creation to return 201, got ${res.status}: ${await res.text()}`)
  }
  const environment = (await res.json()) as {
    metadata: { uid: string }
    spec: { type?: string }
  }
  return { id: environment.metadata.uid, hostingMode: environment.spec.type }
}

async function createAgent(authorization: string, data: Record<string, unknown> = {}, projectId?: string) {
  const { systemPrompt, provider, skills, mcpConnectors, name: _name, ...rest } = data
  const res = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    headers: projectHeaders(projectId),
    body: JSON.stringify({
      metadata: { name: 'Cloud session agent' },
      spec: {
        systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : 'Work through AMA runtime.',
        skills: Array.isArray(skills) ? skills : ['ama@cloud-session'],
        mcpConnectors: Array.isArray(mcpConnectors) ? mcpConnectors : ['github'],
        // Agents must pin a provider before a session can be created. The cloud
        // runtime ('ama') routes through the Workers AI binding, which only
        // recognizes the 'workers-ai' provider and supplies a default model when
        // none is pinned. The seeded global provider row backs the agent provider
        // FK and the cloud catalog check.
        provider: typeof provider === 'string' ? provider : 'workers-ai',
        ...rest,
      },
    }),
  })
  if (res.status !== 201) {
    throw new Error(`Expected agent creation to return 201, got ${res.status}: ${await res.text()}`)
  }
  const agent = (await res.json()) as {
    metadata: { uid: string }
    spec: { skills: string[] }
    status: { currentVersionId: string }
  }
  return { id: agent.metadata.uid, currentVersionId: agent.status.currentVersionId, skills: agent.spec.skills }
}

// Providers are a global vendor catalog now; seed an external vendor + model row
// directly (discovery owns these in production). Returns the row id callers pin.
async function createProviderModel(_authorization: string, model: string) {
  const slug = `external-${crypto.randomUUID().slice(0, 8)}`
  const { providerId } = await seedPlatformProvider({
    providerId: slug,
    slug,
    displayName: 'External gateway',
    modelId: model,
  })
  return { providerId, model }
}

async function registerRunner(authorization: string, environmentId: string, _runtimeNames: string[]) {
  const res = await jsonFetch('/api/v1/runners', asRunnerAuthorization(authorization), {
    method: 'POST',
    body: JSON.stringify({
      name: `Runtime support runner ${crypto.randomUUID()}`,
      environmentId,
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string }
}

async function heartbeatRunner(
  authorization: string,
  runnerId: string,
  runtimeNames: string[],
  runtimes = runtimeNames.map((runtime) => ({ runtime, models: [], state: 'ready' })),
) {
  const res = await jsonFetch(`/api/v1/runners/${runnerId}/heartbeat`, asRunnerAuthorization(authorization), {
    method: 'PUT',
    body: JSON.stringify({ state: 'active', runtimes }),
  })
  expect(res.status).toBe(200)
}

// v1 lease flow: list available work, then claim one lease for it.
async function claimLease(authorization: string, runnerId: string) {
  const runnerAuthorization = asRunnerAuthorization(authorization)
  const workRes = await jsonFetch('/api/v1/work-items?state=available', runnerAuthorization)
  expect(workRes.status).toBe(200)
  const work = (await workRes.json()) as { data: Array<{ id: string }> }
  if (work.data.length === 0) {
    return null
  }
  for (const item of work.data) {
    const leaseRes = await jsonFetch('/api/v1/leases', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ workItemId: item.id, runnerId }),
    })
    if (leaseRes.status === 201) {
      return (await leaseRes.json()) as { id: string; workItemId: string; runnerId: string }
    }
  }
  return null
}

async function readWorkItem(authorization: string, workItemId: string) {
  const res = await jsonFetch(`/api/v1/work-items/${workItemId}`, authorization)
  expect(res.status).toBe(200)
  return (await res.json()) as { id: string; payload: Record<string, unknown> }
}

async function connectMcp(authorization: string, connectorId: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({
      metadata: { name: `${connectorId} credentials` },
      spec: {},
    }),
  })
  if (vaultRes.status !== 201) {
    throw new Error(`Expected vault creation to return 201, got ${vaultRes.status}: ${await vaultRes.text()}`)
  }
  const vault = (await vaultRes.json()) as { metadata: { uid: string } }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.metadata.uid}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `${connectorId} token`,
      type: 'opaque',
      secret: { stringData: { value: `raw-${connectorId}-token` } },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const credential = (await credentialRes.json()) as {
    metadata: { uid: string }
    status: {
      activeVersionId: string
      activeVersion: { metadata: { uid: string }; spec: { secretRef: string } }
    }
  }
  return {
    id: credential.metadata.uid,
    activeVersionId: credential.status.activeVersionId,
    activeVersion: {
      id: credential.status.activeVersion.metadata.uid,
      secretRef: credential.status.activeVersion.spec.secretRef,
    },
  }
}

async function createVault(authorization: string, name = `Runtime credentials ${crypto.randomUUID()}`) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify({ metadata: { name }, spec: {} }),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { metadata: { uid: string } }
  return { id: vault.metadata.uid }
}

async function createCredential(
  authorization: string,
  vaultId: string,
  input: { name: string; type: string; stringData: Record<string, string> },
) {
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      type: input.type,
      secret: { stringData: input.stringData },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const credential = (await credentialRes.json()) as {
    metadata: { uid: string; name: string }
    status: {
      activeVersion: { metadata: { uid: string }; spec: { secretRef: string; dataKeys: string[] } }
    }
  }
  return {
    id: credential.metadata.uid,
    name: credential.metadata.name,
    activeVersion: {
      id: credential.status.activeVersion.metadata.uid,
      secretRef: credential.status.activeVersion.spec.secretRef,
      dataKeys: credential.status.activeVersion.spec.dataKeys,
    },
  }
}

async function setProjectPolicy(authorization: string, policy: Record<string, unknown>) {
  await seedPolicy({ authorization, scope: { level: 'project' }, ...policy })
}

describe('[CF] /api/v1/sessions', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves a runner-capable environment when none is pinned [spec: sessions/create]', async () => {
    const authorization = await signIn()
    const environment = await createEnvironment(authorization, { mcpPolicy: { allowedConnectors: [] } })
    const agent = await createAgent(authorization, { mcpConnectors: [] })
    const runner = await registerRunner(authorization, environment.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    await heartbeatRunner(authorization, runner.id, [DEFAULT_AMA_RUNNER_CAPABILITY])

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        runtime: 'ama',
        name: 'Unpinned session',
        prompt: 'Resolve environment',
      }),
    })
    expect(createRes.status).toBe(201)
    await expect(createRes.json()).resolves.toMatchObject({ spec: { environmentId: environment.id } })
  })

  it('rejects an unpinned session when no runner environment is available [spec: sessions/create]', async () => {
    const authorization = await signIn()
    // An environment exists but has no active runner, so it is not a candidate.
    await createEnvironment(authorization, { mcpPolicy: { allowedConnectors: [] } })
    const agent = await createAgent(authorization, { mcpConnectors: [] })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        runtime: 'ama',
        name: 'Unpinned session',
        prompt: 'Resolve environment',
      }),
    })
    expect(createRes.status).toBe(409)
    await expect(createRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: expect.stringContaining('No environment has an active runner') },
    })
  })

  it('creates, reads, lists, connects, messages, stops, archives, and records events for a cloud session [spec: sessions/create] [spec: sessions/prompt] [spec: sessions/close] [spec: sessions/archive] [spec: sessions/connection] [spec: sessions/events-query] [spec: sessions/tool-result-redaction]', async () => {
    const authorization = await signIn()
    const githubCredential = await connectMcp(authorization, 'github')
    await connectMcp(authorization, 'linear')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Ship the first task',
        prompt: 'Ship the first task',
        metadata: { annotations: { ticket: 'AMA-1' } },
        volumes: [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/agent-kanban.git' }],
        volumeMounts: [{ name: 'repo', mountPath: '/workspace/repos/saltbo/agent-kanban', readOnly: true }],
        env: { AK_API_URL: 'https://ak.example.com', AK_AGENT_ID: 'agent_123' },
        envFrom: [
          {
            type: 'secret',
            name: 'AK_AGENT_KEY',
            secretRef: githubCredential.activeVersion.secretRef,
          },
        ],
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      metadata: { uid: string; annotations: Record<string, string>; archivedAt: string | null }
      spec: {
        env: Record<string, string>
        envFrom: Array<{ type: 'secret'; name: string; secretRef: string }>
        volumes: Array<Record<string, unknown>>
        volumeMounts: Array<Record<string, unknown>>
      }
      status: {
        phase: string
        startedAt: string
        bindings: {
          agent: {
            versionId: string
            snapshot: { systemPrompt: string; skills: string[]; mcpConnectors: string[]; provider: string }
          }
          environment: {
            versionId: string | null
            snapshot: {
              networking: Record<string, unknown>
              packages: { npm: string[] }
            }
          }
        }
        placement: Record<string, unknown>
      }
    }
    const createdId = created.metadata.uid
    expect(created).toMatchObject({
      metadata: {
        name: 'Ship the first task',
        annotations: { ticket: 'AMA-1' },
      },
      spec: {
        env: { AK_API_URL: 'https://ak.example.com', AK_AGENT_ID: 'agent_123' },
        envFrom: [
          {
            type: 'secret',
            name: 'AK_AGENT_KEY',
            secretRef: githubCredential.activeVersion.secretRef,
          },
        ],
        volumes: [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/agent-kanban.git' }],
        volumeMounts: [{ name: 'repo', mountPath: '/workspace/repos/saltbo/agent-kanban' }],
      },
      status: {
        phase: 'idle',
        bindings: {
          agent: {
            versionId: agent.currentVersionId,
            snapshot: {
              systemPrompt: 'Work through AMA runtime.',
              skills: ['ama@cloud-session'],
              mcpConnectors: ['github'],
              provider: 'workers-ai',
            },
          },
          environment: {
            snapshot: {
              networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true },
              packages: { npm: ['@earendil-works/pi-agent-core@prebuilt'] },
            },
          },
        },
        placement: {
          hostingMode: 'cloud',
          provider: 'workers-ai',
          model: null,
        },
      },
    })
    // Internal placement and tenancy fields never leave the API (§1.7).
    const serialized = JSON.stringify(created)
    expect(serialized).not.toContain('durableObjectName')
    expect(serialized).not.toContain('sandboxId')
    expect(serialized).not.toContain('runtimeEndpointPath')
    expect(serialized).not.toContain('organizationId')
    expect(serialized).not.toContain('resumeToken')
    expect(created.status.bindings.environment.versionId).toMatch(/^envver_/)
    expect(created.status.startedAt).toEqual(expect.any(String))

    const listRes = await jsonFetch('/api/v1/sessions', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      data: Array<{ metadata: { uid: string } }>
      pagination: { hasMore: boolean }
    }
    expect(list.data).toContainEqual(expect.objectContaining({ metadata: expect.objectContaining({ uid: createdId }) }))
    expect(list.pagination.hasMore).toBe(false)

    const readRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ metadata: { uid: createdId }, status: { phase: 'idle' } })

    const socketMetadataRes = await jsonFetch(`/api/v1/sessions/${createdId}/socket`, authorization)
    expect(socketMetadataRes.status).toBe(403)

    const taskRes = await jsonFetch(`/api/v1/sessions/${createdId}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', content: 'Inspect repository status' }),
    })
    expect(taskRes.status).toBe(201)
    const afterTaskRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization)
    await expect(afterTaskRes.json()).resolves.toMatchObject({
      metadata: { uid: createdId },
      status: { phase: 'idle' },
    })

    const messageRes = await jsonFetch(`/api/v1/sessions/${createdId}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        type: 'prompt',
        content: 'What was my previous prompt?',
      }),
    })
    expect(messageRes.status).toBe(201)
    const message = (await messageRes.json()) as { id: string; delivery: string; state: string }
    expect(message).toMatchObject({
      sessionId: createdId,
      type: 'prompt',
      content: 'What was my previous prompt?',
      delivery: 'live',
      state: 'delivered',
      error: null,
    })

    const messageItemRes = await jsonFetch(`/api/v1/sessions/${createdId}/messages/${message.id}`, authorization)
    expect(messageItemRes.status).toBe(200)
    await expect(messageItemRes.json()).resolves.toMatchObject({ id: message.id, state: 'delivered' })

    const messageListRes = await jsonFetch(`/api/v1/sessions/${createdId}/messages`, authorization)
    expect(messageListRes.status).toBe(200)
    const messageList = (await messageListRes.json()) as { data: Array<{ id: string }> }
    expect(messageList.data).toContainEqual(expect.objectContaining({ id: message.id }))

    const afterCommandRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization)
    await expect(afterCommandRes.json()).resolves.toMatchObject({
      metadata: { uid: createdId },
      status: { phase: 'idle' },
    })

    const closeRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    })
    expect(closeRes.status).toBe(200)
    const closed = (await closeRes.json()) as { status: { phase: string; closedAt: string } }
    expect(closed.status.phase).toBe('closed')
    expect(closed.status.closedAt).toEqual(expect.any(String))

    const rejectedWhileClosed = await jsonFetch(`/api/v1/sessions/${createdId}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', content: 'This should wait for reopen' }),
    })
    expect(rejectedWhileClosed.status).toBe(409)

    const reopenRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'idle' }),
    })
    expect(reopenRes.status).toBe(200)
    await expect(reopenRes.json()).resolves.toMatchObject({
      metadata: { uid: createdId },
      status: { phase: 'idle', closedAt: null },
    })

    const reopenedMessageRes = await jsonFetch(`/api/v1/sessions/${createdId}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', content: 'Continue after reopen' }),
    })
    expect(reopenedMessageRes.status).toBe(201)

    const eventsRes = await jsonFetch(`/api/v1/sessions/${createdId}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as {
      data: Array<{
        sequence: number
        type: string
        payload: Record<string, unknown>
      }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(events.data.map((event) => event.sequence)).toEqual(events.data.map((_, index) => index + 1))
    expect(events.pagination).toMatchObject({ limit: 100, hasMore: false, nextCursor: null })
    expect(events.data.map((record) => record.type)).toEqual(
      expect.arrayContaining(['turn.completed', 'message.updated', 'message.completed']),
    )
    const toolCallEvent = events.data.find(
      (record) =>
        record.type === 'message.completed' &&
        JSON.stringify(record.payload).includes('"type":"tool_call"') &&
        JSON.stringify(record.payload).includes('"id":"call_git_status"'),
    )
    const toolResultEvent = events.data.find(
      (record) =>
        record.type === 'message.completed' &&
        JSON.stringify(record.payload).includes('"type":"tool_result"') &&
        JSON.stringify(record.payload).includes('"toolCallId":"call_git_status"'),
    )
    expect(toolCallEvent).toBeTruthy()
    expect(toolResultEvent).toBeTruthy()
    expect(JSON.stringify(events.data)).not.toContain('raw-secret')
    expect(JSON.stringify(events.data)).toContain('Previous user prompt: Inspect repository status')
    expect(JSON.stringify(events.data)).not.toContain('raw-github-token')
    expect(JSON.stringify(events.data)).not.toContain('organizationId')

    const pagedEventsRes = await jsonFetch(`/api/v1/sessions/${createdId}/events?limit=1`, authorization)
    const pagedEvents = (await pagedEventsRes.json()) as {
      data: Array<{ sequence: number; type: string }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(pagedEvents.data).toEqual([expect.objectContaining({ sequence: 1 })])
    expect(pagedEvents.pagination).toMatchObject({ hasMore: true, nextCursor: '1' })

    const cursorEventsRes = await jsonFetch(`/api/v1/sessions/${createdId}/events?cursor=1&limit=2`, authorization)
    const cursorEvents = (await cursorEventsRes.json()) as {
      data: Array<{ sequence: number; type: string }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(cursorEvents.data.map((event) => event.sequence)).toEqual([2, 3])
    expect(cursorEvents.pagination).toEqual({ limit: 2, hasMore: true, nextCursor: '3' })

    const descendingEventsRes = await jsonFetch(
      `/api/v1/sessions/${createdId}/events?order=desc&cursor=6&limit=2`,
      authorization,
    )
    const descendingEvents = (await descendingEventsRes.json()) as { data: Array<{ sequence: number; type: string }> }
    expect(descendingEvents.data.map((event) => event.sequence)).toEqual([5, 4])

    const filteredEventsRes = await jsonFetch(
      `/api/v1/sessions/${createdId}/events?cursor=1&type=message.completed`,
      authorization,
    )
    const filteredEvents = (await filteredEventsRes.json()) as {
      data: Array<{ sequence: number; type: string }>
    }
    expect(filteredEvents.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'message.completed' })]),
    )

    // CSV export via content negotiation replaces /events/export (§1.2.6).
    const csvRes = await jsonFetch(`/api/v1/sessions/${createdId}/events?cursor=2&limit=2`, authorization, {
      headers: { accept: 'text/csv' },
    })
    expect(csvRes.status).toBe(200)
    expect(csvRes.headers.get('content-type')).toContain('text/csv')
    expect(csvRes.headers.get('content-disposition')).toContain(`session-${createdId}-events.csv`)
    const csvText = await csvRes.text()
    const csvLines = csvText.trim().split('\n')
    expect(csvLines[0]).toBe('id,sessionId,sequence,type,createdAt,payload,metadata')
    expect(csvLines).toHaveLength(3)
    expect(csvText).not.toContain('raw-secret')

    // SSE stream via content negotiation replaces /events/stream.
    const streamRes = await jsonFetch(`/api/v1/sessions/${createdId}/events?cursor=4`, authorization, {
      headers: { accept: 'text/event-stream' },
    })
    expect(streamRes.status).toBe(200)
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream')
    const streamText = await streamRes.text()
    const streamedEvents = streamText
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as { sequence: number })
    expect(streamedEvents[0]?.sequence).toBe(5)
    expect(streamText).not.toContain('raw-github-token')

    const descendingStreamRes = await jsonFetch(`/api/v1/sessions/${createdId}/events?order=desc`, authorization, {
      headers: { accept: 'text/event-stream' },
    })
    expect(descendingStreamRes.status).toBe(400)

    const archiveRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    const archived = (await archiveRes.json()) as { status: { phase: string }; metadata: { archivedAt: string | null } }
    expect(archived.status.phase).toBe('closed')
    expect(archived.metadata.archivedAt).toEqual(expect.any(String))

    const liveListRes = await jsonFetch('/api/v1/sessions', authorization)
    const liveList = (await liveListRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(liveList.data).not.toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ uid: createdId }) }),
    )

    const archivedListRes = await jsonFetch('/api/v1/sessions?archived=true', authorization)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as {
      data: Array<{ metadata: { uid: string; archivedAt: string | null } }>
    }
    expect(archivedList.data).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ uid: createdId, archivedAt: expect.any(String) }),
      }),
    )

    // Archived sessions reject edits but can be restored.
    const archivedEditRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New title' }),
    })
    expect(archivedEditRes.status).toBe(409)

    const unarchiveRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(unarchiveRes.status).toBe(200)
    await expect(unarchiveRes.json()).resolves.toMatchObject({ metadata: { uid: createdId, archivedAt: null } })
  })

  it('updates name and metadata without disturbing runtime-managed metadata', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Before rename',
        prompt: 'Create a session for rename coverage',
        metadata: { annotations: { ticket: 'AMA-1' } },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { metadata: { uid: string } }

    const patchRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'After rename', metadata: { annotations: { ticket: 'AMA-2', extra: 'true' } } }),
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      metadata: {
        name: 'After rename',
        annotations: { ticket: 'AMA-2', extra: 'true' },
      },
    })

    const secretMetadataRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { annotations: { apiKey: 'raw-secret-token' } } }),
    })
    expect(secretMetadataRes.status).toBe(400)

    const emptyPatchRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({}),
    })
    expect(emptyPatchRes.status).toBe(400)
  })

  it('queues self-hosted sessions for runner lease support [spec: sessions/memory-store-resources] [spec: runtime/self-hosted-ama-cloud-loop]', async () => {
    const authorization = await signIn()
    const runnerAuthorization = asRunnerAuthorization(authorization)
    const credential = await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization, {
      name: 'Self-hosted workspace',
      hostingMode: 'self_hosted',
      networkPolicy: { mode: 'unrestricted' },
      mcpPolicy: {},
      packageManagerPolicy: {},
      runtimeConfig: {},
      packages: [],
    })
    const runner = await registerRunner(runnerAuthorization, environment.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    const agent = await createAgent(authorization, {
      name: 'Self-hosted session agent',
      systemPrompt: 'Wait for a self-hosted runner.',
      skills: [],
      mcpConnectors: [],
    })
    const memoryStoreRes = await jsonFetch('/api/v1/memory-stores', authorization, {
      method: 'POST',
      body: JSON.stringify({ metadata: { name: 'Team memory', description: 'Review conventions' }, spec: {} }),
    })
    expect(memoryStoreRes.status).toBe(201)
    const memoryStore = (await memoryStoreRes.json()) as { metadata: { uid: string } }
    const memoryStoreId = memoryStore.metadata.uid
    const memoryRes = await jsonFetch(`/api/v1/memory-stores/${memoryStoreId}/memories`, authorization, {
      method: 'POST',
      body: JSON.stringify({ path: 'guides/review.md', content: 'Review for correctness first.' }),
    })
    expect(memoryRes.status).toBe(201)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        volumes: [
          { name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/agent-kanban.git', ref: 'main' },
          { name: 'memory', type: 'memory', memoryRef: `ama://memories/${memoryStoreId}` },
        ],
        volumeMounts: [
          { name: 'repo', mountPath: '/workspace/repos/saltbo/agent-kanban' },
          { name: 'memory', mountPath: `/workspace/.ama/memory-stores/${memoryStoreId}`, readOnly: false },
        ],
        envFrom: [
          {
            type: 'secret',
            name: 'AK_AGENT_KEY',
            secretRef: credential.activeVersion.secretRef,
          },
        ],
        prompt: 'Start self-hosted workspace setup.',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      metadata: { uid: string }
      spec: {
        envFrom: Array<{ type: 'secret'; name: string; secretRef: string }>
        volumes: Array<Record<string, unknown>>
        volumeMounts: Array<Record<string, unknown>>
      }
      status: {
        phase: string
        reason: string | null
        bindings: { environment: { snapshot: { hostingMode: string } } }
        placement: Record<string, unknown>
      }
    }
    const createdId = created.metadata.uid
    expect(created.spec.volumes).toContainEqual(
      expect.objectContaining({
        type: 'memory',
        memoryRef: `ama://memories/${memoryStoreId}`,
        name: 'memory',
      }),
    )
    expect(created.spec.volumeMounts).toContainEqual({
      name: 'memory',
      mountPath: `/workspace/.ama/memory-stores/${memoryStoreId}`,
      readOnly: false,
    })
    expect(created).toMatchObject({
      spec: {
        envFrom: [{ type: 'secret', name: 'AK_AGENT_KEY', secretRef: credential.activeVersion.secretRef }],
      },
      status: {
        phase: 'pending',
        reason: 'waiting-for-runner',
        bindings: { environment: { snapshot: { type: 'self_hosted' } } },
        placement: {
          hostingMode: 'self_hosted',
          provider: 'workers-ai',
          model: null,
        },
      },
    })

    const socketMetadataRes = await jsonFetch(`/api/v1/sessions/${createdId}/socket`, authorization)
    expect(socketMetadataRes.status).toBe(403)

    const workItemsRes = await jsonFetch(`/api/v1/work-items?sessionId=${createdId}`, authorization)
    expect(workItemsRes.status).toBe(200)
    await expect(workItemsRes.json()).resolves.toMatchObject({
      data: [
        {
          sessionId: createdId,
          environmentId: environment.id,
          type: 'session.start',
          state: 'available',
        },
      ],
    })

    const workRow = await env.DB.prepare('SELECT payload FROM work_items WHERE session_id = ?')
      .bind(createdId)
      .first<{ payload: string }>()
    expect(workRow).toBeTruthy()
    const storedPayload = JSON.parse(workRow!.payload) as {
      volumes: Array<Record<string, unknown>>
      volumeMounts: Array<Record<string, unknown>>
      env: Record<string, string>
      envFrom: Array<{ type: 'secret'; name: string; secretRef: string }>
      provider: string
      agentSnapshot: { systemPrompt: string }
    }
    expect(storedPayload.volumes).toEqual([
      {
        name: 'repo',
        type: 'git_repository',
        url: 'https://github.com/saltbo/agent-kanban.git',
        ref: 'main',
      },
      {
        name: 'memory',
        type: 'memory',
        memoryRef: `ama://memories/${memoryStoreId}`,
      },
    ])
    expect(storedPayload.volumeMounts).toEqual([
      { name: 'repo', mountPath: '/workspace/repos/saltbo/agent-kanban', readOnly: true },
      { name: 'memory', mountPath: `/workspace/.ama/memory-stores/${memoryStoreId}`, readOnly: false },
    ])
    expect(storedPayload.agentSnapshot.systemPrompt).toContain('Workspace layout:')
    expect(storedPayload.agentSnapshot.systemPrompt).toContain(
      'https://github.com/saltbo/agent-kanban.git at repos/saltbo/agent-kanban',
    )
    expect(storedPayload.agentSnapshot.systemPrompt).toContain('memory (writable)')
    expect(storedPayload.agentSnapshot.systemPrompt).toContain(`.ama/memory-stores/${memoryStoreId}`)
    expect(storedPayload.agentSnapshot.systemPrompt).not.toContain('Review for correctness first.')
    expect(storedPayload.provider).toBe('workers-ai')
    expect(storedPayload.env).not.toHaveProperty('AK_AGENT_KEY')
    expect(storedPayload.envFrom).toEqual([
      { type: 'secret', name: 'AK_AGENT_KEY', secretRef: credential.activeVersion.secretRef },
    ])

    await heartbeatRunner(runnerAuthorization, runner.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    const lease = await claimLease(runnerAuthorization, runner.id)
    expect(lease).toBeTruthy()
    const consoleWorkItem = await readWorkItem(authorization, lease!.workItemId)
    expect(consoleWorkItem.payload).toMatchObject({
      envFrom: [{ type: 'secret', name: 'AK_AGENT_KEY', secretRef: credential.activeVersion.secretRef }],
    })
    expect(JSON.stringify(consoleWorkItem)).not.toContain('raw-github-token')
    expect(JSON.stringify(consoleWorkItem)).not.toContain('Review for correctness first.')

    const workItem = await readWorkItem(runnerAuthorization, lease!.workItemId)
    const payload = workItem.payload as {
      env: Record<string, string>
      envFrom: Array<Record<string, unknown>>
      workspaceManifest: { mounts: Array<Record<string, unknown>> }
    }
    // Lease materialization resolves the vault value into the runner env.
    expect(payload.env.AK_AGENT_KEY).toBe('raw-github-token')
    expect(payload.workspaceManifest.mounts).toContainEqual({
      type: 'memory',
      name: 'memory',
      mountPath: `/workspace/.ama/memory-stores/${memoryStoreId}`,
      memoryRef: `ama://memories/${memoryStoreId}`,
      readOnly: false,
      files: [{ path: 'guides/review.md', content: 'Review for correctness first.' }],
    })
  })

  it('normalizes Git repository volumes and rejects unsafe workspace inputs', async () => {
    const authorization = await signIn()
    const credential = await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Prepare repository workspace',
        volumes: [
          {
            name: 'repo',
            type: 'git_repository',
            url: 'https://github.com/saltbo/any-managed-agents.git',
            ref: 'feature/session-resources',
            secretRef: credential.activeVersion.secretRef,
          },
        ],
        volumeMounts: [{ name: 'repo', mountPath: 'repos/ama' }],
      }),
    })
    expect(createRes.status).toBe(201)
    await expect(createRes.json()).resolves.toMatchObject({
      spec: {
        volumes: [
          {
            name: 'repo',
            type: 'git_repository',
            url: 'https://github.com/saltbo/any-managed-agents.git',
            ref: 'feature/session-resources',
            secretRef: credential.activeVersion.secretRef,
          },
        ],
        volumeMounts: [{ name: 'repo', mountPath: '/workspace/repos/ama', readOnly: true }],
      },
    })

    const unsafePathRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Reject unsafe workspace path',
        volumes: [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/any-managed-agents.git' }],
        volumeMounts: [{ name: 'repo', mountPath: '../escape' }],
      }),
    })
    expect(unsafePathRes.status).toBe(400)
    await expect(unsafePathRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { 'volumeMounts.0.mountPath': expect.any(String) } },
      },
    })

    const duplicateMountRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Reject duplicate workspace mount',
        volumes: [
          { name: 'one', type: 'git_repository', url: 'https://github.com/saltbo/one.git' },
          { name: 'two', type: 'git_repository', url: 'https://gitlab.com/saltbo/two.git' },
        ],
        volumeMounts: [
          { name: 'one', mountPath: 'repos/shared' },
          { name: 'two', mountPath: '/workspace/repos/shared' },
        ],
      }),
    })
    expect(duplicateMountRes.status).toBe(400)
  })

  it('materializes credential-backed env and workspace volumes for runner use [spec: sessions/secret-projection]', async () => {
    const authorization = await signIn()
    const runnerAuthorization = asRunnerAuthorization(authorization)
    const environment = await createEnvironment(authorization, {
      name: `Self-hosted credential workspace ${crypto.randomUUID()}`,
      hostingMode: 'self_hosted',
      networkPolicy: { mode: 'unrestricted' },
      mcpPolicy: {},
      packageManagerPolicy: {},
      runtimeConfig: {},
      packages: [],
    })
    const runner = await registerRunner(runnerAuthorization, environment.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    const agent = await createAgent(authorization, {
      name: 'Credential-backed workspace agent',
      systemPrompt: 'Use prepared workspace mounts.',
      skills: [],
      mcpConnectors: [],
    })
    const vault = await createVault(authorization)
    const gitCredential = await createCredential(authorization, vault.id, {
      name: 'git-basic-auth',
      type: 'opaque',
      stringData: { GH_USERNAME: 'git-user', GH_TOKEN: 'git-password' },
    })
    const appSecret = await createCredential(authorization, vault.id, {
      name: 'app-config',
      type: 'opaque',
      stringData: { alpha: 'secret-alpha', beta: 'secret-beta' },
    })
    await createCredential(authorization, vault.id, {
      name: 'tls-cert',
      type: 'ama.dev/tls',
      stringData: { 'tls.crt': '-----BEGIN CERTIFICATE-----', 'tls.key': '-----BEGIN PRIVATE KEY-----' },
    })
    const gitSecretRef = `ama://vaults/${vault.id}/credentials/${gitCredential.id}`
    const appSecretRef = `ama://vaults/${vault.id}/credentials/${appSecret.id}`

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Prepare credential-backed workspace',
        envFrom: [
          {
            type: 'secret',
            name: 'SERVICE_PASSWORD',
            secretRef: gitSecretRef,
            key: 'GH_TOKEN',
          },
          {
            type: 'secret',
            secretRef: appSecretRef,
          },
        ],
        volumes: [
          {
            name: 'repo',
            type: 'git_repository',
            url: 'https://github.com/saltbo/slink.git',
            secretRef: gitSecretRef,
            items: [
              { key: 'GH_USERNAME', path: 'username' },
              { key: 'GH_TOKEN', path: 'password' },
            ],
          },
          { name: 'single-secret', type: 'secret', secretRef: appSecretRef },
          { name: 'vault-secrets', type: 'secret', secretRef: `ama://vaults/${vault.id}` },
        ],
        volumeMounts: [
          { name: 'repo', mountPath: '/workspace/repos/saltbo/slink' },
          { name: 'single-secret', mountPath: '/workspace/.ama/secrets/app' },
          { name: 'vault-secrets', mountPath: '/workspace/.ama/secrets/project' },
        ],
      }),
    })
    expect(createRes.status).toBe(201)

    await heartbeatRunner(runnerAuthorization, runner.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    const lease = await claimLease(runnerAuthorization, runner.id)
    expect(lease).toBeTruthy()
    const consoleWorkItem = await readWorkItem(authorization, lease!.workItemId)
    expect(consoleWorkItem.payload).toMatchObject({
      envFrom: [
        { type: 'secret', name: 'SERVICE_PASSWORD', secretRef: gitSecretRef, key: 'GH_TOKEN' },
        { type: 'secret', secretRef: appSecretRef },
      ],
      volumes: expect.any(Array),
      volumeMounts: expect.any(Array),
    })
    expect(JSON.stringify(consoleWorkItem)).not.toContain('git-password')
    expect(JSON.stringify(consoleWorkItem)).not.toContain('secret-alpha')

    const workItem = await readWorkItem(runnerAuthorization, lease!.workItemId)
    const payload = workItem.payload as {
      env: Record<string, string>
      workspaceManifest: {
        root: string
        mounts: Array<{
          type: string
          name: string
          mountPath: string
          credential?: { username: string; password: string }
          files?: Array<{ path: string; content: string }>
        }>
      }
    }

    expect(payload.env.SERVICE_PASSWORD).toBe('git-password')
    expect(payload.env.alpha).toBe('secret-alpha')
    expect(payload.env.beta).toBe('secret-beta')
    expect(payload).not.toHaveProperty('envFrom')
    expect(payload).not.toHaveProperty('volumes')
    expect(payload).not.toHaveProperty('volumeMounts')
    expect(payload.workspaceManifest.root).toBe('/workspace')

    const repoMount = payload.workspaceManifest.mounts.find((mount) => mount.name === 'repo')
    expect(repoMount).toMatchObject({
      type: 'git_repository',
      mountPath: '/workspace/repos/saltbo/slink',
      credential: { username: 'git-user', password: 'git-password' },
    })

    const singleSecretMount = payload.workspaceManifest.mounts.find((mount) => mount.name === 'single-secret')
    expect(singleSecretMount).toMatchObject({
      type: 'secret',
      mountPath: '/workspace/.ama/secrets/app',
      files: [
        { path: 'alpha', content: 'secret-alpha' },
        { path: 'beta', content: 'secret-beta' },
      ],
    })

    const vaultMount = payload.workspaceManifest.mounts.find((mount) => mount.name === 'vault-secrets')
    expect(vaultMount).toMatchObject({
      type: 'secret',
      mountPath: '/workspace/.ama/secrets/project',
    })
    expect(vaultMount?.files).toEqual(
      expect.arrayContaining([
        { path: 'app-config/alpha', content: 'secret-alpha' },
        { path: 'app-config/beta', content: 'secret-beta' },
        { path: 'git-basic-auth/GH_TOKEN', content: 'git-password' },
        { path: 'git-basic-auth/GH_USERNAME', content: 'git-user' },
        { path: 'tls-cert/tls.crt', content: '-----BEGIN CERTIFICATE-----' },
        { path: 'tls-cert/tls.key', content: '-----BEGIN PRIVATE KEY-----' },
      ]),
    )
  })

  it('validates envFrom references without exposing raw secrets [spec: sessions/create-explicit-inputs]', async () => {
    const authorization = await signIn()
    const credential = await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const missingRefRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Resolve wrong env secret version',
        envFrom: [
          {
            type: 'secret',
            name: 'AK_AGENT_KEY',
            secretRef: 'ama://vaults/vault_missing/credentials/cred_missing/versions/ver_missing',
          },
        ],
      }),
    })
    expect(missingRefRes.status).toBe(400)
    await expect(missingRefRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { 'envFrom.0.secretRef': expect.any(String) } },
      },
    })

    const wrongVersionRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Reject duplicate env secret names',
        envFrom: [
          {
            type: 'secret',
            name: 'AK_AGENT_KEY',
            secretRef: 'ama://vaults/vault_missing/credentials/cred_missing/versions/ver_missing',
          },
        ],
      }),
    })
    expect(wrongVersionRes.status).toBe(400)
    await expect(wrongVersionRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { 'envFrom.0.secretRef': expect.any(String) } },
      },
    })

    const duplicateNameRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Reject duplicate env secret names',
        envFrom: [
          { type: 'secret', name: 'AK_AGENT_KEY', secretRef: credential.activeVersion.secretRef },
          { type: 'secret', name: 'AK_AGENT_KEY', secretRef: credential.activeVersion.secretRef },
        ],
      }),
    })
    expect(duplicateNameRes.status).toBe(400)
    const duplicateNameText = await duplicateNameRes.text()
    expect(JSON.parse(duplicateNameText)).toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { 'envFrom.1.name': expect.any(String) } },
      },
    })
    expect(duplicateNameText).not.toContain('raw-github-token')

    const keyWithoutNameRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Reject unnamed env secret key projection',
        envFrom: [{ type: 'secret', key: 'GH_TOKEN', secretRef: credential.activeVersion.secretRef }],
      }),
    })
    expect(keyWithoutNameRes.status).toBe(400)
    await expect(keyWithoutNameRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: { fields: { 'envFrom.0.key': expect.any(String) } },
      },
    })
  })

  it('preserves canonical session environment snapshots for read contracts', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization, {
      name: `Canonical snapshot workspace ${crypto.randomUUID()}`,
      hostingMode: 'cloud',
      runtimeConfig: { image: 'ama-runtime', timeoutSeconds: 120 },
      networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    })
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Capture snapshot',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { metadata: { uid: string } }

    const readRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, authorization)
    expect(readRes.status).toBe(200)
    const body = await readRes.json()
    expect(body).toMatchObject({
      spec: { runtime: 'ama' },
      status: {
        bindings: {
          environment: {
            snapshot: {
              type: 'cloud',
              networking: {
                type: 'limited',
                allowMcpServers: false,
                allowPackageManagers: true,
                allowedHosts: ['registry.npmjs.org'],
              },
              packages: { npm: ['@earendil-works/pi-agent-core@prebuilt'] },
            },
          },
        },
      },
    })
  })

  it('serializes stored canonical runtime event rows as AMA session events [spec: sessions/events-canonical]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Record event contract',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; projectId: string }

    // The cloud ama session stores its events in the Session DO; seed through the
    // ingest endpoint (which routes to that store) rather than D1 directly.
    const ingestStartRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'message.completed',
            payload: {
              message: {
                id: 'msg_call_pi',
                role: 'assistant',
                content: [
                  { type: 'tool_call', toolCall: { id: 'call_pi', name: 'bash', input: { command: 'npm test' } } },
                ],
              },
            },
          },
        ],
      }),
    })
    expect(ingestStartRes.status).toBe(201)

    const eventsRes = await jsonFetch(
      `/api/v1/sessions/${created.metadata.uid}/events?type=message.completed`,
      authorization,
    )
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown> }>
    }
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message.completed',
          payload: expect.objectContaining({
            message: expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'tool_call',
                  toolCall: { id: 'call_pi', name: 'bash', input: { command: 'npm test' } },
                }),
              ]),
            }),
          }),
        }),
      ]),
    )

    const ingestErrorRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'runtime.error',
            payload: { message: 'Runtime failed safely', code: 'runtime_exit', details: { exitCode: 1 } },
          },
        ],
      }),
    })
    expect(ingestErrorRes.status).toBe(201)

    const runtimeErrorEventsRes = await jsonFetch(
      `/api/v1/sessions/${created.metadata.uid}/events?type=runtime.error`,
      authorization,
    )
    const runtimeErrorEvents = (await runtimeErrorEventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown> }>
    }
    expect(runtimeErrorEvents.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime.error',
          payload: expect.objectContaining({ message: 'Runtime failed safely', code: 'runtime_exit' }),
        }),
      ]),
    )
  })

  it('accepts batch event ingest from an authenticated project user', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Accept event ingest',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const ingestRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'turn.completed',
            payload: { message: { id: 'msg_turn_done', role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
          },
          { type: 'runtime.error', payload: { message: 'Bridge failed', code: 'runtime_exit' } },
        ],
      }),
    })
    expect(ingestRes.status).toBe(201)
    await expect(ingestRes.json()).resolves.toEqual({ accepted: 2 })

    const eventsRes = await jsonFetch(
      `/api/v1/sessions/${created.metadata.uid}/events?type=turn.completed`,
      authorization,
    )
    const events = (await eventsRes.json()) as {
      data: Array<{ type: string }>
    }
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'turn.completed',
        }),
      ]),
    )

    const emptyBatchRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({ events: [] }),
    })
    expect(emptyBatchRes.status).toBe(400)
  })

  it('archives a cloud ama session event log to R2 on stop', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Archive event log',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'turn.completed',
            payload: {
              message: {
                id: 'msg_archived_run',
                role: 'assistant',
                content: [{ type: 'text', text: 'archived run' }],
              },
            },
          },
        ],
      }),
    })

    const stopRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    })
    expect(stopRes.status).toBe(200)

    // The cloud loop owns this session's events in the Session DO; stopping it
    // snapshots the whole log to one R2 archive object (sessions/{id}/events.jsonl).
    const archived = await env.SESSION_EVENTS.get(`sessions/${created.metadata.uid}/events.jsonl`)
    expect(archived).toBeTruthy()
    const events = (await archived!.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string })
    expect(events.some((record) => record.type === 'turn.completed')).toBe(true)
  })

  it('streams backfill history and live events over the browser WebSocket', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Stream session events',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    // A historical event the backfill request must replay.
    await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'message.started',
            payload: { message: { id: 'msg_backfill_started', role: 'assistant', content: [] } },
          },
        ],
      }),
    })

    const socketPath = `/api/v1/sessions/${created.metadata.uid}/socket`
    const browserCookie = await createBrowserSessionCookie(authorization)
    const ticket = await issueBrowserSocketTicket(created.metadata.uid, browserCookie)
    const socketRes = await SELF.fetch(`https://example.com${socketPath}`, {
      headers: browserTicketUpgradeHeaders(ticket),
    })
    expect(socketRes.status).toBe(101)
    const ws = socketRes.webSocket as WebSocket
    const frames: Array<Record<string, unknown>> = []
    let onFrame: (() => void) | null = null
    ws.addEventListener('message', (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer)
      frames.push(JSON.parse(data))
      onFrame?.()
    })
    ws.accept()

    async function waitForFrame(predicate: (frame: Record<string, unknown>) => boolean) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (frames.some(predicate)) {
          return frames.find(predicate) as Record<string, unknown>
        }
        await new Promise<void>((resolve) => {
          onFrame = resolve
          setTimeout(resolve, 20)
        })
      }
      throw new Error(`expected frame never arrived; got ${JSON.stringify(frames)}`)
    }

    ws.send(JSON.stringify({ type: 'backfill', requestId: 'r1', limit: 100 }))
    const backfill = await waitForFrame((frame) => frame.type === 'backfill' && frame.requestId === 'r1')
    expect((backfill.events as Array<{ type: string }>).some((record) => record.type === 'message.started')).toBe(true)

    // A live append fans out to the open socket without polling.
    await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        events: [
          {
            type: 'message.completed',
            payload: {
              message: {
                id: 'msg_live_frame',
                role: 'assistant',
                content: [{ type: 'text', text: 'live frame' }],
              },
            },
          },
        ],
      }),
    })
    const live = await waitForFrame(
      (frame) => frame.type === 'event' && ((frame.record as { type?: string }).type ?? '') === 'message.completed',
    )
    expect((live.record as { type: string }).type).toBe('message.completed')

    ws.close()

    const replay = await SELF.fetch(`https://example.com${socketPath}`, {
      headers: browserTicketUpgradeHeaders(ticket),
    })
    expect(replay.status).toBe(401)
  })

  it('opens the browser WebSocket from session ownership without project scope', async () => {
    const authorization = await signIn()
    const projectId = await createProject(authorization)
    const environment = await createEnvironment(authorization, {}, projectId)
    const agent = await createAgent(authorization, { mcpConnectors: [] }, projectId)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      headers: projectHeaders(projectId),
      body: JSON.stringify({
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          runtime: 'ama',
        },
        prompt: 'Open socket without project scope',
      }),
    })
    const createdText = await createRes.text()
    expect(createRes.status, createdText).toBe(201)
    const created = JSON.parse(createdText) as { metadata: { uid: string } }

    const socketPath = `/api/v1/sessions/${created.metadata.uid}/socket`
    const browserCookie = await createBrowserSessionCookie(authorization)
    const ticket = await issueBrowserSocketTicket(created.metadata.uid, browserCookie)
    const socketRes = await SELF.fetch(`https://example.com${socketPath}`, {
      headers: browserTicketUpgradeHeaders(ticket),
    })
    expect(socketRes.status).toBe(101)
    const ws = socketRes.webSocket as WebSocket
    ws.accept()
    ws.close()

    const consoleBypass = await SELF.fetch(`https://example.com${socketPath}`, {
      headers: { authorization, Upgrade: 'websocket' },
    })
    expect(consoleBypass.status).toBe(403)

    const wrongOriginTicket = await issueBrowserSocketTicket(created.metadata.uid, browserCookie)
    const wrongOrigin = await SELF.fetch(`https://example.com${socketPath}`, {
      headers: browserTicketUpgradeHeaders(wrongOriginTicket, 'https://evil.example.com'),
    })
    expect(wrongOrigin.status).toBe(401)
    const acceptedAfterWrongOrigin = await SELF.fetch(`https://example.com${socketPath}`, {
      headers: browserTicketUpgradeHeaders(wrongOriginTicket),
    })
    expect(acceptedAfterWrongOrigin.status).toBe(101)
    acceptedAfterWrongOrigin.webSocket?.accept()
    acceptedAfterWrongOrigin.webSocket?.close()
    const replayAfterAccepted = await SELF.fetch(`https://example.com${socketPath}`, {
      headers: browserTicketUpgradeHeaders(wrongOriginTicket),
    })
    expect(replayAfterAccepted.status).toBe(401)

    const missingOrigin = await SELF.fetch(
      `https://example.com/api/v1/sessions/${created.metadata.uid}/socket-tickets`,
      {
        method: 'POST',
        headers: { cookie: browserCookie },
      },
    )
    expect(missingOrigin.status).toBe(403)
    const crossOrigin = await SELF.fetch(`https://example.com/api/v1/sessions/${created.metadata.uid}/socket-tickets`, {
      method: 'POST',
      headers: { cookie: browserCookie, Origin: 'https://evil.example.com' },
    })
    expect(crossOrigin.status).toBe(403)

    const bearerTicket = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/socket-tickets`, authorization, {
      method: 'POST',
      headers: { Origin: 'https://example.com' },
    })
    expect(bearerTicket.status).toBe(403)

    const bearerOverridesCookie = await SELF.fetch(
      `https://example.com/api/v1/sessions/${created.metadata.uid}/socket-tickets`,
      {
        method: 'POST',
        headers: { cookie: browserCookie, authorization, Origin: 'https://example.com' },
      },
    )
    expect(bearerOverridesCookie.status).toBe(403)

    const dpopAuthorization = authorization.replace(/^Bearer /, 'DPoP ')
    const dpopOverridesCookie = await SELF.fetch(
      `https://example.com/api/v1/sessions/${created.metadata.uid}/socket-tickets`,
      {
        method: 'POST',
        headers: {
          cookie: browserCookie,
          Origin: 'https://example.com',
          ...dpopHeaders(dpopAuthorization, 'POST', `/api/v1/sessions/${created.metadata.uid}/socket-tickets`),
        },
      },
    )
    expect(dpopOverridesCookie.status).toBe(401)

    const malformed = await SELF.fetch(`https://example.com${socketPath}`, {
      headers: {
        Upgrade: 'websocket',
        Origin: 'https://example.com',
        'Sec-WebSocket-Protocol': 'ama-ticket.not-valid',
      },
    })
    expect(malformed.status).toBe(401)

    const otherAuthorization = await signInUser('socket-ticket-intruder')
    const otherTicket = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/socket-tickets`, otherAuthorization, {
      method: 'POST',
      headers: { Origin: 'https://example.com' },
    })
    expect(otherTicket.status).toBe(403)

    const runnerTicket = await jsonFetch(
      `/api/v1/sessions/${created.metadata.uid}/socket-tickets`,
      asRunnerAuthorization(authorization),
      { method: 'POST', headers: { Origin: 'https://example.com' } },
    )
    expect(runnerTicket.status).toBe(403)
  })

  it('accepts self-hosted sessions when cloud sandbox startup is disabled [spec: environments/self-hosted]', async () => {
    const authorization = await signIn()
    const environment = await createEnvironment(authorization, {
      name: 'Self-hosted no sandbox workspace',
      hostingMode: 'self_hosted',
      networkPolicy: { mode: 'unrestricted' },
      mcpPolicy: {},
      packageManagerPolicy: {},
      runtimeConfig: {},
      packages: [],
    })
    const agent = await createAgent(authorization, {
      name: 'Self-hosted no sandbox agent',
      systemPrompt: 'Wait for runner attachment.',
      skills: [],
      mcpConnectors: [],
    })

    const queuedRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Queue self hosted work',
      }),
    })
    expect(queuedRes.status).toBe(201)
    await expect(queuedRes.json()).resolves.toMatchObject({
      status: { phase: 'pending', reason: 'waiting-for-runner' },
    })
    await registerRunner(authorization, environment.id, [DEFAULT_AMA_RUNNER_CAPABILITY])
    await setProjectPolicy(authorization, { sandboxPolicy: { enabled: false } })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Queue self hosted work',
      }),
    })
    expect(createRes.status).toBe(201)
    await expect(createRes.json()).resolves.toMatchObject({
      spec: { runtime: 'ama' },
      status: {
        phase: 'pending',
        reason: 'waiting-for-runner',
        bindings: { environment: { snapshot: { type: 'self_hosted' } } },
      },
    })
  })

  it('keeps a closed session from writing successful completion events after cancellation [spec: sessions/close] [spec: runtime/close]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Cancellation boundary',
        prompt: 'Start cancellation boundary session',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { metadata: { uid: string }; status: { phase: string } }
    const createdId = created.metadata.uid
    expect(created.status.phase).toBe('idle')

    const runtimeRequest = jsonFetch(`/api/v1/sessions/${createdId}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', content: 'Wait for cancellation before completing' }),
    })
    await waitForSessionState(createdId, authorization, 'running')

    const stopRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    })
    const stopBody = await stopRes.clone().json()
    expect(stopRes.status, JSON.stringify(stopBody)).toBe(200)
    expect(stopBody).toMatchObject({ metadata: { uid: createdId }, status: { phase: 'closed' } })

    const runtimeRes = await runtimeRequest
    expect([200, 201, 409]).toContain(runtimeRes.status)

    const readRes = await jsonFetch(`/api/v1/sessions/${createdId}`, authorization)
    await expect(readRes.json()).resolves.toMatchObject({ metadata: { uid: createdId }, status: { phase: 'closed' } })

    const eventsRes = await jsonFetch(`/api/v1/sessions/${createdId}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown> }>
    }
    const successfulAssistantCompletions = events.data.filter((record) => {
      const message = (
        record.payload as { message?: { content?: Array<{ text?: string }>; role?: string; stopReason?: string } }
      ).message
      const text = message?.content?.map((part) => part.text ?? '').join('\n') ?? ''
      return (
        record.type === 'message.completed' &&
        message?.role === 'assistant' &&
        message.stopReason === 'stop' &&
        text.includes('Wait for cancellation before completing')
      )
    })
    expect(successfulAssistantCompletions).toEqual([])
    expect(JSON.stringify(events.data)).not.toContain('AMA runtime processed: Wait for cancellation before completing')
  })

  it('creates a session and dispatches an initial prompt through the API [spec: sessions/initial-prompt]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        name: 'Scheduled banking bonus research',
        metadata: {
          annotations: {
            externalRunId: 'tftt-banking-bonus-2026-05-26',
            source: 'tftt-cron',
          },
        },
        prompt: 'Research current Canadian banking bonus offers.',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      metadata: { uid: string; annotations: Record<string, string> }
      status: { phase: string }
    }
    expect(created).toMatchObject({
      status: { phase: 'idle' },
      metadata: {
        annotations: {
          externalRunId: 'tftt-banking-bonus-2026-05-26',
          source: 'tftt-cron',
        },
      },
    })

    const eventsRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, authorization)
    expect(eventsRes.status).toBe(200)
    const events = (await eventsRes.json()) as {
      data: Array<{ sequence: number; type: string; payload: Record<string, unknown> }>
    }
    expect(events.data.map((event) => event.sequence)).toEqual(events.data.map((_, index) => index + 1))
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message.completed',
          payload: expect.objectContaining({
            message: expect.objectContaining({
              role: 'user',
              content: [
                expect.objectContaining({ type: 'text', text: 'Research current Canadian banking bonus offers.' }),
              ],
            }),
          }),
        }),
        expect.objectContaining({
          type: 'message.completed',
          payload: expect.objectContaining({
            message: expect.objectContaining({ role: 'assistant' }),
          }),
        }),
        expect.objectContaining({
          type: 'usage.recorded',
          payload: expect.objectContaining({
            model: expect.any(String),
            promptTokens: expect.any(Number),
            completionTokens: expect.any(Number),
          }),
        }),
      ]),
    )

    const auditRes = await jsonFetch('/api/v1/audit-records?action=session.prompt', authorization)
    expect(auditRes.status).toBe(200)
    const audit = (await auditRes.json()) as { data: Array<Record<string, unknown>> }
    expect(audit.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'session.prompt',
          outcome: 'success',
          sessionId: created.metadata.uid,
        }),
      ]),
    )
  })

  it('validates prompt input and preserves runtime failure reasons', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const invalidRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: '',
      }),
    })
    expect(invalidRes.status).toBe(400)
    await expect(invalidRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error' },
    })

    expect(
      runtimeErrorMessage({ type: 'response', success: false, error: { message: 'token=raw-secret-token' } }),
    ).toBe('token=raw-secret-token')
  })

  it('lists sessions with pagination, state, search, and date filters [spec: sessions/list]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const firstRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'List first session',
      }),
    })
    const first = (await firstRes.json()) as { metadata: { uid: string; createdAt: string } }
    const secondRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'List second session',
      }),
    })
    const second = (await secondRes.json()) as { metadata: { uid: string; createdAt: string } }

    const pagedRes = await jsonFetch('/api/v1/sessions?limit=1', authorization)
    const paged = (await pagedRes.json()) as {
      data: Array<{ metadata: { uid: string } }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(paged.data).toHaveLength(1)
    expect(paged.pagination.hasMore).toBe(true)

    const nextPageRes = await jsonFetch(`/api/v1/sessions?limit=1&cursor=${paged.pagination.nextCursor}`, authorization)
    const nextPage = (await nextPageRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(nextPage.data.map((session) => session.metadata.uid)).not.toEqual(
      paged.data.map((session) => session.metadata.uid),
    )

    const stateRes = await jsonFetch('/api/v1/sessions?state=idle', authorization)
    const stateList = (await stateRes.json()) as {
      data: Array<{ metadata: { uid: string }; status: { phase: string } }>
    }
    expect(stateList.data.map((session) => session.status.phase)).toEqual(['idle', 'idle'])

    const searchRes = await jsonFetch(`/api/v1/sessions?search=${agent.id}`, authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(searchList.data.map((session) => session.metadata.uid)).toEqual(
      expect.arrayContaining([first.metadata.uid, second.metadata.uid]),
    )

    const dateRes = await jsonFetch(
      `/api/v1/sessions?createdFrom=${encodeURIComponent(first.metadata.createdAt)}&createdTo=${encodeURIComponent(second.metadata.createdAt)}`,
      authorization,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(dateList.data.map((session) => session.metadata.uid)).toEqual(
      expect.arrayContaining([first.metadata.uid, second.metadata.uid]),
    )
  })

  it('filters sessions by metadata label selector [spec: sessions/list]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const firstRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Create maintainer A session',
        metadata: { labels: { maintainerId: 'maintainer_a' } },
      }),
    })
    const first = (await firstRes.json()) as { metadata: { uid: string } }
    const secondRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Create maintainer B session',
        metadata: { labels: { maintainerId: 'maintainer_b' } },
      }),
    })
    const second = (await secondRes.json()) as { metadata: { uid: string } }

    const filteredRes = await jsonFetch('/api/v1/sessions?labelSelector=maintainerId%3Dmaintainer_a', authorization)
    expect(filteredRes.status).toBe(200)
    const filtered = (await filteredRes.json()) as {
      data: Array<{ metadata: { uid: string; labels: Record<string, string> } }>
    }
    expect(filtered.data.map((session) => session.metadata.uid)).toContain(first.metadata.uid)
    expect(filtered.data.map((session) => session.metadata.uid)).not.toContain(second.metadata.uid)
    expect(filtered.data[0]?.metadata).toMatchObject({ labels: { maintainerId: 'maintainer_a' } })
  })

  it('enforces auth and project tenancy for session lifecycle [spec: sessions/auth-tenancy]', async () => {
    const unauthenticatedRes = await SELF.fetch('https://example.com/api/v1/sessions')
    expect(unauthenticatedRes.status).toBe(401)

    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Check tenancy',
      }),
    })
    const created = (await createRes.json()) as { id: string }

    const otherCookie = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      organizationId: 'org_flare_456',
    })
    const crossProjectReads = await Promise.all([
      jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, otherCookie),
      jsonFetch(`/api/v1/sessions/${created.metadata.uid}/socket`, otherCookie),
      jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, otherCookie),
      jsonFetch(`/api/v1/sessions/${created.metadata.uid}/messages`, otherCookie),
      jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, otherCookie, {
        method: 'PATCH',
        body: JSON.stringify({ state: 'closed' }),
      }),
      jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, otherCookie, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      }),
      jsonFetch(`/api/v1/sessions/${created.metadata.uid}/events`, otherCookie, {
        method: 'POST',
        body: JSON.stringify({ events: [{ type: 'turn.completed', payload: {} }] }),
      }),
    ])
    expect(crossProjectReads.map((response) => response.status)).toEqual([404, 403, 404, 404, 404, 404, 404])
  })

  it('blocks disabled sandbox startup before creating a runtime [spec: audit/runtime-policy]', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    await setProjectPolicy(authorization, { sandboxPolicy: { enabled: false } })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Check sandbox policy',
      }),
    })
    expect(createRes.status).toBe(403)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Sandbox runtime is disabled by governance policy.',
        details: { category: 'sandbox', resourceType: 'sandbox', ruleId: 'sandboxPolicy.enabled' },
      },
    })

    const auditRes = await jsonFetch('/api/v1/audit-records?action=session.create', authorization)
    expect(auditRes.status).toBe(200)
    const auditRecords = (await auditRes.json()) as { data: Array<Record<string, unknown>> }
    expect(auditRecords.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'session.create',
          outcome: 'denied',
          policyCategory: 'sandbox',
          metadata: expect.objectContaining({
            decision: expect.objectContaining({ rule: 'sandboxPolicy.enabled' }),
          }),
        }),
      ]),
    )
  })

  it('records model-originated sandbox policy denials before executor dispatch', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    await setProjectPolicy(authorization, { sandboxPolicy: { blockedCommands: ['git'] } })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Inspect repository status',
      }),
    })
    expect(createRes.status).toBe(201)
    const session = (await createRes.json()) as { metadata: { uid: string } }

    const runtimeRes = await jsonFetch(`/api/v1/sessions/${session.metadata.uid}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', content: 'Inspect repository status' }),
    })
    expect([201, 500]).toContain(runtimeRes.status)

    // A governance denial fails the turn but leaves the session usable.
    const readRes = await jsonFetch(`/api/v1/sessions/${session.metadata.uid}`, authorization)
    await expect(readRes.json()).resolves.toMatchObject({
      metadata: { uid: session.metadata.uid },
      status: { phase: 'idle', reason: 'policy-denied' },
    })

    const eventsRes = await jsonFetch(`/api/v1/sessions/${session.metadata.uid}/events`, authorization)
    const events = (await eventsRes.json()) as {
      data: Array<{ type: string; payload: Record<string, unknown> }>
    }
    expect(events.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'permission.denied',
          payload: expect.objectContaining({
            reason: 'sandbox_command',
            resourceType: 'sandbox_command',
            resourceId: 'git',
            operation: 'command',
            details: expect.objectContaining({
              ruleId: 'sandboxPolicy.blockedCommands',
              command: 'git status',
            }),
          }),
        }),
        expect.objectContaining({
          type: 'message.completed',
          payload: expect.objectContaining({
            message: expect.objectContaining({
              role: 'tool',
              parentToolCallId: 'call_git_status',
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'tool_result',
                  toolCallId: 'call_git_status',
                  error: expect.objectContaining({
                    message: 'Sandbox command is blocked by policy.',
                  }),
                }),
              ]),
            }),
          }),
        }),
      ]),
    )
  })

  it('rereads stored snapshots after agent and environment updates', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Reread snapshots',
      }),
    })
    const created = (await createRes.json()) as { metadata: { uid: string } }

    await jsonFetch(`/api/v1/environments/${environment.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: ['vite'], pip: [] },
      }),
    })
    await jsonFetch(`/api/v1/agents/${agent.id}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { systemPrompt: 'Updated system prompt.' } }),
    })

    const rereadRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, authorization)
    expect(rereadRes.status).toBe(200)
    await expect(rereadRes.json()).resolves.toMatchObject({
      metadata: { uid: created.metadata.uid },
      status: {
        bindings: {
          agent: {
            snapshot: {
              systemPrompt: 'Work through AMA runtime.',
              version: 1,
              skills: ['ama@cloud-session'],
              mcpConnectors: ['github'],
            },
          },
          environment: {
            snapshot: {
              packages: { npm: ['@earendil-works/pi-agent-core@prebuilt'] },
              networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true },
            },
          },
        },
      },
    })
  })

  it('rejects cloud sessions when the session runtime cannot run the exact agent provider model [spec: sessions/reject-dependencies]', async () => {
    const authorization = await signIn()
    const model = 'gpt-5.3-codex'
    const { providerId } = await createProviderModel(authorization, model)
    const environment = await createEnvironment(authorization, { mcpPolicy: {} })
    const agent = await createAgent(authorization, { provider: providerId, model, mcpConnectors: [] })

    // Cloud validation checks the GLOBAL catalog (provider_models) via findModel.
    // Drop the model row out of band (the agent pinned it at save time) so the
    // exact (provider, model) the agent pins is no longer in the catalog.
    await env.DB.prepare('DELETE FROM provider_models WHERE provider_id = ? AND model_id = ?')
      .bind(providerId, model)
      .run()

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Validate runtime catalog',
      }),
    })

    expect(createRes.status).toBe(409)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        details: {
          resourceType: 'runtime_catalog',
          hostingMode: 'cloud',
          runtime: 'ama',
          provider: providerId,
          model,
        },
      },
    })
  })

  it('rejects cloud sessions for runtimes without a cloud driver before allocating runtime state', async () => {
    const authorization = await signIn()
    const environment = await createEnvironment(authorization, { mcpPolicy: {} })
    const agent = await createAgent(authorization, { mcpConnectors: [] })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'codex',
        prompt: 'Check runner model routing.',
      }),
    })

    expect(createRes.status).toBe(409)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        details: {
          resourceType: 'runtime_catalog',
          hostingMode: 'cloud',
          runtime: 'codex',
          provider: 'workers-ai',
          model: null,
        },
      },
    })
  })

  it('queues self-hosted external runtime sessions and requires exact runner model support on lease claim', async () => {
    const authorization = await signIn()
    const model = 'gpt-5.3-codex'
    const { providerId } = await createProviderModel(authorization, model)
    const environment = await createEnvironment(authorization, {
      hostingMode: 'self_hosted',
      mcpPolicy: {},
    })
    const agent = await createAgent(authorization, { provider: providerId, model, mcpConnectors: [] })

    const wrongRunner = await registerRunner(authorization, environment.id, ['codex'])
    const exactRunner = await registerRunner(authorization, environment.id, ['codex'])
    await heartbeatRunner(
      authorization,
      wrongRunner.id,
      ['codex'],
      [{ runtime: 'codex', models: ['gpt-5.3-codex-mini'], state: 'ready' }],
    )
    await heartbeatRunner(
      authorization,
      exactRunner.id,
      ['codex'],
      [{ runtime: 'codex', models: [model], state: 'ready' }],
    )

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'codex',
        prompt: 'Check runner model routing.',
      }),
    })
    expect(createRes.status).toBe(201)
    const session = (await createRes.json()) as {
      metadata: { uid: string }
      status: { phase: string; reason: string | null }
    }
    expect(session).toMatchObject({ status: { phase: 'pending', reason: 'waiting-for-runner' } })

    // Runners enumerate their host models, so model-specific declarations are
    // authoritative: a runner declaring only other model ids must not take
    // the work.
    const wrongLease = await claimLease(authorization, wrongRunner.id)
    expect(wrongLease).toBeNull()

    const exactLease = await claimLease(authorization, exactRunner.id)
    expect(exactLease).toBeTruthy()
  })

  it('queues self-hosted session messages as resume work atomically [spec: sessions/prompt]', async () => {
    const authorization = await signIn()
    const model = 'gpt-5.3-codex'
    const { providerId } = await createProviderModel(authorization, model)
    const environment = await createEnvironment(authorization, { hostingMode: 'self_hosted', mcpPolicy: {} })
    const agent = await createAgent(authorization, { provider: providerId, model, mcpConnectors: [] })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'codex',
        prompt: 'Initial self-hosted task.',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { metadata: { uid: string } }
    await env.DB.prepare("UPDATE work_items SET state = 'succeeded', result = ?, updated_at = ? WHERE session_id = ?")
      .bind(JSON.stringify({ resumeToken: 'resume-token-1' }), new Date().toISOString(), created.metadata.uid)
      .run()
    await env.DB.prepare(
      "UPDATE sessions SET state = 'idle', state_reason = NULL, resume_token = ?, updated_at = ? WHERE id = ?",
    )
      .bind('resume-token-1', new Date().toISOString(), created.metadata.uid)
      .run()

    const messageRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/messages`, authorization, {
      method: 'POST',
      body: JSON.stringify({ type: 'prompt', content: 'Fix the rejected review.' }),
    })

    expect(messageRes.status).toBe(201)
    await expect(messageRes.json()).resolves.toMatchObject({
      sessionId: created.metadata.uid,
      delivery: 'queued',
      state: 'accepted',
    })
    const sessionRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}`, authorization)
    await expect(sessionRes.json()).resolves.toMatchObject({
      metadata: { uid: created.metadata.uid },
      status: { phase: 'pending', reason: 'waiting-for-runner' },
    })

    const workItemsRes = await jsonFetch(`/api/v1/work-items?sessionId=${created.metadata.uid}`, authorization)
    expect(workItemsRes.status).toBe(200)
    const workItems = (await workItemsRes.json()) as {
      data: Array<{ state: string; payload: Record<string, unknown> }>
    }
    expect(workItems.data).toContainEqual(
      expect.objectContaining({
        state: 'available',
        payload: expect.objectContaining({
          prompt: 'Fix the rejected review.',
          resume: true,
          resumeToken: 'resume-token-1',
        }),
      }),
    )
  })

  it('rejects sessions when the agent provider was disabled after the agent was saved', async () => {
    const authorization = await signIn()
    const model = 'gpt-5.3-codex'
    const { providerId } = await createProviderModel(authorization, model)
    const environment = await createEnvironment(authorization, { hostingMode: 'self_hosted', mcpPolicy: {} })
    const agent = await createAgent(authorization, { provider: providerId, model, mcpConnectors: [] })

    // The vendor is disabled out of band (global catalog) after the agent saved.
    await env.DB.prepare('UPDATE providers SET enabled = 0 WHERE id = ?').bind(providerId).run()

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'codex',
        prompt: 'Check legacy runner capability routing.',
      }),
    })
    expect(createRes.status).toBe(403)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'policy_denied',
        message: 'Provider is disabled for this project.',
      },
    })
  })

  it('rejects ama runtime sessions for configured external providers even without a pinned model', async () => {
    const authorization = await signIn()
    // Cloud validation with no pinned model checks the GLOBAL catalog via
    // findBySlug(provider). Seed a provider whose row id (what the agent pins)
    // differs from its slug, so the agent saves but the catalog lookup by slug
    // misses and the session is rejected.
    const providerId = `external-${crypto.randomUUID().slice(0, 8)}`
    await seedPlatformProvider({ providerId, slug: `${providerId}-slug`, displayName: 'External gateway' })
    const environment = await createEnvironment(authorization, { mcpPolicy: {} })
    const agent = await createAgent(authorization, { provider: providerId, model: null, mcpConnectors: [] })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'Validate provider catalog',
      }),
    })
    expect(createRes.status).toBe(409)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'conflict',
        message: 'Unsupported runtime provider/model combination',
        details: { resourceType: 'runtime_catalog', runtime: 'ama', provider: providerId },
      },
    })
  })

  it('does not lease model-specific work without a matching reported runtime model', async () => {
    const authorization = await signIn()
    const model = 'gpt-5.3-codex'
    const { providerId } = await createProviderModel(authorization, model)
    const environment = await createEnvironment(authorization, {
      hostingMode: 'self_hosted',
      mcpPolicy: {},
    })
    const agent = await createAgent(authorization, { provider: providerId, model, mcpConnectors: [] })

    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'codex',
        prompt: 'Check legacy runner capability routing.',
      }),
    })
    expect(createRes.status).toBe(201)

    const legacyRunner = await registerRunner(authorization, environment.id, ['codex'])
    await heartbeatRunner(
      authorization,
      legacyRunner.id,
      ['codex'],
      [{ runtime: 'codex', models: ['gpt-5.3-codex-mini'], state: 'ready' }],
    )

    const lease = await claimLease(authorization, legacyRunner.id)
    expect(lease).toBeNull()
  })

  it('lists session approvals with explicit states', async () => {
    const authorization = await signIn()
    await connectMcp(authorization, 'github')
    const environment = await createEnvironment(authorization)
    const agent = await createAgent(authorization)
    const createRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        environmentId: environment.id,
        runtime: 'ama',
        prompt: 'List approvals',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const approvalsRes = await jsonFetch(`/api/v1/sessions/${created.metadata.uid}/approvals`, authorization)
    expect(approvalsRes.status).toBe(200)
    await expect(approvalsRes.json()).resolves.toEqual({
      data: [],
      pagination: { limit: 0, nextCursor: null, hasMore: false },
    })

    const missingApprovalRes = await jsonFetch(
      `/api/v1/sessions/${created.metadata.uid}/approvals/approval_missing`,
      authorization,
    )
    expect(missingApprovalRes.status).toBe(404)

    const decideMissingRes = await jsonFetch(
      `/api/v1/sessions/${created.metadata.uid}/approvals/approval_missing`,
      authorization,
      {
        method: 'PATCH',
        body: JSON.stringify({ decision: 'approve' }),
      },
    )
    expect(decideMissingRes.status).toBe(404)
  })
})
