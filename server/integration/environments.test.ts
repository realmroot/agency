import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { createRunnerRepo } from '@server/adapters/repos/runners'
import { RunnerConflictError } from '@server/usecases/ports'
import { drizzle } from 'drizzle-orm/d1'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asRunnerAuthorization, defaultClaims, dpopHeaders, setupOidcProvider, signIn } from './auth'

const EMPTY_PACKAGES = { type: 'packages', apt: [], cargo: [], gem: [], go: [], npm: [], pip: [], webi: [] } as const

function createEnvironmentBody(metadata: { name: string; description?: string }, spec: Record<string, unknown> = {}) {
  return {
    metadata,
    spec,
  }
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

async function createSelfHostedEnvironment(authorization: string, name: string) {
  const response = await jsonFetch('/api/v1/environments', authorization, {
    method: 'POST',
    body: JSON.stringify(createEnvironmentBody({ name }, { type: 'self_hosted' })),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { metadata: { uid: string } }
}

async function registerRunner(
  authorization: string,
  input: { name: string; environmentId?: string; machineId?: string },
) {
  const response = await jsonFetch('/api/v1/runners', asRunnerAuthorization(authorization), {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
      ...(input.machineId ? { metadata: { machineId: input.machineId } } : {}),
    }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { id: string }
}

describe('[CF] /api/v1/environments [spec: environments/api-crud]', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the stable error envelope for validation failures', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/environments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'validation_error',
        message: 'Invalid request',
      },
    })
  })

  it('requires authentication before creating environments', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/environments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createEnvironmentBody({ name: 'Node workspace' })),
    })

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
      },
    })
  })

  it('[spec: environments/create-idempotency] replays Environment creation and rejects changed data', async () => {
    const authorization = await signIn()
    expect((await jsonFetch('/api/v1/environments', authorization)).status).toBe(200)
    const body = createEnvironmentBody({ name: 'Idempotent Machine' }, { type: 'self_hosted' })
    const create = () =>
      jsonFetch('/api/v1/environments', authorization, {
        method: 'POST',
        headers: { 'idempotency-key': 'environment-create-idempotency-1' },
        body: JSON.stringify(body),
      })
    const [first, replay] = await Promise.all([create(), create()])
    expect(first.status).toBe(201)
    const firstEnvironment = (await first.json()) as {
      metadata: {
        uid: string
        name: string
        description: string | null
        createdAt: string
        updatedAt: string
      }
      status: { version: number }
    }
    expect(firstEnvironment.status.version).toBe(1)
    expect(replay.status).toBe(201)
    await expect(replay.json()).resolves.toMatchObject({
      metadata: { uid: firstEnvironment.metadata.uid },
      status: { version: 1 },
    })

    const update = await jsonFetch(`/api/v1/environments/${firstEnvironment.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        metadata: { name: 'Renamed Environment', description: 'Updated description.' },
        spec: { variables: { MODE: { description: 'Updated after creation.' } } },
      }),
    })
    expect(update.status).toBe(200)
    await expect(update.json()).resolves.toMatchObject({
      metadata: { name: 'Renamed Environment', description: 'Updated description.' },
      spec: { variables: { MODE: { description: 'Updated after creation.' } } },
      status: { version: 2 },
    })

    const deleted = await jsonFetch(`/api/v1/environments/${firstEnvironment.metadata.uid}`, authorization, {
      method: 'DELETE',
    })
    expect(deleted.status).toBe(204)

    const postUpdateReplay = await create()
    expect(postUpdateReplay.status).toBe(409)
    await expect(postUpdateReplay.json()).resolves.toMatchObject({ error: { type: 'idempotency_conflict' } })

    const conflict = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'environment-create-idempotency-1' },
      body: JSON.stringify(createEnvironmentBody({ name: 'Changed Machine' }, { type: 'self_hosted' })),
    })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ error: { type: 'idempotency_conflict' } })
  })

  it('rejects removed legacy fields (credentials, status)', async () => {
    const authorization = await signIn()
    for (const body of [
      { name: 'Legacy credentials', credentials: [{ name: 'NPM_TOKEN', ref: 'vaultver_abc' }] },
      { name: 'Legacy status', status: 'active' },
    ]) {
      const res = await jsonFetch('/api/v1/environments', authorization, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({
        error: { type: 'validation_error', message: 'Invalid request' },
      })
    }
  })

  it('creates, reads, updates, versions, and deletes environments', async () => {
    const authorization = await signIn()

    const createRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify(
        createEnvironmentBody(
          {
            name: 'Node workspace',
            description: 'Default Node.js environment.',
          },
          {
            packages: { ...EMPTY_PACKAGES, npm: ['tsx@latest'] },
            variables: { NODE_ENV: { description: 'Runtime mode' } },
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
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      metadata: { uid: string; name: string }
      spec: { type: string; networking: Record<string, unknown> }
      status: { currentVersionId: string; version: number; phase: string }
      credentials?: unknown
    }
    const createdId = created.metadata.uid
    expect(created.status.version).toBe(1)
    expect(created.status.phase).toBe('active')
    expect(created.credentials).toBeUndefined()

    const readRes = await jsonFetch(`/api/v1/environments/${createdId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      metadata: { uid: createdId, name: 'Node workspace' },
      spec: {
        type: 'cloud',
        networking: {
          type: 'limited',
          allowMcpServers: false,
          allowPackageManagers: true,
          allowedHosts: ['registry.npmjs.org'],
        },
      },
      status: { version: 1 },
    })

    const updateRes = await jsonFetch(`/api/v1/environments/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        spec: { packages: { ...EMPTY_PACKAGES, npm: ['vite'] } },
      }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as { status: { version: number; currentVersionId: string } }
    expect(updated.status.version).toBe(2)
    expect(updated.status.currentVersionId).not.toBe(created.status.currentVersionId)

    // Renames do not touch runtime configuration, so the version is kept.
    const renameRes = await jsonFetch(`/api/v1/environments/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { name: 'Renamed workspace' } }),
    })
    expect(renameRes.status).toBe(200)
    await expect(renameRes.json()).resolves.toMatchObject({
      metadata: { name: 'Renamed workspace' },
      status: { version: 2 },
    })

    const versionsRes = await jsonFetch(`/api/v1/environments/${createdId}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as {
      data: Array<{ spec: { packages: { npm: string[] } }; status: { version: number } }>
      pagination: Record<string, unknown>
    }
    expect(versions.data.map((version) => version.status.version)).toEqual([2, 1])
    expect(versions.data.find((version) => version.status.version === 1)?.spec.packages.npm).toEqual(['tsx@latest'])
    expect(versions.pagination).not.toHaveProperty('firstId')
    expect(versions.pagination).not.toHaveProperty('lastId')

    const versionItemRes = await jsonFetch(`/api/v1/environments/${createdId}/versions/1`, authorization)
    expect(versionItemRes.status).toBe(200)
    await expect(versionItemRes.json()).resolves.toMatchObject({
      status: { environmentId: createdId, version: 1 },
      spec: { packages: { npm: ['tsx@latest'] } },
    })

    const missingVersionRes = await jsonFetch(`/api/v1/environments/${createdId}/versions/99`, authorization)
    expect(missingVersionRes.status).toBe(404)

    const invalidVersionRes = await jsonFetch(`/api/v1/environments/${createdId}/versions/not-a-number`, authorization)
    expect(invalidVersionRes.status).toBe(400)

    const deleteRes = await jsonFetch(`/api/v1/environments/${createdId}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)

    const listRes = await jsonFetch('/api/v1/environments', authorization)
    const list = (await listRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(list.data).not.toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ uid: createdId }) }),
    )

    expect((await jsonFetch(`/api/v1/environments/${createdId}`, authorization)).status).toBe(404)
    const deletedUpdateRes = await jsonFetch(`/api/v1/environments/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        spec: { packages: { ...EMPTY_PACKAGES, npm: ['esbuild'] } },
      }),
    })
    expect(deletedUpdateRes.status).toBe(404)
  })

  it('soft-deletes an Environment and all associated idle Runners atomically [spec: environments/delete-runners]', async () => {
    const authorization = await signIn()
    const target = await createSelfHostedEnvironment(authorization, 'Runner-owned environment')
    const unrelatedEnvironment = await createSelfHostedEnvironment(authorization, 'Unrelated environment')
    const associated = await Promise.all([
      registerRunner(authorization, { name: 'Associated runner one', environmentId: target.metadata.uid }),
      registerRunner(authorization, { name: 'Associated runner two', environmentId: target.metadata.uid }),
    ])
    const unrelated = await registerRunner(authorization, {
      name: 'Unrelated runner',
      environmentId: unrelatedEnvironment.metadata.uid,
    })

    const response = await jsonFetch(`/api/v1/environments/${target.metadata.uid}`, authorization, {
      method: 'DELETE',
    })
    expect(response.status).toBe(204)

    const environmentRow = await env.DB.prepare('SELECT deleted_at FROM environments WHERE id = ?')
      .bind(target.metadata.uid)
      .first<{ deleted_at: string | null }>()
    const runnerRows = await env.DB.prepare('SELECT id, deleted_at FROM runners WHERE id IN (?, ?, ?) ORDER BY id')
      .bind(associated[0]!.id, associated[1]!.id, unrelated.id)
      .all<{ id: string; deleted_at: string | null }>()
    const associatedRows = runnerRows.results.filter((row) => row.id !== unrelated.id)
    expect(environmentRow?.deleted_at).toEqual(expect.any(String))
    expect(associatedRows).toHaveLength(2)
    expect(associatedRows.every((row) => row.deleted_at === environmentRow?.deleted_at)).toBe(true)
    expect(runnerRows.results.find((row) => row.id === unrelated.id)?.deleted_at).toBeNull()
    for (const runner of associated) {
      expect((await jsonFetch(`/api/v1/runners/${runner.id}`, authorization)).status).toBe(404)
    }
    expect((await jsonFetch(`/api/v1/runners/${unrelated.id}`, authorization)).status).toBe(200)
  })

  it('rejects Environment deletion atomically when an associated Runner has load [spec: environments/delete-runners]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization, 'Loaded environment')
    const runners = await Promise.all([
      registerRunner(authorization, { name: 'Loaded runner', environmentId: environment.metadata.uid }),
      registerRunner(authorization, { name: 'Idle sibling', environmentId: environment.metadata.uid }),
    ])
    await env.DB.prepare('UPDATE runners SET current_load = 1 WHERE id = ?').bind(runners[0]!.id).run()

    const response = await jsonFetch(`/api/v1/environments/${environment.metadata.uid}`, authorization, {
      method: 'DELETE',
    })
    expect(response.status).toBe(409)
    await expect(
      env.DB.prepare(
        'SELECT (SELECT deleted_at FROM environments WHERE id = ?) AS environment_deleted_at, count(*) AS live_runners FROM runners WHERE id IN (?, ?) AND deleted_at IS NULL',
      )
        .bind(environment.metadata.uid, runners[0]!.id, runners[1]!.id)
        .first(),
    ).resolves.toEqual({ environment_deleted_at: null, live_runners: 2 })
  })

  it('rejects Environment deletion atomically when an associated Runner has an active lease [spec: environments/delete-runners]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization, 'Leased environment')
    const runner = await registerRunner(authorization, {
      name: 'Leased runner',
      environmentId: environment.metadata.uid,
    })
    const row = await env.DB.prepare('SELECT organization_id, project_id FROM runners WHERE id = ?')
      .bind(runner.id)
      .first<{ organization_id: string; project_id: string }>()
    const timestamp = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO work_items
        (id, organization_id, project_id, environment_id, runner_id, lease_id, type, state, payload, available_at, created_at, updated_at)
        VALUES ('work_environment_delete', ?, ?, ?, ?, 'lease_environment_delete', 'session.run', 'leased', '{}', ?, ?, ?)`).bind(
        row!.organization_id,
        row!.project_id,
        environment.metadata.uid,
        runner.id,
        timestamp,
        timestamp,
        timestamp,
      ),
      env.DB.prepare(`INSERT INTO leases
        (id, work_item_id, runner_id, organization_id, project_id, state, expires_at, created_at, updated_at)
        VALUES ('lease_environment_delete', 'work_environment_delete', ?, ?, ?, 'active', ?, ?, ?)`).bind(
        runner.id,
        row!.organization_id,
        row!.project_id,
        '2099-01-01T00:00:00.000Z',
        timestamp,
        timestamp,
      ),
    ])

    const response = await jsonFetch(`/api/v1/environments/${environment.metadata.uid}`, authorization, {
      method: 'DELETE',
    })
    expect(response.status).toBe(409)
    await expect(
      env.DB.prepare(
        'SELECT (SELECT deleted_at FROM environments WHERE id = ?) AS environment_deleted_at, deleted_at AS runner_deleted_at FROM runners WHERE id = ?',
      )
        .bind(environment.metadata.uid, runner.id)
        .first(),
    ).resolves.toEqual({ environment_deleted_at: null, runner_deleted_at: null })
  })

  it('rejects Runner registration races after Environment deletion without a 500 [spec: environments/delete-runners]', async () => {
    const authorization = await signIn()
    const environment = await createSelfHostedEnvironment(authorization, 'Deleted registration environment')
    const registered = await registerRunner(authorization, {
      name: 'Machine runner',
      environmentId: environment.metadata.uid,
      machineId: 'machine-environment-delete',
    })
    const row = await env.DB.prepare('SELECT organization_id, project_id, oidc_subject FROM runners WHERE id = ?')
      .bind(registered.id)
      .first<{ organization_id: string; project_id: string; oidc_subject: string }>()
    await env.DB.prepare('UPDATE environments SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .bind('2026-09-03T00:00:00.000Z', '2026-09-03T00:00:00.000Z', environment.metadata.uid)
      .run()

    const httpResponse = await jsonFetch('/api/v1/runners', asRunnerAuthorization(authorization), {
      method: 'POST',
      body: JSON.stringify({
        name: 'Race registration',
        environmentId: environment.metadata.uid,
        metadata: { machineId: 'new-machine-environment-delete' },
      }),
    })
    expect(httpResponse.status).toBe(409)

    const repo = createRunnerRepo(drizzle(env.DB))
    const input = {
      organizationId: row!.organization_id,
      projectId: row!.project_id,
      name: 'Race registration',
      environmentId: environment.metadata.uid,
      secretRef: null,
      authMode: 'realmroot' as const,
      oidcSubject: row!.oidc_subject,
      oidcClientId: null,
      maxConcurrent: 1,
      metadata: { machineId: 'new-machine-environment-delete' },
    }
    await expect(repo.insert(input, new Date().toISOString())).rejects.toBeInstanceOf(RunnerConflictError)
    await expect(
      repo.reregister(
        row!.project_id,
        registered.id,
        { ...input, metadata: { machineId: 'machine-environment-delete' } },
        new Date().toISOString(),
      ),
    ).rejects.toBeInstanceOf(RunnerConflictError)
  })

  it('lists environments with pagination, search, and date filters [spec: environments/api-pagination]', async () => {
    const authorization = await signIn()
    const alphaRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify(createEnvironmentBody({ name: 'Alpha workspace' })),
    })
    const alpha = (await alphaRes.json()) as { metadata: { uid: string; createdAt: string } }
    const alphaId = alpha.metadata.uid
    const betaRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify(createEnvironmentBody({ name: 'Beta workspace' })),
    })
    const beta = (await betaRes.json()) as { metadata: { uid: string; createdAt: string } }
    const betaId = beta.metadata.uid
    await jsonFetch(`/api/v1/environments/${alphaId}`, authorization, { method: 'DELETE' })

    const defaultListRes = await jsonFetch('/api/v1/environments?limit=1', authorization)
    expect(defaultListRes.status).toBe(200)
    const defaultList = (await defaultListRes.json()) as {
      data: Array<{ metadata: { uid: string } }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(defaultList.data).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ uid: betaId }) })])
    expect(defaultList.pagination).toMatchObject({ limit: 1, hasMore: false, nextCursor: null })

    const searchRes = await jsonFetch('/api/v1/environments?search=Alpha', authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(searchList.data).toEqual([])

    const dateRes = await jsonFetch(
      `/api/v1/environments?createdFrom=${encodeURIComponent(alpha.metadata.createdAt)}&createdTo=${encodeURIComponent(beta.metadata.createdAt)}`,
      authorization,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(dateList.data.map((environment) => environment.metadata.uid)).toEqual([betaId])

    await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify(createEnvironmentBody({ name: 'Gamma workspace' })),
    })
    const firstPageRes = await jsonFetch('/api/v1/environments?limit=1', authorization)
    const firstPage = (await firstPageRes.json()) as {
      data: Array<{ metadata: { uid: string } }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(firstPage.data).toHaveLength(1)
    expect(firstPage.pagination.hasMore).toBe(true)

    const nextPageRes = await jsonFetch(
      `/api/v1/environments?limit=1&cursor=${firstPage.pagination.nextCursor}`,
      authorization,
    )
    const nextPage = (await nextPageRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(nextPage.data).toHaveLength(1)
    expect(nextPage.data.map((environment) => environment.metadata.uid)).not.toEqual(
      firstPage.data.map((environment) => environment.metadata.uid),
    )

    const invalidCursorRes = await jsonFetch('/api/v1/environments?cursor=not-a-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)
    await expect(invalidCursorRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { cursor: expect.any(String) } } },
    })
  })

  it('validates networking and secret-free variables [spec: environments/api-validation]', async () => {
    const authorization = await signIn()

    const invalidNetworkRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify(
        createEnvironmentBody(
          { name: 'Invalid network workspace' },
          { networking: { type: 'limited', allowMcpServers: false, allowPackageManagers: true } },
        ),
      ),
    })
    expect(invalidNetworkRes.status).toBe(400)

    const oldMcpPolicyRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        ...createEnvironmentBody({ name: 'Old MCP policy workspace' }),
        mcpPolicy: { allowedConnectors: ['missing-connector'] },
      }),
    })
    expect(oldMcpPolicyRes.status).toBe(400)
    await expect(oldMcpPolicyRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', message: 'Invalid request' },
    })

    const secretVariableRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify(
        createEnvironmentBody(
          { name: 'Secret variable workspace' },
          { variables: { apiKey: { description: 'raw-secret' } } },
        ),
      ),
    })
    expect(secretVariableRes.status).toBe(400)
    await expect(secretVariableRes.json()).resolves.toMatchObject({
      error: { details: { fields: { variables: expect.any(String) } } },
    })

    const oldRuntimeConfigRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify({
        ...createEnvironmentBody({ name: 'Old runtime config workspace' }),
        runtimeConfig: { npmToken: 'raw-secret' },
      }),
    })
    expect(oldRuntimeConfigRes.status).toBe(400)
    await expect(oldRuntimeConfigRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', message: 'Invalid request' },
    })
  })

  it('keeps cross-project environments invisible', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/environments', authorization, {
      method: 'POST',
      body: JSON.stringify(createEnvironmentBody({ name: 'Tenant workspace' })),
    })
    expect(createRes.status).toBe(201)
    const environment = (await createRes.json()) as { metadata: { uid: string } }
    const environmentId = environment.metadata.uid

    const otherAuthorization = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      organizationId: 'org_flare_456',
    })
    const crossReadRes = await jsonFetch(`/api/v1/environments/${environmentId}`, otherAuthorization)
    expect(crossReadRes.status).toBe(404)

    const crossUpdateRes = await jsonFetch(`/api/v1/environments/${environmentId}`, otherAuthorization, {
      method: 'DELETE',
    })
    expect(crossUpdateRes.status).toBe(404)
  })
})
