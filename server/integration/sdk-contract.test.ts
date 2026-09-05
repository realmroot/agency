import { SELF } from 'cloudflare:test'
import { isEnborSessionEventType } from '@shared/session-events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import openapi from '../../sdk/openapi.json'
import resources from '../../sdk/spec/resources.json'
import type { EnborClient } from '../../sdk/typescript/src/index'
import { createEnborClient, createEnborRunnerClient } from '../../sdk/typescript/src/index'
import { dpopHeaders, seedPlatformProvider, signIn } from './auth'

// The SDK's external operation inventory, derived from the published OpenAPI
// document the generated client is built from — { path, operationId } per
// operation. The generated client used to ship a hand-maintained `operations`
// array; the facade migration dropped it, so the contract is asserted against
// the spec itself, which is strictly more faithful.
const operations: Array<{ path: string; operationId: string }> = Object.entries(
  (openapi as { paths: Record<string, Record<string, { operationId?: string }>> }).paths,
).flatMap(([path, methods]) =>
  Object.values(methods)
    .filter((op): op is { operationId: string } => typeof op?.operationId === 'string')
    .map((op) => ({ path, operationId: op.operationId })),
)

// Integration port of the generated-SDK journey from e2e/projects.spec.ts. The
// SDK calls global fetch(origin + path); in the integration pool there is no HTTP
// origin, so we route fetch to the assembled worker via cloudflare:test SELF. This
// keeps the external-product contract traced server-side after the e2e spec is
// deleted, without depending on the Playwright harness.

type Json = Record<string, unknown>
type SdkList = { data: Json[]; pagination: { limit: number; hasMore: boolean; nextCursor: string | null } }

const STANDARD_RESOURCE_FIELDS = new Set(['metadata', 'spec', 'status'])

// The external product owns these workflow ids; Enbor only ever sees them as opaque metadata.
function externalRefs(runId: string) {
  return { product: 'downstream-service', boardId: `board_${runId}`, taskId: `task_${runId}` }
}
function externalMetadata(refs: ReturnType<typeof externalRefs>): Json {
  return { annotations: { externalProduct: refs.product, externalBoardId: refs.boardId, externalTaskId: refs.taskId } }
}
function obj(value: unknown): Json {
  expect(value && typeof value === 'object' && !Array.isArray(value)).toBe(true)
  return value as Json
}
function resourceUid(resource: Json) {
  return String(obj(obj(resource).metadata).uid)
}
function resourceSpec(resource: Json) {
  return obj(obj(resource).spec)
}

async function newSdk() {
  const authorization = await signIn()
  const accessToken = authorization.replace(/^Bearer\s+/i, '')
  const runId = accessToken.replace(/^e2e:/, '')
  return {
    enbor: createEnborClient({
      baseUrl: 'https://example.com',
      authorize: async (url, method) => {
        const headers = dpopHeaders(`DPoP ${accessToken}`, method, url)
        return { accessToken, dpopProof: headers.dpop as string }
      },
    }),
    runId,
  }
}

async function createAgentThroughSdk(enbor: EnborClient, runId: string) {
  return (await enbor.agents.create({
    metadata: { name: `${runId} external agent` },
    spec: {
      systemPrompt: 'Work items arrive from an external product over the Enbor SDK.',
      provider: 'workers-ai',
      model: '@cf/moonshotai/kimi-k2.6',
    },
  })) as Json
}
async function createEnvironmentThroughSdk(enbor: EnborClient, runId: string) {
  return (await enbor.environments.create({
    metadata: { name: `${runId} external env` },
    spec: {
      type: 'cloud',
      networking: { type: 'open', allowMcpServers: true, allowPackageManagers: true },
      packages: { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], webi: [] },
    },
  })) as Json
}
const readSession = (enbor: EnborClient, sessionId: string) => enbor.sessions.get(sessionId) as Promise<Json>
const listEvents = (enbor: EnborClient, sessionId: string) =>
  enbor.sessions.listEvents(sessionId, { limit: 200 }) as Promise<SdkList>

