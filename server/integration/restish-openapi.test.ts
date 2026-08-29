import { SELF } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn } from './auth'

interface OpenApiOperation {
  operationId?: string
  tags?: string[]
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
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

async function openApiOperationIds() {
  const res = await SELF.fetch('https://example.com/api/v1/openapi.json')
  expect(res.status).toBe(200)
  const doc = (await res.json()) as OpenApiDocument

  return new Set(
    Object.values(doc.paths).flatMap((pathItem) =>
      Object.entries(pathItem)
        .filter(([method]) => METHODS.has(method))
        .map(([, operation]) => operation.operationId),
    ),
  )
}

describe('[CF] Realmroot toolbox/OpenAPI control-plane path [spec: api-contracts/realmroot-toolbox]', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('discovers the documented resource groups from /api/v1/openapi.json', async () => {
    const operationIds = await openApiOperationIds()

    expect(Array.from(operationIds)).toEqual(
      expect.arrayContaining([
        'readConfigz',
        'listAgents',
        'listEnvironments',
        'listSessions',
        'listProviders',
        'listVaults',
        'listUsageRecords',
        'readUsageSummary',
        'listAuditRecords',
        'listWorkItems',
        'listConnectors',
      ]),
    )
  })

  it('exercises the core restish resource workflow over documented /api/v1 paths', async () => {
    const authorization = await signIn()

    const environmentRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify(
        createResourceBody(
          { name: 'Restish e2e environment' },
          {
            packages: { ...EMPTY_PACKAGES, npm: ['tsx@latest'] },
            networking: {
              type: 'limited',
              allowMcpServers: false,
              allowPackageManagers: true,
              allowedHosts: ['registry.npmjs.org'],
            },
          },
        ),
      ),
    })
    expect(environmentRes.status).toBe(201)
    const environment = (await environmentRes.json()) as {
      metadata: { uid: string }
      status: { currentVersionId: string }
    }
    const environmentId = environment.metadata.uid

    const agentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(
        createResourceBody(
          { name: 'Restish e2e agent' },
          {
            systemPrompt: 'Run e2e checks through documented control-plane operations.',
            provider: 'workers-ai',
            model: '@cf/moonshotai/kimi-k2.6',
          },
        ),
      ),
    })
    expect(agentRes.status).toBe(201)
    const agent = (await agentRes.json()) as { metadata: { uid: string }; status: { currentVersionId: string } }
    const agentId = agent.metadata.uid

    const sessionRes = await jsonFetch('/api/v1/sessions', authorization, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'Run restish contract test',
        spec: { agentId, environmentId, runtime: 'ama' },
      }),
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as {
      metadata: { uid: string }
      spec: { agentId: string; environmentId: string | null }
      status: {
        phase: string
        bindings: {
          agent: { versionId: string }
          environment: { versionId: string | null }
        }
      }
    }

    expect(session).toMatchObject({
      spec: { agentId, environmentId },
      status: {
        phase: 'idle',
        bindings: {
          agent: { versionId: agent.status.currentVersionId },
          environment: { versionId: environment.status.currentVersionId },
        },
      },
    })

    const socketRes = await jsonFetch(`/api/v1/sessions/${session.metadata.uid}/socket`, authorization)
    expect(socketRes.status).toBe(403)
  })
})
