import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { defaultClaims, dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn } from './auth'

async function jsonFetch(path: string, authorization: string, init: RequestInit = {}) {
  const isCreate = path === '/api/v1/agents' && init.method === 'POST' && typeof init.body === 'string'
  const body = isCreate ? (JSON.parse(init.body as string) as Record<string, unknown>) : null
  const requestInit = isCreate
    ? {
        ...init,
        body: JSON.stringify({
          username: `test-agent-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`,
          ...body,
          ...(body?.spec && typeof body.spec === 'object'
            ? { spec: { runtime: 'ama', ...(body.spec as Record<string, unknown>) } }
            : {}),
        }),
      }
    : init
  return await SELF.fetch(`https://example.com${path}`, {
    ...requestInit,
    headers: {
      'content-type': 'application/json',
      ...dpopHeaders(authorization, requestInit.method ?? 'GET', path),
      ...(isCreate ? { 'Idempotency-Key': `agent-${crypto.randomUUID()}` } : {}),
      ...requestInit.headers,
    },
  })
}

function agentBody(name: string, spec: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) {
  return {
    metadata: { name, ...metadata },
    spec: {
      systemPrompt: `${name} system prompt.`,
      ...spec,
    },
  }
}

async function seedLegacyAgent(authorization: string) {
  const bindings = env as unknown as Env
  const create = await jsonFetch('/api/v1/agents', authorization, {
    method: 'POST',
    body: JSON.stringify(agentBody('Legacy Agent', { runtime: 'codex', systemPrompt: 'Legacy prompt' })),
  })
  if (create.status !== 201) throw new Error(`Expected Agent creation, got ${create.status}: ${await create.text()}`)
  const agentId = ((await create.json()) as { metadata: { uid: string } }).metadata.uid
  await bindings.DB.prepare(
    `UPDATE agents SET
      username = NULL, identity_issuer = NULL, identity_subject = NULL, identity_credential_ref = NULL, realmroot = NULL
     WHERE id = ?`,
  )
    .bind(agentId)
    .run()
  return agentId
}

async function agentProject(agentId: string) {
  const row = await env.DB.prepare(
    `SELECT agents.project_id, projects.organization_id
     FROM agents
     JOIN projects ON projects.id = agents.project_id
     WHERE agents.id = ?`,
  )
    .bind(agentId)
    .first<{ project_id: string; organization_id: string }>()
  if (!row) throw new Error(`Expected Agent ${agentId}`)
  return row
}

