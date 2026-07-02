import { SELF } from 'cloudflare:test'
import { AMA_RUNNER_SANDBOX_CAPABILITY } from '@server/domain/runtime-catalog'
import { AMA_ANNOTATION_KEY_ROUTING_KEY_HASH } from '@server/metadata-keys'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedPlatformProvider, setupOidcProvider, signIn, signInUser } from './auth'

const AMA_RUNNER_CAPABILITY = AMA_RUNNER_SANDBOX_CAPABILITY
const EMPTY_PACKAGES = { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] } as const

function createResourceBody(metadata: { name: string; description?: string }, spec: Record<string, unknown> = {}) {
  return { metadata, spec }
}

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  return await SELF.fetch(`https://example.com${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization,
      ...init.headers,
    },
  })
}

async function createEnvironment(authorization: string) {
  const res = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify(
      createResourceBody(
        {
          name: `Trigger workspace ${crypto.randomUUID()}`,
        },
        {
          type: 'cloud',
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
          name: `Trigger agent ${crypto.randomUUID()}`,
        },
        {
          systemPrompt: 'Run scheduled work.',
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

async function createRuntimeCredential(authorization: string) {
  const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
    method: 'POST',
    body: JSON.stringify(createResourceBody({ name: `Trigger runtime secrets ${crypto.randomUUID()}` })),
  })
  expect(vaultRes.status).toBe(201)
  const vault = (await vaultRes.json()) as { metadata: { uid: string } }
  const credentialRes = await jsonFetch(`/api/v1/vaults/${vault.metadata.uid}/credentials`, authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: 'AK agent session key',
      type: 'opaque',
      secret: { stringData: { value: 'raw-ak-agent-key' } },
    }),
  })
  expect(credentialRes.status).toBe(201)
  const credential = (await credentialRes.json()) as {
    metadata: { uid: string }
    status: { activeVersionId: string; activeVersion: { spec: { secretRef: string } } }
  }
  return {
    id: credential.metadata.uid,
    activeVersionId: credential.status.activeVersionId,
    activeVersion: { secretRef: credential.status.activeVersion.spec.secretRef },
  }
}

async function registerActiveRunner(authorization: string, environmentId: string) {
  const capabilities = [AMA_RUNNER_CAPABILITY]
  const runnerRes = await jsonFetch('/api/v1/runners', authorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Trigger runner ${crypto.randomUUID()}`,
      environmentId,
      capabilities,
      maxConcurrent: 2,
    }),
  })
  expect(runnerRes.status).toBe(201)
  const runner = (await runnerRes.json()) as { id: string }
  const heartbeatRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, authorization, {
    method: 'PUT',
    body: JSON.stringify({ state: 'active', capabilities }),
  })
  expect(heartbeatRes.status).toBe(200)
  return runner
}