async function createSessionThroughSdk(
  enbor: EnborClient,
  runId: string,
  refs: ReturnType<typeof externalRefs>,
  agent: Json,
  environment: Json,
  extra: Json,
) {
  const { prompt, volumes, volumeMounts, env, envFrom, ...unexpected } = extra
  if (Object.keys(unexpected).length > 0) {
    throw new Error(`Unexpected SDK session options: ${Object.keys(unexpected).join(', ')}`)
  }
  const created = (await enbor.sessions.create({
    metadata: { name: `${runId} external session`, ...externalMetadata(refs) },
    spec: {
      agentId: resourceUid(agent),
      environmentId: resourceUid(environment),
      runtime: 'enbor',
      ...(Array.isArray(volumes) ? { volumes } : {}),
      ...(Array.isArray(volumeMounts) ? { volumeMounts } : {}),
      ...(env && typeof env === 'object' ? { env } : {}),
      ...(Array.isArray(envFrom) ? { envFrom } : {}),
    },
    prompt: typeof prompt === 'string' ? prompt : `${runId} external work`,
  })) as Json
  // Cloud sessions reach `idle` synchronously in the integration pool, so we just
  // read the session back rather than polling a runtime drive-to-idle loop.
  const session = await readSession(enbor, String(obj(created.metadata).uid))
  return { created, session }
}

