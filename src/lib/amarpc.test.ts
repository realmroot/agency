import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agent, credential, environment, vault } from '@/test/resource-fixtures'
import { ApiError, api } from './amarpc'
import { jsonArg, paramQueryArg, queryArg, queryOptions, rpcRequest } from './amarpc/core'

describe('shared API client [spec: web-console/rpc-client]', () => {
  beforeEach(() => {
    window.localStorage.setItem('ama:e2e-access-token', 'e2e:api-test')
    window.localStorage.setItem('ama:selected-project-id', 'project_test')
  })

  function headerValue(headers: HeadersInit | undefined, name: string) {
    if (headers instanceof Headers) {
      return headers.get(name)
    }
    if (Array.isArray(headers)) {
      return new Headers(headers).get(name)
    }
    return headers?.[name]
  }

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  function makeJsonFetch(body: unknown, status = 200) {
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    })
  }

  function makeEmptyFetch(status = 204) {
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(null, { status })
    })
  }

  function makeTextFetch(body: string, status = 200) {
    return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(body, { status, headers: { 'content-type': 'text/plain' } })
    })
  }

  function requestJson(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
    const body = fetchMock.mock.calls[callIndex]?.[1]?.body
    expect(typeof body).toBe('string')
    return JSON.parse(body as string) as unknown
  }

  const listPage = { data: [], pagination: { limit: 25, nextCursor: null, hasMore: false } }

  it('serializes list options through the shared authenticated client', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          data: [],
          pagination: { limit: 25, nextCursor: null, hasMore: false },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listAgents({
      search: 'research',
      createdFrom: '2026-05-01T00:00:00.000Z',
      createdTo: '2026-05-31T23:59:59.999Z',
      identityAgentId: 'realmroot_agent_1',
      limit: 25,
      cursor: 'cursor_value',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/agents?search=research&createdFrom=2026-05-01T00%3A00%3A00.000Z&createdTo=2026-05-31T23%3A59%3A59.999Z&identityAgentId=realmroot_agent_1&limit=25&cursor=cursor_value',
      expect.objectContaining({
        body: undefined,
        method: 'GET',
      }),
    )
    const headers = fetchMock.mock.calls[0]?.[1]?.headers
    expect(headerValue(headers, 'accept')).toBe('application/json')
    expect(headerValue(headers, 'authorization')).toBe('Bearer e2e:api-test')
    expect(headerValue(headers, 'dpop')).toBeNull()
    expect(headerValue(headers, 'x-ama-project-id')).toBe('project_test')
    expect(headerValue(headers, 'x-ama-client')).toBe('web-rpc')
  })

  it('serializes session label selectors', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ data: [], pagination: { limit: 50, nextCursor: null, hasMore: false } }), {
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listSessions({ labelSelector: 'maintainerId=maint_123' })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/sessions?labelSelector=maintainerId%3Dmaint_123',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('omits optional auth headers when local credentials are absent', async () => {
    window.localStorage.clear()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/v1/configz') {
        return new Response(
          JSON.stringify({
            version: 1,
            service: { name: 'Any Managed Agents', origin: window.location.origin },
            auth: {
              oidc: {
                issuer: 'https://auth.example.com',
                resource: window.location.origin,
                browser: { clientId: 'client_1', scopes: ['openid', 'email', 'profile'] },
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify(listPage), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.listAgents({})

    const headers = fetchMock.mock.calls.find(([input]) => input === '/api/v1/agents')?.[1]?.headers
    expect(headerValue(headers, 'authorization')).toBeNull()
    expect(headerValue(headers, 'x-ama-project-id')).toBeNull()
    expect(headerValue(headers, 'x-ama-client')).toBe('web-rpc')
  })

  // ---------------------------------------------------------------------------
  // ApiError
  // ---------------------------------------------------------------------------
  describe('ApiError', () => {
    it('is an instance of Error', () => {
      const err = new ApiError('msg', 400, { detail: 'bad' })
      expect(err).toBeInstanceOf(Error)
    })

    it('exposes status and details', () => {
      const err = new ApiError('not found', 404, null)
      expect(err.status).toBe(404)
      expect(err.details).toBeNull()
      expect(err.message).toBe('not found')
    })
  })

  // ---------------------------------------------------------------------------
  // rpcRequest — error branches
  // ---------------------------------------------------------------------------
  describe('rpcRequest error handling', () => {
    it('throws ApiError with error.message from JSON body on non-ok response', async () => {
      vi.stubGlobal('fetch', makeJsonFetch({ error: { message: 'Resource not found' } }, 404))
      await expect(api.readAgent('missing-id')).rejects.toMatchObject({
        status: 404,
        message: 'Resource not found',
      })
    })

    it('throws ApiError using statusText when body has no error.message', async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(JSON.stringify({ other: 'thing' }), {
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: { 'content-type': 'application/json' },
        })
      })
      vi.stubGlobal('fetch', fetchMock)
      await expect(api.readAgent('bad-id')).rejects.toMatchObject({
        status: 422,
        message: 'Unprocessable Entity',
      })
    })

    it('throws ApiError using statusText when JSON error has no message', async () => {
      const fetchMock = vi.fn(async () => {
        return new Response(JSON.stringify({ error: {} }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        })
      })
      vi.stubGlobal('fetch', fetchMock)
      await expect(api.readAgent('bad-id')).rejects.toMatchObject({
        status: 400,
        message: 'Bad Request',
      })
    })

    it('throws ApiError with statusText when body is not JSON object', async () => {
      vi.stubGlobal('fetch', makeTextFetch('Internal Server Error', 500))
      await expect(api.readAgent('err-id')).rejects.toMatchObject({
        status: 500,
      })
    })

    it('returns undefined for 204 No Content responses', async () => {
      vi.stubGlobal('fetch', makeEmptyFetch(204))
      const result = await api.deleteTrigger('trigger_1')
      expect(result).toBeUndefined()
    })

    it('returns successful text bodies when the response is not JSON', async () => {
      const result = await rpcRequest<string>(
        Promise.resolve(new Response('plain response', { headers: { 'content-type': 'text/plain' } })),
      )
      expect(result).toBe('plain response')
    })

    it('treats a response without a content-type header as text', async () => {
      const result = await rpcRequest<string>(
        Promise.resolve({
          headers: new Headers(),
          json: async () => ({ unused: true }),
          ok: true,
          status: 200,
          statusText: 'OK',
          text: async () => 'headerless response',
        }),
      )
      expect(result).toBe('headerless response')
    })

    it('uses status text when a JSON error body is null', async () => {
      const response = new Response('null', {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'content-type': 'application/json' },
      })
      await expect(rpcRequest(Promise.resolve(response))).rejects.toMatchObject({
        status: 400,
        message: 'Bad Request',
        details: null,
      })
    })
  })

  describe('typed RPC argument helpers', () => {
    it('builds empty and populated query arguments without undefined values', () => {
      expect(queryOptions()).toEqual({})
      expect(queryOptions({ archived: false, limit: 0, search: undefined })).toEqual({ archived: 'false', limit: '0' })
      expect(queryArg()).toEqual({})
      expect(queryArg({ archived: true })).toEqual({ query: { archived: 'true' } })
    })

    it('keeps path params while adding optional queries and JSON bodies', () => {
      const param = { agentId: 'agent_1' }
      expect(paramQueryArg(param)).toEqual({ param })
      expect(paramQueryArg(param, { limit: 10 })).toEqual({ param, query: { limit: '10' } })
      expect(jsonArg({ name: 'Agent' })).toEqual({ json: { name: 'Agent' } })
    })
  })

  // ---------------------------------------------------------------------------
  // queryOptions — false values included, undefined excluded, 0 included
  // ---------------------------------------------------------------------------
  describe('queryOptions filtering (via listAgents)', () => {
    it('omits undefined values from the query string', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listAgents({ limit: 10 })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).not.toContain('search')
      expect(url).toContain('limit=10')
    })

    it('includes zero values and omits the query string when options are empty', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listAgents({})
      await api.listAgents({ limit: 0 })
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/agents')
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/agents?limit=0')
    })

    it('omits empty query strings for parameterized list endpoints', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listSessionEvents('session_1', {})
      await api.listSessionEvents('session_1', { limit: 0 })
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/sessions/session_1/events')
      expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/sessions/session_1/events?limit=0')
    })
  })

  // ---------------------------------------------------------------------------
  // Auth API
  // ---------------------------------------------------------------------------
  describe('auth API', () => {
    it('readConfigz calls /api/v1/configz', async () => {
      const config = { auth: { oidc: { issuer: 'https://auth.example.com', clientId: 'client_1', scope: 'openid' } } }
      const fetchMock = makeJsonFetch(config)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readConfigz()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/configz')
      expect(result).toEqual(config)
    })

    it('readAuthConfig calls /api/v1/auth/config', async () => {
      const fetchMock = makeJsonFetch({ methods: [] })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readAuthConfig()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/auth/config')
      expect(result).toEqual({ methods: [] })
    })

    it('readAuthConfig passes organization as query param', async () => {
      const fetchMock = makeJsonFetch({ methods: [] })
      vi.stubGlobal('fetch', fetchMock)
      await api.readAuthConfig('my-org')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('organization=my-org')
    })

    it('readCurrentSession calls /api/v1/auth/sessions/current', async () => {
      const session = {
        user: { id: 'u1', email: 'a@b.com', name: null },
        organization: { id: 'o1', name: 'Org' },
        project: { id: 'p1', name: 'Proj' },
      }
      const fetchMock = makeJsonFetch(session)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readCurrentSession()
      expect(result).toEqual(session)
    })
  })

  // ---------------------------------------------------------------------------
  // Projects API
  // ---------------------------------------------------------------------------
  describe('projects API', () => {
    it('listProjects returns the list response', async () => {
      const fetchMock = makeJsonFetch({
        data: [{ id: 'p1', name: 'My Project', createdAt: '', updatedAt: '' }],
        pagination: { limit: 25, nextCursor: null, hasMore: false },
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.listProjects()
      expect(result.data).toHaveLength(1)
      expect(result.data[0]?.id).toBe('p1')
    })

    it('createProject posts the project name', async () => {
      const fetchMock = makeJsonFetch({ id: 'p2', name: 'New Project', createdAt: '', updatedAt: '' })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.createProject({ name: 'New Project' })
      expect(result.id).toBe('p2')
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('[spec: web-console/project-management] updateProject patches the selected project name', async () => {
      const fetchMock = makeJsonFetch({ id: 'p2', name: 'Renamed Project', createdAt: '', updatedAt: '' })
      vi.stubGlobal('fetch', fetchMock)

      const result = await api.updateProject('p2', { name: 'Renamed Project' })

      expect(result.name).toBe('Renamed Project')
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/projects/p2')
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH')
      expect(requestJson(fetchMock, 0)).toEqual({ name: 'Renamed Project' })
    })

    it('[spec: web-console/project-management] deleteProject deletes the selected project', async () => {
      const fetchMock = makeEmptyFetch()
      vi.stubGlobal('fetch', fetchMock)

      await api.deleteProject('p2')

      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/projects/p2')
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE')
    })
  })

  // ---------------------------------------------------------------------------
  // Agents API
  // ---------------------------------------------------------------------------
  describe('agents API', () => {
    const agentFixture = agent({
      id: 'agent_1',
      name: 'Test Agent',
      systemPrompt: 'Do the work.',
      provider: null,
      model: null,
      skills: [],
      allowedTools: [],
      currentVersionId: null,
      createdAt: '',
      updatedAt: '',
    })

    it('readAgent calls GET /api/v1/agents/:agentId', async () => {
      const fetchMock = makeJsonFetch(agentFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readAgent('agent_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/agents/agent_1')
      expect(result.metadata.uid).toBe('agent_1')
    })

    it('createAgent posts JSON', async () => {
      const fetchMock = makeJsonFetch(agentFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.createAgent({ metadata: { name: 'Test Agent' }, spec: { systemPrompt: 'Do the work.' } })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('updateAgent patches the agent', async () => {
      const fetchMock = makeJsonFetch(agentFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.updateAgent('agent_1', { metadata: { name: 'Renamed' } })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/agents/agent_1')
    })

    it('deleteAgent sends DELETE', async () => {
      const fetchMock = makeJsonFetch({})
      vi.stubGlobal('fetch', fetchMock)
      await api.deleteAgent('agent_1')
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE')
    })

    it('listAgentVersions calls the versions sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listAgentVersions('agent_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/agents/agent_1/versions')
    })
  })

  // ---------------------------------------------------------------------------
  // Environments API
  // ---------------------------------------------------------------------------
  describe('environments API', () => {
    const envFixture = environment({
      id: 'env_1',
      name: 'Prod',
      networkPolicy: { mode: 'unrestricted' },
      currentVersionId: null,
      createdAt: '',
      updatedAt: '',
    })

    it('listEnvironments calls /api/v1/environments', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listEnvironments()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/environments')
    })

    it('readEnvironment calls /api/v1/environments/:id', async () => {
      const fetchMock = makeJsonFetch(envFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readEnvironment('env_1')
      expect(result.metadata.uid).toBe('env_1')
    })

    it('createEnvironment posts JSON', async () => {
      const fetchMock = makeJsonFetch(envFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.createEnvironment({ metadata: { name: 'Prod' }, spec: {} })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('updateEnvironment patches the environment', async () => {
      const fetchMock = makeJsonFetch(envFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.updateEnvironment('env_1', { metadata: { name: 'Updated' } })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/environments/env_1')
    })

    it('deleteEnvironment sends DELETE', async () => {
      const fetchMock = makeJsonFetch({})
      vi.stubGlobal('fetch', fetchMock)
      await api.deleteEnvironment('env_1')
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE')
    })

    it('listEnvironmentVersions calls the versions sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listEnvironmentVersions('env_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/environments/env_1/versions')
    })
  })

  // ---------------------------------------------------------------------------
  // Sessions API
  // ---------------------------------------------------------------------------
  describe('sessions API', () => {
    const sessionFixture = {
      metadata: {
        uid: 'sess_1',
        projectId: 'p1',
        name: 'sess_1',
        labels: {},
        annotations: {},
        createdBy: null,
        createdAt: '',
        updatedAt: '',
        archivedAt: null,
      },
      spec: {
        agentId: 'agent_1',
        environmentId: null,
        runtime: 'ama',
        env: {},
        envFrom: [],
        volumes: [],
        volumeMounts: [],
      },
      status: {
        phase: 'running' as const,
        reason: null,
        conditions: [],
        bindings: {
          agent: { versionId: 'av_1', snapshot: {} as never },
          environment: { id: null, versionId: null, snapshot: null },
          runtime: 'ama',
        },
        placement: null,
        startedAt: null,
        closedAt: null,
      },
    }

    it('createSession posts JSON', async () => {
      const fetchMock = makeJsonFetch(sessionFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.createSession({
        spec: {
          agentId: 'agent_1',
          environmentId: 'env_1',
          runtime: 'ama',
        },
        prompt: 'Run AMA session',
      })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('readSession calls /api/v1/sessions/:sessionId', async () => {
      const fetchMock = makeJsonFetch(sessionFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readSession('sess_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/sessions/sess_1')
      expect(result.metadata.uid).toBe('sess_1')
    })

    it('closeSession patches with state:closed', async () => {
      const fetchMock = makeJsonFetch({
        ...sessionFixture,
        status: { ...sessionFixture.status, phase: 'closed' as const },
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.closeSession('sess_1')
      expect(result.status.phase).toBe('closed')
    })

    it('reopenSession patches with state:idle', async () => {
      const fetchMock = makeJsonFetch({
        ...sessionFixture,
        status: { ...sessionFixture.status, phase: 'idle' as const },
      })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.reopenSession('sess_1')
      expect(result.status.phase).toBe('idle')
    })

    it('deleteSession sends DELETE', async () => {
      const fetchMock = makeJsonFetch({})
      vi.stubGlobal('fetch', fetchMock)
      await api.deleteSession('sess_1')
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE')
    })

    it('sendSessionMessage posts to messages sub-resource', async () => {
      const msg = {
        id: 'msg_1',
        sessionId: 'sess_1',
        type: 'prompt' as const,
        content: 'hello',
        delivery: 'live' as const,
        state: 'accepted' as const,
        error: null,
        createdAt: '',
        updatedAt: '',
      }
      const fetchMock = makeJsonFetch(msg)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.sendSessionMessage('sess_1', 'hello')
      expect(result.content).toBe('hello')
    })

    it('listSessionEvents calls the events sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listSessionEvents('sess_1', { limit: 10, order: 'asc' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/sessions/sess_1/events')
      expect(url).toContain('limit=10')
    })

    it('listSessionApprovals calls the approvals sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listSessionApprovals('sess_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/sessions/sess_1/approvals')
    })

    it('decideSessionApproval patches the approval', async () => {
      const approval = {
        id: 'apr_1',
        sessionId: 'sess_1',
        toolCallId: 'tc_1',
        toolName: 'bash',
        input: {},
        relatedEventIds: [],
        state: 'approved' as const,
        reason: null,
        result: null,
        requestedAt: '',
        decidedAt: '',
        createdAt: '',
        updatedAt: '',
      }
      const fetchMock = makeJsonFetch(approval)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.decideSessionApproval('sess_1', 'apr_1', { decision: 'approve' })
      expect(result.state).toBe('approved')
    })
  })

  // ---------------------------------------------------------------------------
  // Triggers API
  // ---------------------------------------------------------------------------
  describe('triggers API', () => {
    const triggerFixture = {
      metadata: {
        uid: 'trigger_1',
        projectId: 'project_1',
        name: 'Nightly run',
        description: null,
        labels: {},
        annotations: {},
        createdBy: 'user_1',
        createdAt: '',
        updatedAt: '',
        archivedAt: null,
      },
      spec: {
        source: {
          type: 'schedule' as const,
          schedule: { type: 'interval' as const, intervalSeconds: 3600, windowSeconds: 0 },
        },
        suspend: false,
        template: {
          metadata: { labels: {}, annotations: {} },
          spec: {
            agentId: 'agent_1',
            environmentId: null,
            runtime: 'ama' as const,
            promptTemplate: 'Run checks',
            env: {},
            envFrom: [],
            volumes: [],
            volumeMounts: [],
          },
        },
      },
      status: { phase: 'active' as const, nextDueAt: null, lastDispatchedAt: null, lastRunId: null },
    }

    it('listTriggers serializes list options', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listTriggers({ suspend: false, limit: 10 })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/triggers')
      expect(url).toContain('suspend=false')
      expect(url).toContain('limit=10')
    })

    it('createTrigger posts JSON', async () => {
      const fetchMock = makeJsonFetch(triggerFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.createTrigger({
        metadata: { name: 'Nightly run' },
        spec: {
          source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600, windowSeconds: 0 } },
          suspend: false,
          template: {
            metadata: { labels: {}, annotations: {} },
            spec: {
              agentId: 'agent_1',
              environmentId: null,
              runtime: 'ama',
              promptTemplate: 'Run checks',
              env: {},
              envFrom: [],
              volumes: [],
              volumeMounts: [],
            },
          },
        },
      })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('readTrigger calls /api/v1/triggers/:triggerId', async () => {
      const fetchMock = makeJsonFetch(triggerFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readTrigger('trigger_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/triggers/trigger_1')
      expect(result.metadata.uid).toBe('trigger_1')
    })

    it('updateTrigger patches the trigger', async () => {
      const fetchMock = makeJsonFetch(triggerFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.updateTrigger('trigger_1', { spec: { suspend: true } })
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toContain('/api/v1/triggers/trigger_1')
      expect(init?.method).toBe('PATCH')
    })

    it('deleteTrigger deletes the trigger', async () => {
      const fetchMock = makeEmptyFetch(204)
      vi.stubGlobal('fetch', fetchMock)
      await api.deleteTrigger('trigger_1')
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toContain('/api/v1/triggers/trigger_1')
      expect(init?.method).toBe('DELETE')
    })

    it('listTriggerRuns calls the runs sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listTriggerRuns('trigger_1', { limit: 5 })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/triggers/trigger_1/runs')
      expect(url).toContain('limit=5')
    })
  })

  // ---------------------------------------------------------------------------
  // Memory Stores API
  // ---------------------------------------------------------------------------
  describe('memory stores API', () => {
    const memoryStoreFixture = {
      metadata: {
        uid: 'mem_1',
        projectId: 'project_1',
        name: 'Project memory',
        description: null,
        labels: {},
        annotations: {},
        createdBy: 'user_1',
        createdAt: '',
        updatedAt: '',
        archivedAt: null,
      },
      spec: { scope: 'project' as const },
      status: { phase: 'active' as const, memoryCount: 0 },
    }
    const memoryFixture = {
      metadata: {
        uid: 'memory_1',
        projectId: 'project_1',
        name: 'facts.md',
        description: null,
        labels: {},
        annotations: {},
        createdBy: 'user_1',
        createdAt: '',
        updatedAt: '',
        archivedAt: null,
      },
      spec: { storeId: 'mem_1', path: 'facts.md', content: 'facts' },
      status: { phase: 'active' as const },
    }

    it('listMemoryStores serializes list options', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listMemoryStores({ search: 'project' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/memory-stores')
      expect(url).toContain('search=project')
    })

    it('reads, creates, updates, and deletes memory stores', async () => {
      const fetchMock = makeJsonFetch(memoryStoreFixture)
      vi.stubGlobal('fetch', fetchMock)

      await api.readMemoryStore('mem_1')
      await api.createMemoryStore({ metadata: { name: 'Project memory' }, spec: {} })
      await api.updateMemoryStore('mem_1', { metadata: { description: 'Shared facts' } })
      await api.deleteMemoryStore('mem_1')

      expect(fetchMock.mock.calls[0]?.[0] as string).toContain('/api/v1/memory-stores/mem_1')
      expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST')
      expect(requestJson(fetchMock, 1)).toEqual({ metadata: { name: 'Project memory' }, spec: {} })
      expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PATCH')
      expect(requestJson(fetchMock, 2)).toEqual({ metadata: { description: 'Shared facts' } })
      expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('DELETE')
    })

    it('manages memory records under a memory store', async () => {
      const fetchMock = makeJsonFetch(memoryFixture)
      vi.stubGlobal('fetch', fetchMock)

      await api.listMemoryStoreMemories('mem_1', { limit: 5 })
      await api.createMemoryStoreMemory('mem_1', { path: 'facts.md', content: 'facts' })
      await api.updateMemoryStoreMemory('mem_1', 'memory_1', { content: 'new facts' })
      await api.deleteMemoryStoreMemory('mem_1', 'memory_1')

      expect(fetchMock.mock.calls[0]?.[0] as string).toContain('/api/v1/memory-stores/mem_1/memories')
      expect(fetchMock.mock.calls[0]?.[0] as string).toContain('limit=5')
      expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST')
      expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('PATCH')
      expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('DELETE')
    })
  })

  // ---------------------------------------------------------------------------
  // Providers API
  // ---------------------------------------------------------------------------
  describe('providers API', () => {
    const providerFixture = {
      id: 'prov_1',
      slug: 'anthropic',
      displayName: 'Anthropic',
      enabled: true,
      metadata: {},
      modelCatalogState: 'ready',
      lastError: null,
      createdAt: '',
      updatedAt: '',
    }

    it('listProviders calls /api/v1/providers', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listProviders()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/providers')
    })

    it('listModels calls /api/v1/providers/models', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listModels()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/providers/models')
    })

    it('readProvider calls /api/v1/providers/:providerId', async () => {
      const fetchMock = makeJsonFetch(providerFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readProvider('prov_1')
      expect(result.id).toBe('prov_1')
    })

    it('listProviderModels calls the models sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listProviderModels('prov_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/providers/prov_1/models')
    })

    it('refreshCatalog posts to /api/v1/providers/refresh', async () => {
      const fetchMock = makeJsonFetch({ outcome: 'succeeded', discoveredCount: 3, vendors: 2 })
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.refreshCatalog()
      expect(result.outcome).toBe('succeeded')
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toContain('/api/v1/providers/refresh')
      expect(init?.method).toBe('POST')
    })
  })

  // ---------------------------------------------------------------------------
  // Vaults API
  // ---------------------------------------------------------------------------
  describe('vaults API', () => {
    const vaultFixture = vault({ id: 'vault_1', name: 'My Vault', createdAt: '', updatedAt: '' })

    it('listVaults calls /api/v1/vaults', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listVaults()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/vaults')
    })

    it('readVault calls /api/v1/vaults/:vaultId', async () => {
      const fetchMock = makeJsonFetch(vaultFixture)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readVault('vault_1')
      expect(result.metadata.uid).toBe('vault_1')
    })

    it('createVault posts JSON', async () => {
      const fetchMock = makeJsonFetch(vaultFixture)
      vi.stubGlobal('fetch', fetchMock)
      await api.createVault({ metadata: { name: 'My Vault' }, spec: {} })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
      expect(requestJson(fetchMock, 0)).toEqual({ metadata: { name: 'My Vault' }, spec: {} })
    })

    it('deleteVault sends DELETE', async () => {
      const fetchMock = makeJsonFetch({})
      vi.stubGlobal('fetch', fetchMock)
      await api.deleteVault('vault_1')
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE')
    })

    it('listVaultCredentials calls the credentials sub-resource', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listVaultCredentials('vault_1', { search: 'test' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/vaults/vault_1/credentials')
      expect(url).toContain('search=test')
    })

    it('createVaultCredential posts to credentials sub-resource', async () => {
      const fetchMock = makeJsonFetch(
        credential({ id: 'cred_1', vaultId: 'vault_1', name: 'API Key', activeVersion: null }),
      )
      vi.stubGlobal('fetch', fetchMock)
      await api.createVaultCredential('vault_1', {
        name: 'API Key',
        type: 'opaque',
        secret: { stringData: { value: 'raw' } },
      })
      const [, init] = fetchMock.mock.calls[0]!
      expect(init?.method).toBe('POST')
    })

    it('updateVaultCredentialSecret puts to the credential resource', async () => {
      const rotated = credential({
        id: 'cred_1',
        vaultId: 'vault_1',
        activeVersionId: 'ver_1',
        activeVersion: {
          metadata: {
            uid: 'ver_1',
            projectId: 'project_1',
            name: 'Credential v2',
            description: null,
            labels: {},
            annotations: {},
            createdBy: 'user_1',
            createdAt: '',
            updatedAt: '',
          },
          spec: {
            credentialId: 'cred_1',
            vaultId: 'vault_1',
            organizationId: 'org_1',
            version: 2,
            provider: 'ama',
            secretRef: 'ref',
            referenceName: 'ref',
            hasSecret: true,
            dataKeys: ['value'],
            metadata: {},
          },
          status: { phase: 'active', supersededAt: null, revokedAt: null },
        },
      })
      const fetchMock = makeJsonFetch(rotated)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.updateVaultCredentialSecret('vault_1', 'cred_1', {
        stringData: { value: 'newsecret' },
      })
      expect(result.status.activeVersion?.metadata.uid).toBe('ver_1')
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url as string).toContain('/api/v1/vaults/vault_1/credentials/cred_1')
      expect(init?.method).toBe('PUT')
    })

    it('revokeVaultCredential patches with state:revoked', async () => {
      const fetchMock = makeJsonFetch(
        credential({
          id: 'cred_1',
          vaultId: 'vault_1',
          name: 'API Key',
          phase: 'revoked',
          activeVersion: null,
          revokedAt: '2026-01-01',
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.revokeVaultCredential('vault_1', 'cred_1', 'no longer needed')
      expect(result.status.phase).toBe('revoked')
    })

    it('revokeVaultCredential works without a revokeReason', async () => {
      const fetchMock = makeJsonFetch(
        credential({
          id: 'cred_1',
          vaultId: 'vault_1',
          name: 'API Key',
          phase: 'revoked',
          activeVersion: null,
          revokedAt: '2026-01-01',
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.revokeVaultCredential('vault_1', 'cred_1')
      expect(result.status.phase).toBe('revoked')
    })
  })

  // ---------------------------------------------------------------------------
  // Connectors & Connections API
  // ---------------------------------------------------------------------------
  describe('connectors API', () => {
    it('listConnectors calls /api/v1/connectors', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listConnectors({ search: 'github', category: 'vcs' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/connectors')
      expect(url).toContain('search=github')
    })

    it('readConnector calls /api/v1/connectors/:connectorId', async () => {
      const connector = {
        id: 'conn_1',
        name: 'GitHub',
        description: 'GitHub connector',
        category: 'vcs',
        trustLevel: 'high',
        capabilities: [],
        supportedAuthModes: [],
        setupRequirements: [],
        allowedTools: [],
        metadata: {},
        availability: 'available' as const,
        createdAt: '',
        updatedAt: '',
      }
      const fetchMock = makeJsonFetch(connector)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readConnector('conn_1')
      expect(result.id).toBe('conn_1')
    })
  })

  // ---------------------------------------------------------------------------
  // Governance API (budgets)
  // ---------------------------------------------------------------------------
  describe('governance API', () => {
    it('listBudgets calls /api/v1/budgets', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listBudgets()
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/budgets')
    })
  })

  // ---------------------------------------------------------------------------
  // Usage API
  // ---------------------------------------------------------------------------
  describe('usage API', () => {
    it('readUsageSummary calls /api/v1/usage-summary', async () => {
      const summary = {
        groupBy: 'provider' as const,
        totals: {
          records: 0,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          durationMs: 0,
          costMicros: 0,
          currency: 'USD',
        },
        groups: [],
      }
      const fetchMock = makeJsonFetch(summary)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readUsageSummary({ groupBy: 'provider' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/usage-summary')
      expect(result.groupBy).toBe('provider')
    })

    it('listUsageRecords calls /api/v1/usage-records', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listUsageRecords({ limit: 50 })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/usage-records')
      expect(url).toContain('limit=50')
    })
  })

  // ---------------------------------------------------------------------------
  // Audit API
  // ---------------------------------------------------------------------------
  describe('audit API', () => {
    const auditRecord = {
      id: 'rec_1',
      projectId: 'p1',
      actorUserId: 'u1',
      actorType: 'user',
      action: 'create',
      resourceType: 'agent',
      resourceId: 'agent_1',
      outcome: 'success',
      requestId: null,
      correlationId: null,
      sessionId: null,
      policyCategory: null,
      metadata: {},
      before: {},
      after: {},
      createdAt: '',
    }

    it('listAuditRecords calls /api/v1/audit-records', async () => {
      const fetchMock = makeJsonFetch(listPage)
      vi.stubGlobal('fetch', fetchMock)
      await api.listAuditRecords({ action: 'create' })
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/audit-records')
    })

    it('readAuditRecord calls /api/v1/audit-records/:recordId', async () => {
      const fetchMock = makeJsonFetch(auditRecord)
      vi.stubGlobal('fetch', fetchMock)
      const result = await api.readAuditRecord('rec_1')
      const url = fetchMock.mock.calls[0]?.[0] as string
      expect(url).toContain('/api/v1/audit-records/rec_1')
      expect(result.id).toBe('rec_1')
    })
  })
})