async function createTrigger(
  authorization: string,
  agentId: string,
  environmentId: string,
  data: Record<string, unknown> = {},
) {
  const hasNextDueAt = Object.hasOwn(data, 'nextDueAt')
  const { name = `Trigger ${crypto.randomUUID()}`, source, suspend, template, nextDueAt, ...rest } = data
  const res = await jsonFetch('/api/v1/triggers', authorization, {
    method: 'POST',
    body: JSON.stringify({
      metadata: { name },
      spec: {
        source: source ?? { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600 } },
        ...(suspend === undefined ? {} : { suspend }),
        ...(hasNextDueAt ? (nextDueAt === undefined ? {} : { nextDueAt }) : { nextDueAt: '2026-05-26T12:00:00.000Z' }),
        template: template ?? {
          metadata: { labels: {}, annotations: {} },
          spec: {
            agentId,
            environmentId,
            runtime: 'ama',
            promptTemplate: 'Run scheduled work.',
            env: {},
            envFrom: [],
            volumes: [],
            volumeMounts: [],
          },
        },
        ...rest,
      },
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as {
    metadata: { uid: string; name: string; archivedAt: string | null }
    spec: {
      source: { type: 'schedule'; schedule: { intervalSeconds: number; windowSeconds: number } } | { type: 'http' }
      suspend: boolean
      template: {
        metadata: { labels: Record<string, string>; annotations: Record<string, string> }
        spec: {
          agentId: string
          environmentId: string | null
          runtime: string
          promptTemplate: string
          volumes: Record<string, unknown>[]
          volumeMounts: Record<string, unknown>[]
          env: Record<string, string>
          envFrom: Array<{ type: 'secret'; name: string; secretRef: string }>
        }
      }
    }
    status: { nextDueAt: string | null; phase: string }
  }
}

describe('[CF] /api/v1/triggers', () => {
  beforeEach(async () => {
    await setupOidcProvider()
    await seedPlatformProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates, lists, reads, updates, pauses, archives, restores, and audits triggers [spec: triggers/api-crud]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const first = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Alpha heartbeat',
      template: {
        metadata: { labels: {}, annotations: { lane: 'alpha' } },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          runtime: 'ama',
          promptTemplate: 'Run scheduled work.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
    })
    const firstId = first.metadata.uid
    expect(first.spec.suspend).toBe(false)
    expect(first.metadata.archivedAt).toBeNull()
    expect(first).not.toHaveProperty('organizationId')
    const second = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Beta heartbeat',
      source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 7200, windowSeconds: 300 } },
      suspend: true,
      template: {
        metadata: { labels: {}, annotations: { lane: 'beta' } },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          runtime: 'ama',
          promptTemplate: 'Run scheduled work.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
    })
    const secondId = second.metadata.uid
    expect(second.spec.suspend).toBe(true)

    const listRes = await jsonFetch('/api/v1/triggers?limit=1', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      data: Array<{ metadata: { uid: string; name: string } }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(list.data).toHaveLength(1)
    expect(list.pagination.hasMore).toBe(true)

    const nextPageRes = await jsonFetch(`/api/v1/triggers?limit=1&cursor=${list.pagination.nextCursor}`, authorization)
    expect(nextPageRes.status).toBe(200)
    const nextPage = (await nextPageRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(nextPage.data.map((trigger) => trigger.metadata.uid)).not.toEqual(
      list.data.map((trigger) => trigger.metadata.uid),
    )

    const searchRes = await jsonFetch('/api/v1/triggers?search=Alpha', authorization)
    expect(searchRes.status).toBe(200)
    await expect(searchRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ metadata: expect.objectContaining({ uid: firstId, name: 'Alpha heartbeat' }) })],
    })

    const pausedRes = await jsonFetch('/api/v1/triggers?suspend=true', authorization)
    expect(pausedRes.status).toBe(200)
    await expect(pausedRes.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          metadata: expect.objectContaining({ uid: secondId }),
          spec: expect.objectContaining({ suspend: true }),
        }),
      ],
    })

    const readRes = await jsonFetch(`/api/v1/triggers/${secondId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      metadata: { uid: secondId },
      spec: {
        source: { schedule: { intervalSeconds: 7200, windowSeconds: 300 } },
        template: { metadata: { annotations: { lane: 'beta' } } },
      },
    })

    const patchRes = await jsonFetch(`/api/v1/triggers/${secondId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        metadata: { name: 'Beta heartbeat updated' },
        spec: {
          suspend: false,
          source: { type: 'schedule', schedule: { intervalSeconds: 1800, windowSeconds: 60 } },
          nextDueAt: '2026-05-26T13:00:00.000Z',
          template: { metadata: { annotations: { lane: 'beta', updated: 'true' } } },
        },
      }),
    })
    expect(patchRes.status).toBe(200)
    await expect(patchRes.json()).resolves.toMatchObject({
      metadata: { uid: secondId, name: 'Beta heartbeat updated' },
      spec: {
        suspend: false,
        source: { schedule: { intervalSeconds: 1800, windowSeconds: 60 } },
        template: { metadata: { annotations: { lane: 'beta', updated: 'true' } } },
      },
      status: { nextDueAt: '2026-05-26T13:00:00.000Z' },
    })

    const invalidPatchRes = await jsonFetch(`/api/v1/triggers/${firstId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { source: { type: 'schedule', schedule: { intervalSeconds: 30 } } } }),
    })
    expect(invalidPatchRes.status).toBe(400)

    const archiveRes = await jsonFetch(`/api/v1/triggers/${firstId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    await expect(archiveRes.json()).resolves.toMatchObject({
      metadata: { uid: firstId, archivedAt: expect.any(String) },
    })

    const archivedReadRes = await jsonFetch(`/api/v1/triggers/${firstId}`, authorization)
    expect(archivedReadRes.status).toBe(200)
    await expect(archivedReadRes.json()).resolves.toMatchObject({
      metadata: { uid: firstId, archivedAt: expect.any(String) },
    })

    const defaultListRes = await jsonFetch('/api/v1/triggers', authorization)
    const defaultList = (await defaultListRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(defaultList.data).not.toContainEqual(expect.objectContaining({ metadata: { uid: firstId } }))

    const archivedListRes = await jsonFetch('/api/v1/triggers?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(archivedList.data).toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ uid: firstId }) }),
    )

    const updateArchivedRes = await jsonFetch(`/api/v1/triggers/${firstId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { name: 'Cannot touch this' } }),
    })
    expect(updateArchivedRes.status).toBe(409)
    await expect(updateArchivedRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Archived triggers cannot be updated' },
    })

    const restoreRes = await jsonFetch(`/api/v1/triggers/${firstId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(restoreRes.status).toBe(200)
    await expect(restoreRes.json()).resolves.toMatchObject({ metadata: { uid: firstId, archivedAt: null } })

    const auditRes = await jsonFetch('/api/v1/audit-records?action=trigger', authorization)
    expect(auditRes.status).toBe(200)
    const audit = (await auditRes.json()) as { data: Array<{ action: string; resourceId: string }> }
    expect(audit.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'trigger.create', resourceId: firstId }),
        expect.objectContaining({ action: 'trigger.update', resourceId: secondId }),
        expect.objectContaining({ action: 'trigger.archive', resourceId: firstId }),
      ]),
    )
  })

  it('rejects secret-like metadata keys on create and update before storing trigger metadata', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)

    const createRes = await jsonFetch('/api/v1/triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        metadata: { name: 'Rejected secret metadata heartbeat' },
        spec: {
          source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600 } },
          template: {
            metadata: { labels: {}, annotations: { private_key: 'raw-private-key-value' } },
            spec: {
              agentId: agent.id,
              environmentId: environment.id,
              runtime: 'ama',
              promptTemplate: 'Should not persist.',
              env: {},
              envFrom: [],
              volumes: [],
              volumeMounts: [],
            },
          },
        },
      }),
    })
    expect(createRes.status).toBe(400)
    await expect(createRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: {
          fields: {
            template: 'Secret material must be stored in secret references.',
          },
        },
      },
    })

    const searchRejectedRes = await jsonFetch('/api/v1/triggers?search=Rejected secret metadata', authorization)
    expect(searchRejectedRes.status).toBe(200)
    await expect(searchRejectedRes.json()).resolves.toMatchObject({ data: [] })

    const envCreateRes = await jsonFetch('/api/v1/triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        metadata: { name: 'Rejected envFrom heartbeat' },
        spec: {
          source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600 } },
          template: {
            metadata: { labels: {}, annotations: {} },
            spec: {
              agentId: agent.id,
              environmentId: environment.id,
              runtime: 'ama',
              promptTemplate: 'Should not persist either.',
              env: { AK_API_TOKEN: 'raw-token-value' },
              envFrom: [],
              volumes: [],
              volumeMounts: [],
            },
          },
        },
      }),
    })
    expect(envCreateRes.status).toBe(400)
    await expect(envCreateRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: {
          fields: {
            env: 'Environment variables must not contain raw secret material.',
          },
        },
      },
    })

    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Safe metadata heartbeat',
      template: {
        metadata: { labels: {}, annotations: { owner: 'platform' } },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          runtime: 'ama',
          promptTemplate: 'Run scheduled work.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
    })
    const triggerId = trigger.metadata.uid
    const updateRes = await jsonFetch(`/api/v1/triggers/${triggerId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        spec: {
          template: {
            metadata: {
              annotations: {
                privateKey: 'raw-private-key-value',
              },
            },
          },
        },
      }),
    })
    expect(updateRes.status).toBe(400)
    await expect(updateRes.json()).resolves.toMatchObject({
      error: {
        type: 'validation_error',
        details: {
          fields: {
            template: 'Secret material must be stored in secret references.',
          },
        },
      },
    })

    const readRes = await jsonFetch(`/api/v1/triggers/${triggerId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      metadata: { uid: triggerId },
      spec: { template: { metadata: { annotations: { owner: 'platform' } } } },
    })
  })

  it('creates one session per due trigger occurrence and exposes run resources [spec: triggers/dispatch]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const credential = await createRuntimeCredential(authorization)
    const dueAt = '2026-05-26T12:00:00.000Z'
    const heartbeatAt = '2026-05-26T12:01:00.000Z'

    const createRes = await jsonFetch('/api/v1/triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        metadata: { name: 'Banking bonus heartbeat' },
        spec: {
          source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600 } },
          nextDueAt: dueAt,
          template: {
            metadata: { labels: {}, annotations: { externalRunGroup: 'banking-bonus' } },
            spec: {
              agentId: agent.id,
              environmentId: environment.id,
              runtime: 'ama',
              promptTemplate: 'Research current Canadian banking bonus offers.',
              volumes: [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/agent-kanban.git' }],
              volumeMounts: [{ name: 'repo', mountPath: '/workspace/repos/saltbo/agent-kanban' }],
              env: { AK_API_URL: 'http://localhost:8788', AK_WORKER: agent.id },
              envFrom: [
                {
                  type: 'secret',
                  name: 'AK_AGENT_KEY',
                  secretRef: credential.activeVersion.secretRef,
                },
              ],
            },
          },
        },
      }),
    })
    expect(createRes.status).toBe(201)
    const trigger = (await createRes.json()) as {
      metadata: { uid: string }
      spec: {
        suspend: boolean
        source: { type: 'schedule'; schedule: { intervalSeconds: number } }
        template: {
          spec: {
            volumes: Record<string, unknown>[]
            volumeMounts: Record<string, unknown>[]
            env: Record<string, string>
            envFrom: Array<{ type: 'secret'; name: string; secretRef: string }>
          }
        }
      }
      status: { nextDueAt: string }
    }
    const triggerId = trigger.metadata.uid
    expect(trigger).toMatchObject({
      spec: {
        suspend: false,
        source: { schedule: { intervalSeconds: 3600 } },
        template: {
          spec: {
            volumes: [{ name: 'repo', type: 'git_repository', url: 'https://github.com/saltbo/agent-kanban.git' }],
            volumeMounts: [{ name: 'repo', mountPath: '/workspace/repos/saltbo/agent-kanban' }],
            env: { AK_API_URL: 'http://localhost:8788', AK_WORKER: agent.id },
            envFrom: [
              {
                type: 'secret',
                name: 'AK_AGENT_KEY',
                secretRef: credential.activeVersion.secretRef,
              },
            ],
          },
        },
      },
      status: { nextDueAt: dueAt },
    })

    const dispatchRes = await jsonFetch('/api/v1/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt }),
    })
    expect(dispatchRes.status).toBe(200)
    const dispatch = (await dispatchRes.json()) as {
      claimed: number
      dispatched: number
      skipped: number
      runs: Array<{ runId: string; sessionId: string; scheduledFor: string }>
    }
    expect(dispatch).toMatchObject({
      claimed: 1,
      dispatched: 1,
      skipped: 0,
    })
    const sessionId = dispatch.runs[0]?.sessionId
    expect(sessionId).toBeTruthy()

    const duplicateDispatchRes = await jsonFetch('/api/v1/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt }),
    })
    expect(duplicateDispatchRes.status).toBe(200)
    await expect(duplicateDispatchRes.json()).resolves.toMatchObject({
      claimed: 0,
      dispatched: 0,
      runs: [],
    })

    const runsRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization)
    expect(runsRes.status).toBe(200)
    const runs = (await runsRes.json()) as {
      data: Array<{
        metadata: { uid: string }
        spec: {
          triggerId: string
          scheduledFor: string
        }
        status: { sessionId: string; phase: string; triggeredAt: string; correlationId: string; idempotencyKey: string }
      }>
    }
    expect(runs.data).toHaveLength(1)
    expect(runs.data[0]).toMatchObject({
      spec: {
        triggerId,
        scheduledFor: dueAt,
      },
      status: {
        sessionId,
        phase: 'dispatched',
        triggeredAt: heartbeatAt,
        correlationId: `schedule:${triggerId}:${dueAt}`,
        idempotencyKey: `${triggerId}:${dueAt}`,
      },
    })

    const runItemRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs/${runs.data[0].metadata.uid}`, authorization)
    expect(runItemRes.status).toBe(200)
    await expect(runItemRes.json()).resolves.toMatchObject({
      metadata: { uid: runs.data[0].metadata.uid },
      spec: { triggerId },
      status: { sessionId, phase: 'dispatched' },
    })

    const missingRunRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs/trigrun_missing`, authorization)
    expect(missingRunRes.status).toBe(404)

    const filteredRunsRes = await jsonFetch(
      `/api/v1/triggers/${triggerId}/runs?state=dispatched&search=${encodeURIComponent(triggerId)}&limit=1`,
      authorization,
    )
    expect(filteredRunsRes.status).toBe(200)
    await expect(filteredRunsRes.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          spec: expect.objectContaining({ triggerId }),
          status: expect.objectContaining({ sessionId, phase: 'dispatched' }),
        }),
      ],
      pagination: expect.objectContaining({ hasMore: false }),
    })

    const failedRunsRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs?state=failed`, authorization)
    expect(failedRunsRes.status).toBe(200)
    await expect(failedRunsRes.json()).resolves.toMatchObject({ data: [] })
  })

  it('creates an HTTP trigger run from request fields [spec: triggers/http-dispatch]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Ticket webhook',
      source: { type: 'http' },
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          runtime: 'ama',
          promptTemplate: 'Handle ticket {{ body.ticket.id }} from {{ query.source }} via {{ headers.x-source }}.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
      nextDueAt: undefined,
    })
    const triggerId = trigger.metadata.uid
    expect(trigger).toMatchObject({
      spec: { source: { type: 'http' } },
      status: { nextDueAt: null },
    })

    const runRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs?source=portal`, authorization, {
      method: 'POST',
      headers: { 'x-source': 'zendesk', 'idempotency-key': 'ticket-123' },
      body: JSON.stringify({
        ticket: { id: 'T-123' },
        metadata: {
          labels: { 'agent-kanban.dev/session-key': 'github:owner/repo:issue:123' },
          annotations: { 'agent-kanban.dev/source-event': 'issues.opened' },
        },
      }),
    })
    expect(runRes.status).toBe(201)
    const run = (await runRes.json()) as {
      metadata: { uid: string }
      spec: { triggerId: string; scheduledFor: string | null; metadata: Record<string, unknown> }
      status: {
        phase: string
        sessionId: string | null
        heartbeatAt: string | null
        triggeredAt: string
        idempotencyKey: string
      }
    }
    expect(run).toMatchObject({
      spec: {
        triggerId,
        scheduledFor: null,
        metadata: {
          labels: { 'agent-kanban.dev/session-key': 'github:owner/repo:issue:123' },
          annotations: { 'agent-kanban.dev/source-event': 'issues.opened' },
        },
      },
      status: { phase: 'dispatched', heartbeatAt: null, idempotencyKey: `http:${triggerId}:ticket-123` },
    })
    expect(run.status.sessionId).toEqual(expect.any(String))
    expect(run.status.triggeredAt).toEqual(expect.any(String))

    const duplicateRunRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs?source=portal`, authorization, {
      method: 'POST',
      headers: { 'x-source': 'zendesk', 'idempotency-key': 'ticket-123' },
      body: JSON.stringify({ ticket: { id: 'T-123' } }),
    })
    expect(duplicateRunRes.status).toBe(409)

    const invalidRunRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs?source=portal`, authorization, {
      method: 'POST',
      headers: { 'x-source': 'zendesk' },
      body: JSON.stringify({ ticket: {} }),
    })
    expect(invalidRunRes.status).toBe(400)
    await expect(invalidRunRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error' },
    })
  })

  it('reuses the existing HTTP trigger session when request body carries the same key [spec: triggers/http-dispatch]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Issue webhook',
      source: { type: 'http' },
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          runtime: 'ama',
          promptTemplate: 'Handle {{ body.event }} {{ body.key }}: {{ body.comment.body }}.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
      nextDueAt: undefined,
    })
    const triggerId = trigger.metadata.uid

    const firstRunRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'delivery-1' },
      body: JSON.stringify({
        key: 'github:owner/repo:issue:123',
        event: 'issues',
        comment: { body: 'Initial issue opened' },
      }),
    })
    expect(firstRunRes.status).toBe(201)
    const firstRun = (await firstRunRes.json()) as { status: { sessionId: string | null } }

    const secondRunRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'delivery-2' },
      body: JSON.stringify({
        key: 'github:owner/repo:issue:123',
        event: 'issue_comment',
        comment: { body: 'Follow-up from the issue thread' },
      }),
    })
    expect(secondRunRes.status).toBe(201)
    const secondRun = (await secondRunRes.json()) as { status: { sessionId: string | null } }

    expect(firstRun.status.sessionId).toEqual(expect.any(String))
    expect(secondRun.status.sessionId).toBe(firstRun.status.sessionId)
    const sessionRes = await jsonFetch(`/api/v1/sessions/${firstRun.status.sessionId}`, authorization)
    expect(sessionRes.status).toBe(200)
    await expect(sessionRes.json()).resolves.toMatchObject({
      metadata: {
        annotations: {
          [AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]: 'c54d83738741c7e14509b968123cae0c54ca45e644a54f7f3f863de4ca70e655',
        },
      },
    })
  })

  it('does not dispatch paused or archived triggers [spec: triggers/inactive]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const dueAt = '2026-05-26T12:00:00.000Z'

    const paused = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Paused heartbeat',
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          runtime: 'ama',
          promptTemplate: 'Do not run.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
      nextDueAt: dueAt,
      suspend: true,
    })

    const archived = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Archived heartbeat',
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          runtime: 'ama',
          promptTemplate: 'Do not run either.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
      nextDueAt: dueAt,
    })
    const archivedId = archived.metadata.uid
    const archiveRes = await jsonFetch(`/api/v1/triggers/${archivedId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)

    const dispatchRes = await jsonFetch('/api/v1/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt: '2026-05-26T12:01:00.000Z' }),
    })
    expect(dispatchRes.status).toBe(200)
    await expect(dispatchRes.json()).resolves.toMatchObject({ claimed: 0, dispatched: 0 })

    const pausedRunsRes = await jsonFetch(`/api/v1/triggers/${paused.metadata.uid}/runs`, authorization)
    await expect(pausedRunsRes.json()).resolves.toMatchObject({ data: [] })
    const archivedRunsRes = await jsonFetch(`/api/v1/triggers/${archivedId}/runs`, authorization)
    await expect(archivedRunsRes.json()).resolves.toMatchObject({ data: [] })
  })

  it('creates an unpinned trigger and resolves a runner-capable environment at dispatch [spec: triggers/dispatch]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    await registerActiveRunner(authorization, environment.id)
    const dueAt = '2026-05-26T12:00:00.000Z'

    const createRes = await jsonFetch('/api/v1/triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        metadata: { name: 'Unpinned heartbeat' },
        spec: {
          source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600 } },
          nextDueAt: dueAt,
          template: {
            metadata: { labels: {}, annotations: {} },
            spec: {
              agentId: agent.id,
              environmentId: null,
              runtime: 'ama',
              promptTemplate: 'Run scheduled work.',
              env: {},
              envFrom: [],
              volumes: [],
              volumeMounts: [],
            },
          },
        },
      }),
    })
    expect(createRes.status).toBe(201)
    const trigger = (await createRes.json()) as {
      metadata: { uid: string }
      spec: { template: { spec: { environmentId: string | null } } }
    }
    expect(trigger.spec.template.spec.environmentId).toBeNull()

    const dispatchRes = await jsonFetch('/api/v1/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt: '2026-05-26T12:01:00.000Z' }),
    })
    expect(dispatchRes.status).toBe(200)
    const dispatch = (await dispatchRes.json()) as {
      dispatched: number
      runs: Array<{ sessionId: string }>
    }
    expect(dispatch).toMatchObject({ claimed: 1, dispatched: 1 })

    // The dispatched session must land in the environment the runner serves.
    const sessionId = dispatch.runs[0]?.sessionId
    const sessionRes = await jsonFetch(`/api/v1/sessions/${sessionId}`, authorization)
    expect(sessionRes.status).toBe(200)
    await expect(sessionRes.json()).resolves.toMatchObject({ spec: { environmentId: environment.id } })
  })

  it('fails an unpinned trigger run when no runner environment is available [spec: triggers/dispatch]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    // An environment exists but has no active runner, so it is not a candidate.
    await createEnvironment(authorization)
    const dueAt = '2026-05-26T12:00:00.000Z'

    const createRes = await jsonFetch('/api/v1/triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        metadata: { name: 'Unrunnable heartbeat' },
        spec: {
          source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600 } },
          nextDueAt: dueAt,
          template: {
            metadata: { labels: {}, annotations: {} },
            spec: {
              agentId: agent.id,
              environmentId: null,
              runtime: 'ama',
              promptTemplate: 'Run scheduled work.',
              env: {},
              envFrom: [],
              volumes: [],
              volumeMounts: [],
            },
          },
        },
      }),
    })
    expect(createRes.status).toBe(201)
    const trigger = (await createRes.json()) as { metadata: { uid: string } }
    const triggerId = trigger.metadata.uid

    const dispatchRes = await jsonFetch('/api/v1/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt: '2026-05-26T12:01:00.000Z' }),
    })
    expect(dispatchRes.status).toBe(200)
    const dispatch = (await dispatchRes.json()) as {
      dispatched: number
      failed: number
      runs: Array<{ status: string; errorMessage: string | null }>
    }
    expect(dispatch).toMatchObject({ claimed: 1, dispatched: 0, failed: 1 })
    // createSession (not the dispatcher) now owns resolution, so the run fails
    // with its "no runner environment" message.
    expect(dispatch.runs[0]?.errorMessage).toContain('No environment has an active runner')

    const runsRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization)
    await expect(runsRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ status: expect.objectContaining({ phase: 'failed' }) })],
    })
  })

  it('permanently deletes a trigger and its runs and audits it [spec: triggers/delete]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Disposable heartbeat',
      nextDueAt: '2026-05-26T12:00:00.000Z',
    })
    const triggerId = trigger.metadata.uid

    const dispatchRes = await jsonFetch('/api/v1/e2e/scheduled-agent-triggers/dispatch', authorization, {
      method: 'POST',
      body: JSON.stringify({ heartbeatAt: '2026-05-26T12:01:00.000Z' }),
    })
    expect(dispatchRes.status).toBe(200)
    await expect(dispatchRes.json()).resolves.toMatchObject({ claimed: 1, dispatched: 1 })

    const runsBeforeRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization)
    const runsBefore = (await runsBeforeRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(runsBefore.data).toHaveLength(1)

    const deleteRes = await jsonFetch(`/api/v1/triggers/${triggerId}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)
    expect(await deleteRes.text()).toBe('')

    const readAfterRes = await jsonFetch(`/api/v1/triggers/${triggerId}`, authorization)
    expect(readAfterRes.status).toBe(404)

    const runsAfterRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization)
    expect(runsAfterRes.status).toBe(404)

    const archivedListRes = await jsonFetch('/api/v1/triggers?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(archivedList.data).not.toContainEqual(expect.objectContaining({ metadata: { uid: triggerId } }))

    const auditRes = await jsonFetch('/api/v1/audit-records?action=trigger', authorization)
    const audit = (await auditRes.json()) as { data: Array<{ action: string; resourceId: string }> }
    expect(audit.data).toContainEqual(expect.objectContaining({ action: 'trigger.delete', resourceId: triggerId }))

    const missingDeleteRes = await jsonFetch('/api/v1/triggers/trigger_missing', authorization, { method: 'DELETE' })
    expect(missingDeleteRes.status).toBe(404)
  })

  it('does not delete a trigger owned by another project', async () => {
    const owner = await signIn()
    const agent = await createAgent(owner)
    const environment = await createEnvironment(owner)
    const trigger = await createTrigger(owner, agent.id, environment.id, { name: 'Tenant-scoped heartbeat' })
    const triggerId = trigger.metadata.uid

    const intruder = await signInUser('trigger-delete-foreign')
    const foreignDeleteRes = await jsonFetch(`/api/v1/triggers/${triggerId}`, intruder, { method: 'DELETE' })
    expect(foreignDeleteRes.status).toBe(404)

    const stillThereRes = await jsonFetch(`/api/v1/triggers/${triggerId}`, owner)
    expect(stillThereRes.status).toBe(200)
  })
})