describe('[CF] generated SDK contract', () => {
  beforeEach(async () => {
    await seedPlatformProvider()
    // Route the SDK's global fetch to the assembled worker via SELF. The
    // generated client issues `fetch(new Request(url, init))` — a single Request
    // that already carries method, headers, and body — so the stub forwards it
    // whole; reducing it to a bare url would strip auth + body (HTTP 401).
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const authorization = request.headers.get('authorization')
      if (authorization?.startsWith('DPoP e2e:')) {
        const headers = new Headers(request.headers)
        headers.set('authorization', authorization.replace(/^DPoP /, 'Bearer '))
        headers.delete('dpop')
        return SELF.fetch(new Request(request, { headers }))
      }
      return SELF.fetch(request)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('declares exact scopes and standard auth failures for every Realmroot operation', () => {
    const document = openapi as {
      paths: Record<
        string,
        Record<
          string,
          {
            operationId?: string
            security?: Array<Record<string, unknown>>
            responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>
          }
        >
      >
    }
    for (const methods of Object.values(document.paths)) {
      for (const operation of Object.values(methods)) {
        if (!operation.operationId || !operation.security?.some((requirement) => 'oidcAccessToken' in requirement))
          continue
        const scopes = operation.security.flatMap((requirement) =>
          Array.isArray(requirement.oidcAccessToken) ? (requirement.oidcAccessToken as string[]) : [],
        )
        expect(scopes, `${operation.operationId} must require one exact resource scope`).toHaveLength(1)
        expect(scopes[0]).toMatch(/^[a-z-]+:(read|write)$/)
        expect(
          operation.responses?.['401']?.content?.['application/json']?.schema,
          `${operation.operationId} must publish the standard authentication response`,
        ).toEqual({ $ref: '#/components/schemas/ErrorResponse' })
        expect(
          operation.responses?.['403']?.content?.['application/json']?.schema,
          `${operation.operationId} must publish the standard forbidden response`,
        ).toEqual({ $ref: '#/components/schemas/ErrorResponse' })
      }
    }
  })

  it('publishes both Agent actor and controlling user in the generated audit SDK contract', () => {
    const auditRecord = (openapi as { components?: { schemas?: Record<string, unknown> } }).components?.schemas
      ?.AuditRecord as { required?: string[]; properties?: Record<string, unknown> }
    expect(auditRecord.required).toEqual(expect.arrayContaining(['actorUserId', 'controllerUserId']))
    expect(auditRecord.properties).toEqual(
      expect.objectContaining({ actorUserId: expect.any(Object), controllerUserId: expect.any(Object) }),
    )
  })

  it('omits internal browser-only operations from OpenAPI and stable authenticated facades', () => {
    const exclusions = resources.facadeExclusions
    expect(exclusions).toEqual([
      {
        operationId: 'createInboxNotification',
        reason:
          'Inbox callback credentials are service-managed and must not be exposed through user-facing SDK facades.',
      },
    ])
    expect(new Set(exclusions.map(({ operationId }) => operationId)).size).toBe(exclusions.length)
    expect(operations.map(({ operationId }) => operationId)).not.toContain('createAuthorizationAttempt')
    expect(operations.map(({ operationId }) => operationId)).not.toContain('deleteCurrentAuthSession')
    expect(operations.map(({ operationId }) => operationId)).not.toContain('createSessionSocketTicket')

    const authorize = vi.fn(async () => ({ accessToken: 'token', dpopProof: 'proof' }))
    const agent = createEnborClient({ baseUrl: 'https://example.com', authorize })
    const runner = createEnborRunnerClient({
      baseUrl: 'https://example.com',
      headers: { authorization: 'Bearer runner-token' },
    })
    expect(agent.sessions).not.toHaveProperty('createSocketTicket')
    expect(runner.sessions).not.toHaveProperty('createSocketTicket')
    expect(agent.raw).toBeTruthy()
    expect(runner.raw).toBeTruthy()
  })

  it('exposes Project rename through the generated SDK facade [spec: projects/rename]', () => {
    const projects = resources.facades.public.resources.find(({ name }) => name === 'projects')
    expect(projects?.methods).toContainEqual({ name: 'update', operationId: 'updateProject' })

    const client = createEnborClient({
      baseUrl: 'https://example.com',
      authorize: async () => ({ accessToken: 'token', dpopProof: 'proof' }),
    })
    expect((client.projects as unknown as Record<string, unknown>).update).toBeTypeOf('function')
  })

  it('forwards the Session creation idempotency key [spec: sessions/create-idempotency]', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      expect(request.headers.get('idempotency-key')).toBe('session-idempotency-1')
      return Response.json({ metadata: { uid: 'same-session' } }, { status: 201 })
    })
    vi.stubGlobal('fetch', fetch)
    const client = createEnborClient({ baseUrl: 'https://example.com', headers: { authorization: 'Bearer fixture' } })
    await expect(
      client.sessions.create({ spec: { agentId: 'agent' }, prompt: 'Start' }, 'session-idempotency-1'),
    ).resolves.toMatchObject({ metadata: { uid: 'same-session' } })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('forwards the required Identity idempotency key through the TypeScript facade', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      expect(request.headers.get('idempotency-key')).toBe('identity-idempotency-1')
      return Response.json({ error: { type: 'fixture_stop', message: 'header captured' } }, { status: 409 })
    })
    vi.stubGlobal('fetch', fetch)
    const client = createEnborClient({
      baseUrl: 'https://example.com',
      authorize: async () => ({ accessToken: 'token', dpopProof: 'proof' }),
    })

    await expect(
      client.identities.create(
        { metadata: { name: 'Reviewer' }, spec: { username: 'reviewer', runtime: 'codex' } },
        'identity-idempotency-1',
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('uses an explicit native WebSocket factory for runner Bearer auth and strips legacy DPoP headers', async () => {
    const socket = {
      addEventListener: vi.fn(),
      close: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket
    const webSocketFactory = vi.fn(async () => socket)
    const runner = createEnborRunnerClient({
      baseUrl: 'https://example.com',
      projectId: 'project_runner',
      headers: {
        Authorization: 'Bearer runner-token',
        DPoP: 'legacy-proof-must-not-leak',
      },
      webSocketFactory,
    })

    await expect(runner.runners.channel('runner / 1')).resolves.toBeTruthy()
    expect(webSocketFactory).toHaveBeenCalledWith(
      'wss://example.com/api/v1/runners/runner%20%2F%201/channel?x-enbor-project-id=project_runner',
      {
        Authorization: 'Bearer runner-token',
        'x-enbor-project-id': 'project_runner',
      },
    )

    await expect(
      createEnborRunnerClient({
        baseUrl: 'https://example.com',
        headers: { authorization: 'Bearer runner-token' },
      }).runners.channel('runner_1'),
    ).rejects.toThrow('Runner WebSocket factory with Bearer header support is required')
    await expect(
      createEnborRunnerClient({
        baseUrl: 'https://example.com',
        headers: { authorization: 'DPoP runner-token' },
        webSocketFactory,
      }).runners.channel('runner_1'),
    ).rejects.toThrow('Runner WebSocket requires an Authorization: Bearer header')
  })

  it('external product manages standard Enbor resources through the SDK [spec: projects/external-resources]', async () => {
    const { enbor, runId } = await newSdk()
    const refs = externalRefs(runId)

    const createdAgent = await createAgentThroughSdk(enbor, runId)
    const createdAgentId = resourceUid(createdAgent)
    const updatedAgent = (await enbor.agents.update(createdAgentId, {
      metadata: { description: 'Updated by the external product through the SDK.' },
    })) as Json
    const createdEnv = await createEnvironmentThroughSdk(enbor, runId)
    const createdEnvId = resourceUid(createdEnv)

    // Enbor stores only standard resource fields; external ids are not part of
    // reusable Agent or Environment specs.
    const agent = (await enbor.agents.get(resourceUid(updatedAgent))) as Json
    for (const key of Object.keys(agent)) {
      expect(STANDARD_RESOURCE_FIELDS.has(key), `agent field "${key}" is not standard`).toBe(true)
    }
    const environment = (await enbor.environments.get(createdEnvId)) as Json
    for (const key of Object.keys(environment)) {
      expect(STANDARD_RESOURCE_FIELDS.has(key), `environment field "${key}" is not standard`).toBe(true)
    }
    expect(resourceSpec(agent).metadata).toBeUndefined()
    expect(resourceSpec(environment).metadata).toBeUndefined()
    expect(obj(agent.metadata).description).toBe('Updated by the external product through the SDK.')

    // No product-workflow references leak outside metadata.
    for (const resource of [agent, environment]) {
      for (const key of Object.keys(resource)) {
        expect(/external|board|task|review|pull/i.test(key), `"${key}" looks like a workflow field`).toBe(false)
      }
      const { spec: _spec, ...standard } = resource
      const serialized = JSON.stringify(standard)
      expect(serialized.includes(refs.taskId)).toBe(false)
      expect(serialized.includes(refs.boardId)).toBe(false)
    }

    // The product keeps its own mapping; Enbor ids resolve back through it.
    const productRecords = new Map<string, string>()
    productRecords.set(refs.taskId, resourceUid(agent))
    productRecords.set(refs.boardId, resourceUid(environment))
    expect(resourceUid((await enbor.agents.get(productRecords.get(refs.taskId) as string)) as Json)).toBe(
      resourceUid(agent),
    )
    expect(resourceUid((await enbor.environments.get(productRecords.get(refs.boardId) as string)) as Json)).toBe(
      resourceUid(environment),
    )

    // The SDK inventory exposes no product-workflow concepts.
    const asyncTaskResource = /[a-z]+-tasks(\/|\b)/i
    const workflowWords = new Set(['board', 'boards', 'task', 'tasks', 'review', 'reviews'])
    const workflowOps = operations.filter((op) => {
      if (asyncTaskResource.test(op.path)) return false
      const surface = `${op.path} ${op.operationId}`
      const words = surface
        .split(/[^A-Za-z]+/)
        .flatMap((s) => s.split(/(?=[A-Z])/))
        .map((w) => w.toLowerCase())
      return words.some((w) => workflowWords.has(w)) || /pull[-_]?request/i.test(surface)
    })
    expect(workflowOps.map((op) => op.operationId)).toEqual([])
  })

  it('external product starts work by creating an Enbor session [spec: projects/external-session]', async () => {
    const { enbor, runId } = await newSdk()
    const refs = externalRefs(runId)
    const agent = await createAgentThroughSdk(enbor, runId)
    const environment = await createEnvironmentThroughSdk(enbor, runId)
    const volumes = [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/enbor.git', ref: 'main' }]

    const { created, session } = await createSessionThroughSdk(enbor, runId, refs, agent, environment, {
      volumes,
      volumeMounts: [{ name: 'repo', mountPath: '/workspace/repos/saltbo/enbor' }],
      prompt: `Start the external product work item for ${runId}.`,
    })
    const sessionId = String(obj(session.metadata).uid)

    // Snapshots pin the selected agent/environment and are immutable after creation.
    const before = await readSession(enbor, sessionId)
    expect(obj(obj(obj(obj(before.status).bindings).agent).snapshot).agentId).toBe(resourceUid(agent))
    expect(typeof obj(obj(obj(obj(before.status).bindings).agent).snapshot).version).toBe('number')
    expect(obj(obj(obj(obj(before.status).bindings).environment).snapshot).environmentId).toBe(resourceUid(environment))
    await enbor.agents.update(resourceUid(agent), {
      spec: { systemPrompt: 'Changed after session creation — the snapshot must not follow.' },
    })
    const after = await readSession(enbor, sessionId)
    expect(obj(obj(after.status).bindings).agent).toEqual(obj(obj(before.status).bindings).agent)
    expect(obj(obj(after.status).bindings).environment).toEqual(obj(obj(before.status).bindings).environment)

    // The runtime/provider/model were validated before runtime work started.
    const sessionStatus = obj((await readSession(enbor, sessionId)).status)
    const placement = obj(sessionStatus.placement)
    expect(obj((await readSession(enbor, sessionId)).spec).runtime).toBe('enbor')
    expect(placement.hostingMode).toBe('cloud')
    expect(placement.provider).toBeTruthy()

    // Stable id/status/runtime + canonical session event and socket operations.
    expect(typeof obj(created.metadata).uid === 'string' && (obj(created.metadata).uid as string).length > 0).toBe(true)
    const fetched = await readSession(enbor, String(obj(created.metadata).uid))
    expect(obj(fetched.metadata).uid).toBe(obj(created.metadata).uid)
    expect('reason' in obj(fetched.status)).toBe(true)
    expect(typeof enbor.sessions.stream).toBe('function')
    const socketOperation = operations.find((op) => op.operationId === 'connectSessionSocket')
    expect(socketOperation?.path).toBe('/api/v1/sessions/{sessionId}/socket')
    const eventsOperation = operations.find((op) => op.operationId === 'listSessionEvents')
    expect(eventsOperation?.path).toBe('/api/v1/sessions/{sessionId}/events')

    // Canonical progress events exist in renderable sequence order; the initial prompt drove a turn.
    const events = await listEvents(enbor, sessionId)
    expect(events.data.length).toBeGreaterThan(0)
    expect(JSON.stringify(events.data)).toContain(`work item for ${runId}`)
    for (const record of events.data) {
      expect(isEnborSessionEventType(String(record.type)), `non-canonical event type "${record.type}"`).toBe(true)
    }
    const sequences = events.data.map((e) => Number(e.sequence))
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
  })

  it('external product controls a running session only through Enbor endpoints [spec: projects/external-control]', async () => {
    const { enbor, runId } = await newSdk()
    const refs = externalRefs(runId)
    const agent = await createAgentThroughSdk(enbor, runId)
    const environment = await createEnvironmentThroughSdk(enbor, runId)
    const { session } = await createSessionThroughSdk(enbor, runId, refs, agent, environment, {
      prompt: `Start the external control session for ${runId}.`,
    })
    const sessionId = String(obj(session.metadata).uid)

    const command = (await enbor.sessions.createMessage(sessionId, {
      type: 'prompt',
      content: `external product follow-up ${runId}`,
    })) as Json
    const closed = (await enbor.sessions.update(sessionId, { state: 'closed' })) as Json

    // The follow-up is an addressable message routed on Enbor-relative channels.
    expect(typeof command.id === 'string' && (command.id as string).length > 0).toBe(true)
    expect(command.sessionId).toBe(obj(obj(closed).metadata).uid)
    expect(command.type).toBe('prompt')
    expect(['live', 'queued'].includes(String(command.delivery))).toBe(true)
    expect(['accepted', 'delivered'].includes(String(command.state))).toBe(true)
    expect(JSON.stringify(command).includes('://')).toBe(false)

    // The command result is persisted as canonical session events; lifecycle state lives on the session status.
    const events = await listEvents(enbor, sessionId)
    expect(JSON.stringify(events.data).includes(`external product follow-up ${runId}`)).toBe(true)
    for (const record of events.data) {
      expect(isEnborSessionEventType(String(record.type)), `non-canonical event type "${record.type}"`).toBe(true)
    }
    expect(obj(await readSession(enbor, sessionId)).status).toMatchObject({ phase: 'closed' })
    expect(obj(await enbor.sessions.update(sessionId, { state: 'idle' })).status).toMatchObject({
      phase: 'idle',
      closedAt: null,
    })

    // The SDK inventory only targets Enbor control-plane endpoints; nothing leaks a local endpoint.
    for (const op of operations) {
      expect(op.path.startsWith('/api/v1/'), `${op.operationId} must target /api/v1/`).toBe(true)
      expect(op.path.startsWith('/runtime/')).toBe(false)
    }
    const finalSession = await readSession(enbor, sessionId)
    const finalEvents = await listEvents(enbor, sessionId)
    for (const surface of [JSON.stringify(finalSession), JSON.stringify(finalEvents.data)]) {
      expect(/wss?:\/\//.test(surface), 'no absolute socket endpoints leak').toBe(false)
      expect(surface.includes('preview-url')).toBe(false)
      expect(/:\d{4,5}\/(exec|process|shell)/.test(surface)).toBe(false)
    }
  })
})