describe('[CF] /api/v1/agents', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the stable error envelope for validation failures', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/agents', {
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

  it('requires authentication before creating project-scoped agents', async () => {
    const createRes = await SELF.fetch('https://example.com/api/v1/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'unauthenticated-agent-create' },
      body: JSON.stringify({
        username: 'research-assistant',
        ...agentBody('Research assistant', { runtime: 'ama', systemPrompt: 'Answer with citations.' }),
      }),
    })

    expect(createRes.status).toBe(401)
    expect(await createRes.json()).toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
      },
    })
  })

  it('requires an explicit runtime when creating an Agent', async () => {
    const authorization = await signIn()
    const path = '/api/v1/agents'
    const createRes = await SELF.fetch(`https://example.com${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': `agent-${crypto.randomUUID()}`,
        ...dpopHeaders(authorization, 'POST', path),
      },
      body: JSON.stringify({
        username: `missing-runtime-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`,
        ...agentBody('Missing runtime'),
      }),
    })

    expect(createRes.status).toBe(400)
    await expect(createRes.json()).resolves.toMatchObject({ error: { type: 'validation_error' } })
  })

  it('lists legacy Agents without invented identity and filters by complete identity', async () => {
    const authorization = await signIn()
    const agentId = await seedLegacyAgent(authorization)
    const modernRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Identity-bound Agent')),
    })
    expect(modernRes.status).toBe(201)
    const modernId = ((await modernRes.json()) as { metadata: { uid: string } }).metadata.uid

    const read = await jsonFetch(`/api/v1/agents/${agentId}`, authorization)
    expect(read.status).toBe(200)
    await expect(read.json()).resolves.toMatchObject({
      metadata: { uid: agentId },
      identity: null,
      spec: { runtime: 'codex', systemPrompt: 'Legacy prompt' },
      status: { ready: true, currentVersionId: expect.any(String), version: 1 },
    })

    const list = await jsonFetch('/api/v1/agents', authorization)
    expect(list.status).toBe(200)
    const body = (await list.json()) as { data: Array<Record<string, unknown>> }
    expect(body.data).toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ uid: agentId }), identity: null }),
    )

    const withIdentityRes = await jsonFetch('/api/v1/agents?hasIdentity=true', authorization)
    expect(withIdentityRes.status).toBe(200)
    const withIdentity = (await withIdentityRes.json()) as {
      data: Array<{ metadata: { uid: string }; identity: Record<string, unknown> | null }>
    }
    expect(withIdentity.data.map((agent) => agent.metadata.uid)).toEqual([modernId])
    expect(withIdentity.data[0]?.identity).toMatchObject({ issuer: expect.any(String), subject: expect.any(String) })

    const withoutIdentityRes = await jsonFetch('/api/v1/agents?hasIdentity=false', authorization)
    expect(withoutIdentityRes.status).toBe(200)
    const withoutIdentity = (await withoutIdentityRes.json()) as {
      data: Array<{ metadata: { uid: string }; identity: Record<string, unknown> | null }>
    }
    expect(withoutIdentity.data).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ uid: agentId }), identity: null }),
    ])
  })

  it('fails closed when a legacy database row contains a partial Agent identity', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Corrupt identity Agent')),
    })
    expect(createRes.status).toBe(201)
    const agentId = ((await createRes.json()) as { metadata: { uid: string } }).metadata.uid

    await env.DB.exec('DROP TRIGGER agents_identity_complete_update')
    await env.DB.prepare('UPDATE agents SET identity_subject = NULL WHERE id = ?').bind(agentId).run()

    const readRes = await jsonFetch(`/api/v1/agents/${agentId}`, authorization)
    expect(readRes.status).toBe(500)
    expect(await readRes.text()).not.toContain('Corrupt identity Agent')
  })

  it('[spec: agents/delete] protects and atomically revokes the managed credential when deleting an unreferenced Agent', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Locally deleted Agent')),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { metadata: { uid: string } }
    const agentId = created.metadata.uid
    const managedCredentials = await env.DB.prepare(
      `SELECT id,vault_id,type,state,active_version_id FROM vault_credentials
       WHERE json_extract(metadata, '$.agentId') = ?
         AND json_extract(metadata, '$.managedBy') = 'agent-creation'`,
    )
      .bind(agentId)
      .all<{
        id: string
        vault_id: string
        type: string
        state: string
        active_version_id: string | null
      }>()
    expect(managedCredentials.results).toHaveLength(2)
    expect(managedCredentials.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'opaque', state: 'revoked', active_version_id: null }),
        expect.objectContaining({ type: 'ama.dev/realmroot-agent-state', state: 'active' }),
      ]),
    )
    const stateCredential = managedCredentials.results.find(
      (credential) => credential.type === 'ama.dev/realmroot-agent-state',
    )!
    const credentialId = stateCredential.id
    const vaultId = stateCredential.vault_id
    for (const [method, body] of [
      ['PATCH', { metadata: { owner: 'caller' } }],
      ['PUT', { stringData: { value: 'replacement' } }],
    ] as const) {
      const response = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials/${credentialId}`, authorization, {
        method,
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({ error: { type: 'conflict' } })
    }
    const versionsBefore = await env.DB.prepare('SELECT COUNT(*) AS count FROM agent_versions WHERE agent_id = ?')
      .bind(agentId)
      .first<{ count: number }>()
    const vaultsBefore = await env.DB.prepare('SELECT COUNT(*) AS count FROM vaults').first<{ count: number }>()
    expect(versionsBefore?.count).toBe(1)
    expect(vaultsBefore?.count).toBeGreaterThan(0)
    const versionsBeforeDelete = await env.DB.prepare(
      `SELECT vault_credential_versions.state
       FROM vault_credential_versions
       JOIN vault_credentials ON vault_credentials.id = vault_credential_versions.credential_id
       WHERE json_extract(vault_credentials.metadata, '$.agentId') = ?
       ORDER BY vault_credentials.type`,
    )
      .bind(agentId)
      .all<{ state: string }>()
    expect(versionsBeforeDelete.results).toEqual(expect.arrayContaining([{ state: 'revoked' }, { state: 'active' }]))

    const realmrootFetch = vi.fn(async () => {
      throw new Error('DELETE must not call Realmroot')
    })
    vi.stubGlobal('fetch', realmrootFetch)
    const deleteRes = await jsonFetch(`/api/v1/agents/${agentId}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status, await deleteRes.clone().text()).toBe(204)
    expect(realmrootFetch).not.toHaveBeenCalled()

    const storedAgent = await env.DB.prepare('SELECT id FROM agents WHERE id = ?').bind(agentId).first()
    const versionsAfter = await env.DB.prepare('SELECT COUNT(*) AS count FROM agent_versions WHERE agent_id = ?')
      .bind(agentId)
      .first<{ count: number }>()
    const vaultsAfter = await env.DB.prepare('SELECT COUNT(*) AS count FROM vaults').first<{ count: number }>()
    expect(storedAgent).toBeNull()
    expect(versionsAfter?.count).toBe(0)
    expect(vaultsAfter?.count).toBe(vaultsBefore?.count)
    const credentialsAfterDelete = await env.DB.prepare(
      `SELECT state,active_version_id FROM vault_credentials
       WHERE json_extract(metadata, '$.agentId') = ?`,
    )
      .bind(agentId)
      .all<{ state: string; active_version_id: string | null }>()
    expect(credentialsAfterDelete.results).toEqual([
      { state: 'revoked', active_version_id: null },
      { state: 'revoked', active_version_id: null },
    ])
    const credentialVersionsAfterDelete = await env.DB.prepare(
      `SELECT vault_credential_versions.state
       FROM vault_credential_versions
       JOIN vault_credentials ON vault_credentials.id = vault_credential_versions.credential_id
       WHERE json_extract(vault_credentials.metadata, '$.agentId') = ?`,
    )
      .bind(agentId)
      .all<{ state: string }>()
    expect(credentialVersionsAfterDelete.results).toEqual([{ state: 'revoked' }, { state: 'revoked' }])

    const readRes = await jsonFetch(`/api/v1/agents/${agentId}`, authorization)
    expect(readRes.status).toBe(404)
    const versionsRes = await jsonFetch(`/api/v1/agents/${agentId}/versions`, authorization)
    expect(versionsRes.status).toBe(404)
  })

  it.each([
    'session',
    'trigger',
  ] as const)('rejects deletion while a %s references the Agent and keeps the Agent and versions', async (reference) => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody(`${reference} referenced Agent`)),
    })
    expect(createRes.status).toBe(201)
    const agentId = ((await createRes.json()) as { metadata: { uid: string } }).metadata.uid
    const project = await agentProject(agentId)
    const timestamp = new Date().toISOString()

    if (reference === 'session') {
      await env.DB.prepare(
        `INSERT INTO sessions (id, agent_id, project_id, durable_object_name, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'stopped', ?, ?)`,
      )
        .bind(`session_${crypto.randomUUID()}`, agentId, project.project_id, `session:${agentId}`, timestamp, timestamp)
        .run()
    } else {
      await env.DB.prepare(
        `INSERT INTO triggers
           (id, organization_id, project_id, agent_id, runtime, name, prompt_template,
            interval_seconds, next_due_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ama', ?, 'Run scheduled work', 3600, ?, ?, ?)`,
      )
        .bind(
          `trigger_${crypto.randomUUID()}`,
          project.organization_id,
          project.project_id,
          agentId,
          `${reference} reference`,
          timestamp,
          timestamp,
          timestamp,
        )
        .run()
    }

    const deleteRes = await jsonFetch(`/api/v1/agents/${agentId}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(409)
    await expect(deleteRes.json()).resolves.toMatchObject({ error: { type: 'conflict' } })

    const readRes = await jsonFetch(`/api/v1/agents/${agentId}`, authorization)
    expect(readRes.status).toBe(200)
    const versions = await env.DB.prepare('SELECT COUNT(*) AS count FROM agent_versions WHERE agent_id = ?')
      .bind(agentId)
      .first<{ count: number }>()
    expect(versions?.count).toBe(1)
  })

  it('rejects removed legacy fields (instructions, providerId, status, role, handoff, tools)', async () => {
    const authorization = await signIn()
    for (const body of [
      { name: 'Legacy prompt', instructions: 'Answer with citations.' },
      { name: 'Legacy provider', providerId: 'workers-ai' },
      { name: 'Legacy status', status: 'active' },
      { name: 'Legacy role', role: 'maintainer' },
      { name: 'Legacy handoff', handoff: { enabled: true } },
      { name: 'Legacy tools', tools: [{ name: 'read' }] },
    ]) {
      const res = await jsonFetch('/api/v1/agents', authorization, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({
        error: { type: 'validation_error', message: 'Invalid request' },
      })
    }
  })

  it('creates one ready Agent for concurrent idempotent requests and rejects conflicting reuse', async () => {
    const authorization = await signIn()
    const idempotencyKey = `agent-concurrent-${crypto.randomUUID()}`
    const body = JSON.stringify({
      username: `concurrent-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
      ...agentBody('Concurrent Agent', { runtime: 'ama', systemPrompt: 'Handle one creation.' }),
    })
    const create = (requestBody: string) =>
      jsonFetch('/api/v1/agents', authorization, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: requestBody,
      })

    const [first, second] = await Promise.all([create(body), create(body)])
    expect([first.status, second.status]).toEqual([201, 201])
    const [firstAgent, secondAgent] = (await Promise.all([first.json(), second.json()])) as Array<{
      metadata: { uid: string }
      status: { ready: boolean; version: number }
    }>
    expect(secondAgent.metadata.uid).toBe(firstAgent.metadata.uid)
    expect(first.headers.get('location')).toBe(`/api/v1/agents/${firstAgent.metadata.uid}`)
    expect(second.headers.get('location')).toBe(`/api/v1/agents/${firstAgent.metadata.uid}`)
    expect(firstAgent.status).toMatchObject({ ready: true, version: 1 })

    const conflict = await create(
      JSON.stringify({
        username: `different-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
        ...agentBody('Different Agent', { runtime: 'ama', systemPrompt: 'Different request.' }),
      }),
    )
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ error: { type: 'conflict' } })
  })

  it('creates, reads, updates, versions, and archives project-scoped agents [spec: agents/api-crud] [spec: agents/api-archive]', async () => {
    const authorization = await signIn()

    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(
        agentBody('Research assistant', {
          systemPrompt: 'Answer with citations.',
          skills: ['ama@research'],
          allowedTools: ['read', 'fetch'],
          subagents: [
            {
              name: 'reviewer',
              description: 'Reviews proposed changes for correctness and risk.',
              systemPrompt: 'Review the proposed changes and report risks.',
              allowedTools: ['read', 'grep'],
            },
          ],
          mcpConnectors: ['github'],
        }),
      ),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      metadata: { uid: string; archivedAt: string | null; description: string | null }
      spec: {
        provider: string | null
        systemPrompt: string
        skills: string[]
        allowedTools: string[]
        subagents: unknown[]
        mcpConnectors: string[]
      }
      status: { currentVersionId: string; version: number; phase: string }
    }
    const createdId = created.metadata.uid
    expect(created.status.version).toBe(1)
    expect(created.spec.provider).toBeNull()
    expect(created.metadata.archivedAt).toBeNull()
    expect(created.status.phase).toBe('active')
    expect(created.spec.allowedTools).toEqual(['read', 'fetch'])

    const runtimeUpdateRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { runtime: 'codex' } }),
    })
    expect(runtimeUpdateRes.status).toBe(400)
    const afterRuntimeUpdate = await jsonFetch(`/api/v1/agents/${createdId}`, authorization)
    expect(afterRuntimeUpdate.status).toBe(200)
    await expect(afterRuntimeUpdate.json()).resolves.toMatchObject({ spec: { runtime: 'ama' } })

    const readRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      metadata: { uid: createdId, archivedAt: null },
      spec: {
        provider: null,
        systemPrompt: 'Answer with citations.',
        skills: ['ama@research'],
        allowedTools: ['read', 'fetch'],
        subagents: [
          {
            name: 'reviewer',
            description: 'Reviews proposed changes for correctness and risk.',
            systemPrompt: 'Review the proposed changes and report risks.',
            model: null,
            allowedTools: ['read', 'grep'],
            skills: [],
            mcpConnectors: [],
          },
        ],
        mcpConnectors: ['github'],
      },
      status: { version: 1 },
    })

    const updateRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        metadata: { description: 'Updated description' },
        spec: { skills: ['ama@research', 'ama@review'] },
      }),
    })
    expect(updateRes.status).toBe(200)
    const updated = (await updateRes.json()) as {
      metadata: { description: string | null }
      spec: { skills: string[] }
      status: { version: number; currentVersionId: string }
    }
    expect(updated.status.version).toBe(2)
    expect(updated.status.currentVersionId).not.toBe(created.status.currentVersionId)
    expect(updated).toMatchObject({
      metadata: { description: 'Updated description' },
      spec: { skills: ['ama@research', 'ama@review'] },
    })

    const updatePromptRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { description: null }, spec: { systemPrompt: 'Updated system prompt.' } }),
    })
    expect(updatePromptRes.status).toBe(200)
    await expect(updatePromptRes.json()).resolves.toMatchObject({
      metadata: { description: null },
      spec: { systemPrompt: 'Updated system prompt.' },
      status: { version: 3 },
    })

    const versionsRes = await jsonFetch(`/api/v1/agents/${createdId}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as {
      data: Array<{
        spec: { systemPrompt: string; provider: string | null; allowedTools: string[] }
        status: { version: number }
      }>
      pagination: Record<string, unknown>
    }
    expect(versions.data.map((version) => version.status.version)).toEqual([3, 2, 1])
    expect(versions.data.find((version) => version.status.version === 1)?.spec.systemPrompt).toBe(
      'Answer with citations.',
    )
    expect(versions.data.find((version) => version.status.version === 3)?.spec.systemPrompt).toBe(
      'Updated system prompt.',
    )
    expect(versions.pagination).not.toHaveProperty('firstId')
    expect(versions.pagination).not.toHaveProperty('lastId')

    const versionItemRes = await jsonFetch(`/api/v1/agents/${createdId}/versions/1`, authorization)
    expect(versionItemRes.status).toBe(200)
    await expect(versionItemRes.json()).resolves.toMatchObject({
      status: { agentId: createdId, version: 1 },
      spec: { systemPrompt: 'Answer with citations.', allowedTools: ['read', 'fetch'] },
    })

    const missingVersionRes = await jsonFetch(`/api/v1/agents/${createdId}/versions/99`, authorization)
    expect(missingVersionRes.status).toBe(404)

    const invalidVersionRes = await jsonFetch(`/api/v1/agents/${createdId}/versions/not-a-number`, authorization)
    expect(invalidVersionRes.status).toBe(400)

    const archiveRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    const archivedAgent = (await archiveRes.json()) as { metadata: { archivedAt: string | null } }
    expect(archivedAgent.metadata.archivedAt).toEqual(expect.any(String))

    const listRes = await jsonFetch('/api/v1/agents', authorization)
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as {
      data: Array<{ metadata: { uid: string } }>
      pagination: { hasMore: boolean }
    }
    expect(list.data).not.toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ uid: createdId }) }),
    )
    expect(list.pagination.hasMore).toBe(false)

    const archivedListRes = await jsonFetch('/api/v1/agents?archived=true', authorization)
    expect(archivedListRes.status).toBe(200)
    const archivedList = (await archivedListRes.json()) as {
      data: Array<{ metadata: { uid: string; archivedAt: string | null } }>
    }
    expect(archivedList.data).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ uid: createdId, archivedAt: expect.any(String) }),
      }),
    )

    const archivedReadRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization)
    expect(archivedReadRes.status).toBe(200)
    await expect(archivedReadRes.json()).resolves.toMatchObject({ metadata: { archivedAt: expect.any(String) } })

    const auditRes = await jsonFetch('/api/v1/audit-records?action=agent.archive', authorization)
    expect(auditRes.status).toBe(200)
    await expect(auditRes.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ resourceId: createdId, outcome: 'success' })],
    })

    const archivedUpdateRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { description: 'Cannot update archived agents' } }),
    })
    expect(archivedUpdateRes.status).toBe(409)

    // Archiving an archived agent is idempotent.
    const reArchiveRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(reArchiveRes.status).toBe(200)

    const unarchiveRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(unarchiveRes.status).toBe(200)
    await expect(unarchiveRes.json()).resolves.toMatchObject({ metadata: { archivedAt: null } })

    const unarchivedUpdateRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { description: 'Updatable again' } }),
    })
    expect(unarchivedUpdateRes.status).toBe(200)
  })

  it('lists agents with pagination, search, archived, and date filters within the project [spec: agents/api-pagination] [spec: api-contracts/pagination] [spec: api-contracts/date-filters]', async () => {
    const authorization = await signIn()
    const createAlphaRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Alpha research')),
    })
    const alpha = (await createAlphaRes.json()) as { metadata: { uid: string; createdAt: string } }
    const alphaId = alpha.metadata.uid
    const createBetaRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Beta support')),
    })
    const beta = (await createBetaRes.json()) as { metadata: { uid: string; createdAt: string } }
    const betaId = beta.metadata.uid
    await jsonFetch(`/api/v1/agents/${alphaId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })

    const defaultListRes = await jsonFetch('/api/v1/agents?limit=1', authorization)
    expect(defaultListRes.status).toBe(200)
    const defaultList = (await defaultListRes.json()) as {
      data: Array<{ metadata: { uid: string; archivedAt: string | null } }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(defaultList.data).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ uid: betaId, archivedAt: null }) }),
    ])
    expect(defaultList.pagination).toMatchObject({ limit: 1, hasMore: false, nextCursor: null })

    const archivedListRes = await jsonFetch('/api/v1/agents?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as {
      data: Array<{ metadata: { uid: string; archivedAt: string | null } }>
    }
    expect(archivedList.data).toEqual([
      expect.objectContaining({ metadata: expect.objectContaining({ uid: alphaId, archivedAt: expect.any(String) }) }),
    ])

    const searchRes = await jsonFetch('/api/v1/agents?archived=true&search=Alpha', authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(searchList.data).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ uid: alphaId }) })])

    const noMatchSearchRes = await jsonFetch('/api/v1/agents?search=Alpha', authorization)
    const noMatchSearch = (await noMatchSearchRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(noMatchSearch.data).toEqual([])

    const dateRes = await jsonFetch(
      `/api/v1/agents?createdFrom=${encodeURIComponent(alpha.metadata.createdAt)}&createdTo=${encodeURIComponent(beta.metadata.createdAt)}`,
      authorization,
    )
    const dateList = (await dateRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(dateList.data.map((agent) => agent.metadata.uid)).toEqual([betaId])

    await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Gamma triage')),
    })
    const firstPageRes = await jsonFetch('/api/v1/agents?limit=1', authorization)
    const firstPage = (await firstPageRes.json()) as {
      data: Array<{ metadata: { uid: string } }>
      pagination: { hasMore: boolean; nextCursor: string | null }
    }
    expect(firstPage.data).toHaveLength(1)
    expect(firstPage.pagination.hasMore).toBe(true)
    expect(firstPage.pagination.nextCursor).toEqual(expect.any(String))

    const nextPageRes = await jsonFetch(
      `/api/v1/agents?limit=1&cursor=${firstPage.pagination.nextCursor}`,
      authorization,
    )
    const nextPage = (await nextPageRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(nextPage.data).toHaveLength(1)
    expect(nextPage.data.map((agent) => agent.metadata.uid)).not.toEqual(
      firstPage.data.map((agent) => agent.metadata.uid),
    )

    const invalidCursorRes = await jsonFetch('/api/v1/agents?cursor=not-a-cursor', authorization)
    expect(invalidCursorRes.status).toBe(400)
    await expect(invalidCursorRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { cursor: expect.any(String) } } },
    })
  })

  it('validates provider against configured providers', async () => {
    const authorization = await signIn()

    const missingProviderRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Missing provider agent', { provider: 'provider_missing' })),
    })
    expect(missingProviderRes.status).toBe(400)
    await expect(missingProviderRes.json()).resolves.toMatchObject({
      error: { details: { fields: { provider: expect.any(String) } } },
    })

    // Null provider defers provider resolution to session start.
    const deferredRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Deferred provider agent', { provider: null })),
    })
    expect(deferredRes.status).toBe(201)
    await expect(deferredRes.json()).resolves.toMatchObject({ spec: { provider: null } })

    // Providers are a global vendor catalog seeded out of band (discovery), not
    // created through the API. Bind the agent to the seeded vendor row.
    const { providerId, modelId } = await seedPlatformProvider()

    const boundRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Bound provider agent', { provider: providerId, model: modelId })),
    })
    expect(boundRes.status).toBe(201)
    await expect(boundRes.json()).resolves.toMatchObject({ spec: { provider: providerId, model: modelId } })

    // An unknown model is accepted at agent creation; (provider, model) validation
    // against the global catalog is deferred to session start.
    const unknownModelRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Unknown model agent', { provider: providerId, model: 'unknown-model' })),
    })
    expect(unknownModelRes.status).toBe(201)
    await expect(unknownModelRes.json()).resolves.toMatchObject({
      spec: { provider: providerId, model: 'unknown-model' },
    })
  })

  it('rejects blocked tools, invalid skills, raw secrets, and cross-project reads', async () => {
    const authorization = await signIn()

    const invalidSkillRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Invalid skill', { skills: ['missing-style'] })),
    })
    expect(invalidSkillRes.status).toBe(400)
    await expect(invalidSkillRes.json()).resolves.toMatchObject({
      error: { details: { fields: { skills: expect.any(String) } } },
    })

    const invalidMcpRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Invalid MCP agent', { mcpConnectors: ['missing-connector'] })),
    })
    expect(invalidMcpRes.status).toBe(400)
    await expect(invalidMcpRes.json()).resolves.toMatchObject({
      error: { details: { fields: { mcpConnectors: expect.any(String) } } },
    })

    const rawSecretMetadataRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(
        agentBody('Raw secret agent', {
          subagents: [
            {
              name: 'secret-reviewer',
              description: 'Reviews secret-looking prompts.',
              systemPrompt: 'raw-secret',
              allowedTools: ['read'],
            },
          ],
        }),
      ),
    })
    expect(rawSecretMetadataRes.status).toBe(400)
    await expect(rawSecretMetadataRes.json()).resolves.toMatchObject({
      error: { details: { fields: { subagents: expect.any(String) } } },
    })

    const rawSecretSkillRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Raw secret skill agent', { skills: ['ama@raw-secret-token'] })),
    })
    expect(rawSecretSkillRes.status).toBe(400)
    await expect(rawSecretSkillRes.json()).resolves.toMatchObject({
      error: { details: { fields: { skills: expect.any(String) } } },
    })

    const invalidToolRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Invalid tool agent', { allowedTools: ['repo.delete'] })),
    })
    expect(invalidToolRes.status).toBe(400)
    await expect(invalidToolRes.json()).resolves.toMatchObject({
      error: { details: { fields: { allowedTools: expect.any(String) } } },
    })

    const validAgentRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Valid agent')),
    })
    expect(validAgentRes.status).toBe(201)

    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Tenant agent')),
    })
    const agent = (await createRes.json()) as { metadata: { uid: string } }
    const agentId = agent.metadata.uid
    const otherAuthorization = await signIn({
      ...defaultClaims(),
      sub: 'user_456',
      email: 'other@example.com',
      organizationId: 'org_flare_456',
    })

    const crossProjectRead = await jsonFetch(`/api/v1/agents/${agentId}`, otherAuthorization)
    expect(crossProjectRead.status).toBe(404)
  })

  it('stores allowed tool names on agent versions and rejects unsupported names', async () => {
    const authorization = await signIn()

    const duplicateRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Duplicate tools', { allowedTools: ['web_search', 'web_search'] })),
    })
    expect(duplicateRes.status).toBe(400)
    await expect(duplicateRes.json()).resolves.toMatchObject({
      error: { details: { fields: { allowedTools: expect.stringContaining('more than once') } } },
    })

    const unsupportedRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Unsupported tools', { allowedTools: ['repo.delete'] })),
    })
    expect(unsupportedRes.status).toBe(400)
    await expect(unsupportedRes.json()).resolves.toMatchObject({
      error: { details: { fields: { allowedTools: expect.stringContaining('not supported') } } },
    })

    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Tooled agent', { allowedTools: ['read', 'web_search'] })),
    })
    expect(createRes.status).toBe(201)
    const agent = (await createRes.json()) as { metadata: { uid: string }; spec: { allowedTools: string[] } }
    const agentId = agent.metadata.uid
    expect(agent.spec.allowedTools).toEqual(['read', 'web_search'])

    const versionsRes = await jsonFetch(`/api/v1/agents/${agentId}/versions`, authorization)
    expect(versionsRes.status).toBe(200)
    const versions = (await versionsRes.json()) as { data: Array<{ spec: { allowedTools: string[] } }> }
    expect(versions.data[0]?.spec.allowedTools).toEqual(['read', 'web_search'])

    // Updating allowedTools writes a new immutable version.
    const updateRes = await jsonFetch(`/api/v1/agents/${agentId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { allowedTools: ['bash'] } }),
    })
    expect(updateRes.status).toBe(200)
    const updatedVersionsRes = await jsonFetch(`/api/v1/agents/${agentId}/versions`, authorization)
    const updatedVersions = (await updatedVersionsRes.json()) as {
      data: Array<{ spec: { allowedTools: string[] } }>
    }
    expect(updatedVersions.data).toHaveLength(2)
    expect(updatedVersions.data[0]?.spec.allowedTools).toEqual(['bash'])

    const updateBlockedRes = await jsonFetch(`/api/v1/agents/${agentId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { allowedTools: ['repo.delete'] } }),
    })
    expect(updateBlockedRes.status).toBe(400)
  })
})
