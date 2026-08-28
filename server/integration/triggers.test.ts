import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { createTriggerDispatchRepo } from '@server/adapters/repos/trigger-dispatch'
import { createDeps } from '@server/composition'
import { createDb } from '@server/db/client'
import type { Env } from '@server/env'
import { AMA_ANNOTATION_KEY_ROUTING_KEY_HASH } from '@server/metadata-keys'
import { dispatchNextSerialHttpTrigger, recoverSerialHttpTriggers } from '@server/usecases/dispatch-triggers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asRunnerAuthorization, dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn, signInUser } from './auth'
import { createReadyAgent } from './v2-resources'

const AMA_RUNNER_CAPABILITY = 'ama'
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

async function createEnvironment(authorization: string, type: 'cloud' | 'self_hosted' = 'cloud') {
  const res = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify(
      createResourceBody(
        {
          name: `Trigger workspace ${crypto.randomUUID()}`,
        },
        {
          type,
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
  const agent = await createReadyAgent(authorization, {
    name: `Trigger agent ${crypto.randomUUID()}`,
    systemPrompt: 'Run scheduled work.',
  })
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
      name: 'AK agent routing key',
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
  const runnerAuthorization = asRunnerAuthorization(authorization)
  const runnerRes = await jsonFetch('/api/v1/runners', runnerAuthorization, {
    method: 'POST',
    body: JSON.stringify({
      name: `Trigger runner ${crypto.randomUUID()}`,
      environmentId,
      maxConcurrent: 2,
    }),
  })
  expect(runnerRes.status).toBe(201)
  const runner = (await runnerRes.json()) as { id: string }
  const heartbeatRes = await jsonFetch(`/api/v1/runners/${runner.id}/heartbeat`, runnerAuthorization, {
    method: 'PUT',
    body: JSON.stringify({
      state: 'active',
      runtimes: [{ runtime: AMA_RUNNER_CAPABILITY, models: [], state: 'ready' }],
    }),
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
      source:
        | { type: 'schedule'; schedule: { intervalSeconds: number; windowSeconds: number } }
        | { type: 'http'; concurrency?: { mode: 'parallel' | 'serial' } }
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

  it('rejects a caller-supplied Trigger runtime', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const response = await jsonFetch('/api/v1/triggers', authorization, {
      method: 'POST',
      body: JSON.stringify({
        metadata: { name: 'Caller-owned runtime' },
        spec: {
          source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 3600 } },
          template: {
            metadata: { labels: {}, annotations: {} },
            spec: {
              agentId: agent.id,
              runtime: 'codex',
              promptTemplate: 'The Agent owns runtime selection.',
              env: {},
              envFrom: [],
              volumes: [],
              volumeMounts: [],
            },
          },
        },
      }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { type: 'validation_error' } })
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

  it('persists HTTP trigger concurrency through create, update, and read', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Serial issue webhook',
      source: { type: 'http', concurrency: { mode: 'serial' } },
      nextDueAt: undefined,
    })
    const triggerId = trigger.metadata.uid

    expect(trigger.spec.source).toEqual({ type: 'http', concurrency: { mode: 'serial' } })

    const parallelRes = await jsonFetch(`/api/v1/triggers/${triggerId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { source: { type: 'http', concurrency: { mode: 'parallel' } } } }),
    })
    expect(parallelRes.status).toBe(200)
    await expect(parallelRes.json()).resolves.toMatchObject({
      spec: { source: { type: 'http', concurrency: { mode: 'parallel' } } },
    })

    const serialRes = await jsonFetch(`/api/v1/triggers/${triggerId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { source: { type: 'http', concurrency: { mode: 'serial' } } } }),
    })
    expect(serialRes.status).toBe(200)

    const readRes = await jsonFetch(`/api/v1/triggers/${triggerId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      spec: { source: { type: 'http', concurrency: { mode: 'serial' } } },
    })
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

  it('claims one serial HTTP run at a time and preserves D1 FIFO under concurrent claim attempts', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization)
    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'FIFO webhook',
      source: { type: 'http', concurrency: { mode: 'serial' } },
      nextDueAt: undefined,
    })
    const triggerId = trigger.metadata.uid
    const owner = await env.DB.prepare(
      'select organization_id as organizationId, project_id as projectId, created_by_user_id as userId from triggers where id = ?',
    )
      .bind(triggerId)
      .first<{ organizationId: string; projectId: string; userId: string }>()
    expect(owner).not.toBeNull()
    const timestamp = new Date().toISOString()
    const runIds = [`httprun_${crypto.randomUUID()}`, `httprun_${crypto.randomUUID()}`]

    await env.DB.batch(
      runIds.flatMap((runId, index) => [
        env.DB.prepare(
          `insert into trigger_runs
            (id, organization_id, project_id, trigger_id, scheduled_for, heartbeat_at, triggered_at, state,
             idempotency_key, session_id, correlation_id, error_message, metadata, created_at, updated_at)
           values (?, ?, ?, ?, null, null, ?, 'queued', ?, null, ?, null, '{}', ?, ?)`,
        ).bind(
          runId,
          owner!.organizationId,
          owner!.projectId,
          triggerId,
          timestamp,
          `http:${triggerId}:fifo-${index}`,
          `http:${triggerId}:fifo-${index}`,
          timestamp,
          timestamp,
        ),
        env.DB.prepare(
          `insert into http_trigger_pending_runs
            (run_id, trigger_id, organization_id, organization_name, project_id, project_name,
             requested_by_user_id, routing_key_hash, rendered_prompt, created_at)
           values (?, ?, ?, 'Org', ?, 'Project', ?, ?, ?, ?)`,
        ).bind(
          runId,
          triggerId,
          owner!.organizationId,
          owner!.projectId,
          owner!.userId,
          `routing-hash-${index}`,
          `Prompt ${index}`,
          timestamp,
        ),
      ]),
    )

    const repo = createTriggerDispatchRepo(createDb(env as unknown as Env))
    const contenders = await Promise.all([repo.claimNextHttpRun!(triggerId), repo.claimNextHttpRun!(triggerId)])
    const claimed = contenders.filter((run) => run !== null)
    expect(claimed).toHaveLength(1)
    expect(claimed[0]?.run.id).toBe(runIds[0])
    await expect(repo.claimNextHttpRun!(triggerId)).resolves.toBeNull()

    await env.DB.batch([
      env.DB.prepare("update trigger_runs set state = 'failed' where id = ?").bind(runIds[0]),
      env.DB.prepare('delete from http_trigger_pending_runs where run_id = ?').bind(runIds[0]),
    ])
    await expect(repo.claimNextHttpRun!(triggerId)).resolves.toMatchObject({ run: { id: runIds[1] } })
  })

  it('claims an active routing key ahead of FIFO and permits only one claim while that session becomes idle', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization, 'self_hosted')
    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Active routing-key race webhook',
      source: { type: 'http', concurrency: { mode: 'serial' } },
      nextDueAt: undefined,
    })
    const triggerId = trigger.metadata.uid
    const activeRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'active-routing-key-run' },
      body: JSON.stringify({ routing_key: 'github:owner/repo:issue:active' }),
    })
    expect(activeRes.status).toBe(201)
    const activeRun = (await activeRes.json()) as { status: { sessionId: string | null } }
    expect(activeRun.status.sessionId).toEqual(expect.any(String))
    const activeSession = await env.DB.prepare('select state, metadata from sessions where id = ?')
      .bind(activeRun.status.sessionId)
      .first<{ state: string; metadata: string }>()
    expect(activeSession?.state).toBe('pending')
    const activeRoutingKeyHash = (JSON.parse(activeSession!.metadata) as { annotations: Record<string, string> })
      .annotations[AMA_ANNOTATION_KEY_ROUTING_KEY_HASH]
    expect(activeRoutingKeyHash).toEqual(expect.any(String))

    const owner = await env.DB.prepare(
      'select organization_id as organizationId, project_id as projectId, created_by_user_id as userId from triggers where id = ?',
    )
      .bind(triggerId)
      .first<{ organizationId: string; projectId: string; userId: string }>()
    expect(owner).not.toBeNull()
    const timestamp = new Date().toISOString()
    const fifoRunId = `httprun_${crypto.randomUUID()}`
    const activeKeyRunId = `httprun_${crypto.randomUUID()}`
    await env.DB.batch(
      [
        { runId: fifoRunId, routingKeyHash: 'different-routing-key-hash', prompt: 'FIFO issue' },
        { runId: activeKeyRunId, routingKeyHash: activeRoutingKeyHash!, prompt: 'Active issue follow-up' },
      ].flatMap(({ runId, routingKeyHash, prompt }, index) => [
        env.DB.prepare(
          `insert into trigger_runs
            (id, organization_id, project_id, trigger_id, scheduled_for, heartbeat_at, triggered_at, state,
             idempotency_key, session_id, correlation_id, error_message, metadata, created_at, updated_at)
           values (?, ?, ?, ?, null, null, ?, 'queued', ?, null, ?, null, '{}', ?, ?)`,
        ).bind(
          runId,
          owner!.organizationId,
          owner!.projectId,
          triggerId,
          timestamp,
          `http:${triggerId}:active-race-${index}`,
          `http:${triggerId}:active-race-${index}`,
          timestamp,
          timestamp,
        ),
        env.DB.prepare(
          `insert into http_trigger_pending_runs
            (run_id, trigger_id, organization_id, organization_name, project_id, project_name,
             requested_by_user_id, routing_key_hash, rendered_prompt, created_at)
           values (?, ?, ?, 'Org', ?, 'Project', ?, ?, ?, ?)`,
        ).bind(
          runId,
          triggerId,
          owner!.organizationId,
          owner!.projectId,
          owner!.userId,
          routingKeyHash,
          prompt,
          timestamp,
        ),
      ]),
    )

    const repo = createTriggerDispatchRepo(createDb(env as unknown as Env))
    const overtaking = await repo.claimNextHttpRun!(triggerId)
    expect(overtaking?.run.id).toBe(activeKeyRunId)
    await repo.requeueHttpRun!(activeKeyRunId)

    const contenders = await Promise.all([
      repo.claimNextHttpRun!(triggerId),
      env.DB.prepare("update sessions set state = 'idle' where id = ?")
        .bind(activeRun.status.sessionId)
        .run()
        .then(() => repo.claimNextHttpRun!(triggerId)),
      repo.claimNextHttpRun!(triggerId),
    ])
    const claimed = contenders.filter((run) => run !== null)
    expect(claimed).toHaveLength(1)
    const dispatching = await env.DB.prepare(
      "select count(*) as count from trigger_runs where trigger_id = ? and state = 'dispatching'",
    )
      .bind(triggerId)
      .first<{ count: number }>()
    expect(dispatching?.count).toBe(1)
  })

  it('repairs stale dispatching runs with and without a session without duplicate creation', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization, 'self_hosted')
    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Crash recovery webhook',
      source: { type: 'http', concurrency: { mode: 'serial' } },
      nextDueAt: undefined,
    })
    const triggerId = trigger.metadata.uid
    const createdRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'created-before-crash' },
      body: JSON.stringify({ routing_key: 'github:owner/repo:issue:created-before-crash' }),
    })
    expect(createdRes.status).toBe(201)
    const created = (await createdRes.json()) as {
      metadata: { uid: string }
      status: { sessionId: string | null }
    }
    expect(created.status.sessionId).toEqual(expect.any(String))
    const owner = await env.DB.prepare(
      'select organization_id as organizationId, project_id as projectId, created_by_user_id as userId from triggers where id = ?',
    )
      .bind(triggerId)
      .first<{ organizationId: string; projectId: string; userId: string }>()
    expect(owner).not.toBeNull()
    const staleAt = '2026-07-20T11:00:00.000Z'
    const crashedRunId = `httprun_${crypto.randomUUID()}`
    const sessionsBefore = await env.DB.prepare('select count(*) as count from sessions where project_id = ?')
      .bind(owner!.projectId)
      .first<{ count: number }>()

    await env.DB.batch([
      env.DB.prepare(
        "update trigger_runs set state = 'dispatching', session_id = null, updated_at = ? where id = ?",
      ).bind(staleAt, created.metadata.uid),
      env.DB.prepare("update sessions set state = 'idle' where id = ?").bind(created.status.sessionId),
      env.DB.prepare(
        `insert into http_trigger_pending_runs
          (run_id, trigger_id, organization_id, organization_name, project_id, project_name,
           requested_by_user_id, routing_key_hash, rendered_prompt, created_at)
         values (?, ?, ?, 'Org', ?, 'Project', ?, 'created-routing-hash', 'Created before crash', ?)`,
      ).bind(created.metadata.uid, triggerId, owner!.organizationId, owner!.projectId, owner!.userId, staleAt),
      env.DB.prepare(
        `insert into trigger_runs
          (id, organization_id, project_id, trigger_id, scheduled_for, heartbeat_at, triggered_at, state,
           idempotency_key, session_id, correlation_id, error_message, metadata, created_at, updated_at)
         values (?, ?, ?, ?, null, null, ?, 'dispatching', ?, null, ?, null, '{}', ?, ?)`,
      ).bind(
        crashedRunId,
        owner!.organizationId,
        owner!.projectId,
        triggerId,
        staleAt,
        `http:${triggerId}:crashed-before-create`,
        `http:${triggerId}:crashed-before-create`,
        staleAt,
        staleAt,
      ),
      env.DB.prepare(
        `insert into http_trigger_pending_runs
          (run_id, trigger_id, organization_id, organization_name, project_id, project_name,
           requested_by_user_id, routing_key_hash, rendered_prompt, created_at)
         values (?, ?, ?, 'Org', ?, 'Project', ?, 'crashed-routing-hash', 'Resume after crash', ?)`,
      ).bind(crashedRunId, triggerId, owner!.organizationId, owner!.projectId, owner!.userId, staleAt),
    ])

    const recovered = await recoverSerialHttpTriggers(
      createDeps(env as unknown as Env),
      100,
      new Date('2026-07-20T12:00:00.000Z'),
    )
    expect(recovered).toBeGreaterThanOrEqual(1)

    const repaired = await env.DB.prepare(
      'select id, state, session_id as sessionId from trigger_runs where id in (?, ?)',
    )
      .bind(created.metadata.uid, crashedRunId)
      .all<{ id: string; state: string; sessionId: string | null }>()
    expect(repaired.results).toEqual(
      expect.arrayContaining([
        { id: created.metadata.uid, state: 'dispatched', sessionId: created.status.sessionId },
        expect.objectContaining({ id: crashedRunId, state: 'dispatched', sessionId: expect.any(String) }),
      ]),
    )
    expect(repaired.results.find((run) => run.id === crashedRunId)?.sessionId).not.toBe(created.status.sessionId)
    const sessionsAfter = await env.DB.prepare('select count(*) as count from sessions where project_id = ?')
      .bind(owner!.projectId)
      .first<{ count: number }>()
    expect(sessionsAfter?.count).toBe((sessionsBefore?.count ?? 0) + 1)
    const pending = await env.DB.prepare(
      'select count(*) as count from http_trigger_pending_runs where run_id in (?, ?)',
    )
      .bind(created.metadata.uid, crashedRunId)
      .first<{ count: number }>()
    expect(pending?.count).toBe(0)
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
          promptTemplate: 'Handle ticket {{ .body.ticket.id }} from {{ .body.source }} via {{ .header["x-source"] }}.',
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
        source: 'portal',
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

    const optionalRunRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs?source=portal`, authorization, {
      method: 'POST',
      headers: { 'x-source': 'zendesk' },
      body: JSON.stringify({ ticket: {} }),
    })
    expect(optionalRunRes.status).toBe(201)

    const invalidTrigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Invalid ticket webhook',
      source: { type: 'http' },
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          promptTemplate: '{% if .body.ticket.id %}Ticket',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
      nextDueAt: undefined,
    })
    const invalidRunRes = await jsonFetch(
      `/api/v1/triggers/${invalidTrigger.metadata.uid}/runs?source=portal`,
      authorization,
      {
        method: 'POST',
        headers: { 'x-source': 'zendesk' },
        body: JSON.stringify({ ticket: { id: 'T-124' } }),
      },
    )
    expect(invalidRunRes.status).toBe(400)
    await expect(invalidRunRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error' },
    })
  })

  it('reuses the existing HTTP trigger session when request body carries the same routing key [spec: triggers/http-dispatch]', async () => {
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
          promptTemplate: 'Handle {{ .body.event }} {{ .body.routing_key }}: {{ .body.comment.body }}.',
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
        routing_key: 'github:owner/repo:issue:123',
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
        routing_key: 'github:owner/repo:issue:123',
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

  it('queues a different serial subject, delivers the active subject, then resumes FIFO after idle', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization, 'self_hosted')
    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Serial maintainer webhook',
      source: { type: 'http', concurrency: { mode: 'serial' } },
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          promptTemplate: 'Handle {{ .body.event }} for {{ .body.routing_key }}.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
      nextDueAt: undefined,
    })
    const triggerId = trigger.metadata.uid

    const firstRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'serial-delivery-1' },
      body: JSON.stringify({ routing_key: 'github:owner/repo:issue:1', event: 'issues.opened' }),
    })
    expect(firstRes.status).toBe(201)
    const first = (await firstRes.json()) as { status: { phase: string; sessionId: string | null } }
    expect(first.status).toMatchObject({ phase: 'dispatched', sessionId: expect.any(String) })

    const secondRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'serial-delivery-2' },
      body: JSON.stringify({ routing_key: 'github:owner/repo:issue:2', event: 'issues.opened' }),
    })
    expect(secondRes.status).toBe(201)
    const second = (await secondRes.json()) as {
      metadata: { uid: string }
      status: { phase: string; sessionId: string | null }
    }
    expect(second.status).toEqual(expect.objectContaining({ phase: 'queued', sessionId: null }))

    const sameSubjectRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'serial-delivery-3' },
      body: JSON.stringify({ routing_key: 'github:owner/repo:issue:1', event: 'issue_comment.created' }),
    })
    expect(sameSubjectRes.status).toBe(201)
    await expect(sameSubjectRes.json()).resolves.toMatchObject({
      status: { phase: 'dispatched', sessionId: first.status.sessionId },
    })

    const replayRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'serial-delivery-2' },
      body: JSON.stringify({ routing_key: 'github:owner/repo:issue:2', event: 'issues.opened' }),
    })
    expect(replayRes.status).toBe(201)
    expect(replayRes.headers.get('idempotency-replayed')).toBe('true')
    await expect(replayRes.json()).resolves.toMatchObject({
      metadata: { uid: second.metadata.uid },
      status: { phase: 'queued', sessionId: null },
    })

    await env.DB.prepare("update sessions set state = 'idle' where id = ?").bind(first.status.sessionId).run()
    const owner = await env.DB.prepare('select project_id as projectId from triggers where id = ?')
      .bind(triggerId)
      .first<{ projectId: string }>()
    expect(owner).not.toBeNull()
    await expect(
      dispatchNextSerialHttpTrigger(createDeps(env as unknown as Env), owner!.projectId, triggerId),
    ).resolves.toEqual({ pending: false, blocked: false })

    const resumedRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs/${second.metadata.uid}`, authorization)
    expect(resumedRes.status).toBe(200)
    const resumed = (await resumedRes.json()) as { status: { phase: string; sessionId: string | null } }
    expect(resumed.status).toMatchObject({ phase: 'dispatched', sessionId: expect.any(String) })
    expect(resumed.status.sessionId).not.toBe(first.status.sessionId)
  })

  it('automatically resumes serial FIFO when a self-hosted lease settles idle [spec: triggers/http-serial-dispatch]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    const environment = await createEnvironment(authorization, 'self_hosted')
    const runner = await registerActiveRunner(authorization, environment.id)
    const trigger = await createTrigger(authorization, agent.id, environment.id, {
      name: 'Serial lease completion webhook',
      source: { type: 'http', concurrency: { mode: 'serial' } },
      template: {
        metadata: { labels: {}, annotations: {} },
        spec: {
          agentId: agent.id,
          environmentId: environment.id,
          promptTemplate: 'Handle {{ .body.routing_key }}.',
          env: {},
          envFrom: [],
          volumes: [],
          volumeMounts: [],
        },
      },
      nextDueAt: undefined,
    })
    const triggerId = trigger.metadata.uid

    const firstRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'serial-lease-1' },
      body: JSON.stringify({ routing_key: 'github:owner/repo:issue:1' }),
    })
    expect(firstRes.status).toBe(201)
    const first = (await firstRes.json()) as { status: { sessionId: string | null } }
    expect(first.status.sessionId).toEqual(expect.any(String))

    const secondRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'serial-lease-2' },
      body: JSON.stringify({ routing_key: 'github:owner/repo:issue:2' }),
    })
    expect(secondRes.status).toBe(201)
    const second = (await secondRes.json()) as {
      metadata: { uid: string }
      status: { phase: string; sessionId: string | null }
    }
    expect(second.status).toMatchObject({ phase: 'queued', sessionId: null })

    const workItemsRes = await jsonFetch(
      `/api/v1/work-items?state=available&sessionId=${first.status.sessionId}`,
      authorization,
    )
    expect(workItemsRes.status).toBe(200)
    const workItems = (await workItemsRes.json()) as { data: Array<{ id: string }> }
    expect(workItems.data).toHaveLength(1)

    const runnerAuthorization = asRunnerAuthorization(authorization)
    const leaseRes = await jsonFetch('/api/v1/leases', runnerAuthorization, {
      method: 'POST',
      body: JSON.stringify({ workItemId: workItems.data[0]!.id, runnerId: runner.id, leaseDurationSeconds: 90 }),
    })
    expect(leaseRes.status).toBe(201)
    const lease = (await leaseRes.json()) as { id: string }

    const completeRes = await jsonFetch(`/api/v1/leases/${lease.id}`, runnerAuthorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'completed', result: { ok: true } }),
    })
    expect(completeRes.status).toBe(200)

    const resumedRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs/${second.metadata.uid}`, authorization)
    expect(resumedRes.status).toBe(200)
    const resumed = (await resumedRes.json()) as { status: { phase: string; sessionId: string | null } }
    expect(resumed.status).toMatchObject({ phase: 'dispatched', sessionId: expect.any(String) })
    expect(resumed.status.sessionId).not.toBe(first.status.sessionId)
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

  it('uses a cloud environment for an unpinned ama trigger when no runner is active [spec: triggers/dispatch]', async () => {
    const authorization = await signIn()
    const agent = await createAgent(authorization)
    // Cloud AMA execution does not require a self-hosted runner.
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
    expect(dispatch).toMatchObject({ claimed: 1, dispatched: 1, failed: 0 })
    expect(dispatch.runs[0]?.errorMessage).toBeNull()

    const runsRes = await jsonFetch(`/api/v1/triggers/${triggerId}/runs`, authorization)
    await expect(runsRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ status: expect.objectContaining({ phase: 'dispatched' }) })],
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
