import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultClaims, dpopHeaders, seedPlatformProvider, setupOidcProvider, signIn } from './auth'

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

function agentBody(name: string, spec: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) {
  return {
    metadata: { name, ...metadata },
    spec: {
      systemPrompt: `${name} system prompt.`,
      ...spec,
    },
  }
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(agentBody('Research assistant', { systemPrompt: 'Answer with citations.' })),
    })

    expect(createRes.status).toBe(401)
    expect(await createRes.json()).toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
      },
    })
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

  it('[spec: api-contracts/resource-identifiers] creates UUIDv7 identifiers and reads persisted prefixed identifiers', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Opaque identifier agent')),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { metadata: { uid: string } }
    expect(created.metadata.uid).toMatch(UUID_V7)
    const stored = await env.DB.prepare('SELECT project_id FROM agents WHERE id = ?')
      .bind(created.metadata.uid)
      .first<{ project_id: string }>()
    if (!stored) throw new Error('Expected created Agent')

    const legacyId = 'agent_legacy_identifier'
    const now = '2026-08-29T00:00:00.000Z'
    await env.DB.prepare(`INSERT INTO agents (
      id,project_id,name,system_prompt,skills,subagents,allowed_tools,mcp_connectors,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .bind(legacyId, stored.project_id, 'Legacy identifier agent', 'Work.', '[]', '[]', '[]', '[]', now, now)
      .run()

    const readRes = await jsonFetch(`/api/v1/agents/${legacyId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ metadata: { uid: legacyId } })
  })

  it('creates, reads, updates, versions, and deletes project-scoped agents [spec: agents/api-crud] [spec: agents/api-delete]', async () => {
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
      metadata: { uid: string; description: string | null }
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
    expect(created.status.phase).toBe('active')
    expect(created.spec.allowedTools).toEqual(['read', 'fetch'])

    const readRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({
      metadata: { uid: createdId },
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

    const deleteRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)

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

    const deletedReadRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization)
    expect(deletedReadRes.status).toBe(404)
    const deletedUpdateRes = await jsonFetch(`/api/v1/agents/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { description: 'Cannot update deleted agents' } }),
    })
    expect(deletedUpdateRes.status).toBe(404)
    expect((await jsonFetch(`/api/v1/agents/${createdId}`, authorization, { method: 'DELETE' })).status).toBe(404)
    expect(
      (
        await env.DB.prepare('SELECT deleted_at FROM agents WHERE id = ?')
          .bind(createdId)
          .first<{ deleted_at: string }>()
      )?.deleted_at,
    ).toEqual(expect.any(String))

    const project = await env.DB.prepare('SELECT project_id FROM agents WHERE id = ?')
      .bind(createdId)
      .first<{ project_id: string }>()
    await env.DB.prepare('UPDATE projects SET deleted_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), project!.project_id)
      .run()
    const deletedProjectCreateRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Cannot attach to deleted project')),
    })
    expect(deletedProjectCreateRes.status).toBe(409)
  })

  it('[spec: agents/api-delete] deletes a persisted legacy agent without validating its runtime fields', async () => {
    const authorization = await signIn()
    const createdRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Legacy delete target')),
    })
    const created = (await createdRes.json()) as { metadata: { uid: string } }
    await env.DB.prepare('UPDATE agents SET subagents = ? WHERE id = ?')
      .bind(
        JSON.stringify([
          {
            name: 'Maya Lin',
            bio: 'Legacy persisted sub-agent.',
            instructions: 'Review the work.',
            modelPreferences: {},
          },
        ]),
        created.metadata.uid,
      )
      .run()

    const deleteRes = await jsonFetch(`/api/v1/agents/${created.metadata.uid}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)
    expect((await jsonFetch(`/api/v1/agents/${created.metadata.uid}`, authorization)).status).toBe(404)
  })

  it('lists agents with pagination, search, and date filters within the project [spec: agents/api-pagination] [spec: api-contracts/pagination] [spec: api-contracts/date-filters]', async () => {
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
    await jsonFetch(`/api/v1/agents/${alphaId}`, authorization, { method: 'DELETE' })

    const defaultListRes = await jsonFetch('/api/v1/agents?limit=1', authorization)
    expect(defaultListRes.status).toBe(200)
    const defaultList = (await defaultListRes.json()) as {
      data: Array<{ metadata: { uid: string } }>
      pagination: { limit: number; hasMore: boolean; nextCursor: string | null }
    }
    expect(defaultList.data).toEqual([expect.objectContaining({ metadata: expect.objectContaining({ uid: betaId }) })])
    expect(defaultList.pagination).toMatchObject({ limit: 1, hasMore: false, nextCursor: null })

    const searchRes = await jsonFetch('/api/v1/agents?search=Alpha', authorization)
    const searchList = (await searchRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(searchList.data).toEqual([])

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

  it('resolves the project agent bound to an exact Realmroot actor id [spec: agents/api-identity-lookup]', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Realmroot-bound agent')),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { metadata: { uid: string } }
    const stored = await env.DB.prepare('SELECT project_id FROM agents WHERE id = ?')
      .bind(created.metadata.uid)
      .first<{ project_id: string }>()
    if (!stored) throw new Error('Expected created Agent')

    const realmrootAgentId = '019ff41a-7da6-708f-8b05-44d4d0373685'
    const identityId = 'identity_exact_actor_lookup'
    const now = '2026-08-30T00:00:00.000Z'
    await env.DB.prepare(`INSERT INTO identities (
      id,project_id,organization_id,name,username,runtime,state,vault_id,credential_id,remote_agent_id,issuer,subject,
      idempotency_key_hash,request_fingerprint,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        identityId,
        stored.project_id,
        defaultClaims().organizationId,
        'Exact actor Identity',
        'exact-actor',
        'codex',
        'active',
        'vault_exact_actor_lookup',
        'credential_exact_actor_lookup',
        realmrootAgentId,
        'https://id.realmroot.dev/api/auth',
        realmrootAgentId,
        'hash_exact_actor_lookup',
        'fingerprint_exact_actor_lookup',
        now,
        now,
      )
      .run()

    const bindRes = await jsonFetch(`/api/v1/agents/${created.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { identityRef: identityId } }),
    })
    expect(bindRes.status).toBe(200)

    const lookupRes = await jsonFetch(
      `/api/v1/agents?identityAgentId=${encodeURIComponent(realmrootAgentId)}`,
      authorization,
    )
    expect(lookupRes.status).toBe(200)
    await expect(lookupRes.json()).resolves.toMatchObject({
      data: [
        {
          metadata: { uid: created.metadata.uid },
          spec: { identity: { identityId, agentId: realmrootAgentId } },
        },
      ],
      pagination: { hasMore: false, nextCursor: null },
    })

    const missingRes = await jsonFetch('/api/v1/agents?identityAgentId=missing-realmroot-agent', authorization)
    expect(missingRes.status).toBe(200)
    await expect(missingRes.json()).resolves.toMatchObject({ data: [] })

    const otherAuthorization = await signIn({
      ...defaultClaims(),
      sub: 'user_exact_actor_other',
      email: 'exact-actor-other@example.com',
      organizationId: 'org_exact_actor_other',
    })
    const concealedRes = await jsonFetch(
      `/api/v1/agents?identityAgentId=${encodeURIComponent(realmrootAgentId)}`,
      otherAuthorization,
    )
    expect(concealedRes.status).toBe(200)
    await expect(concealedRes.json()).resolves.toMatchObject({ data: [] })

    const deleteRes = await jsonFetch(`/api/v1/agents/${created.metadata.uid}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(204)
    const deletedLookup = await jsonFetch(
      `/api/v1/agents?identityAgentId=${encodeURIComponent(realmrootAgentId)}`,
      authorization,
    )
    await expect(deletedLookup.json()).resolves.toMatchObject({ data: [] })

    const emptyRes = await jsonFetch('/api/v1/agents?identityAgentId=', authorization)
    expect(emptyRes.status).toBe(400)
    const whitespaceRes = await jsonFetch('/api/v1/agents?identityAgentId=%20actor%20', authorization)
    expect(whitespaceRes.status).toBe(400)
    const oversizedRes = await jsonFetch(`/api/v1/agents?identityAgentId=${'a'.repeat(161)}`, authorization)
    expect(oversizedRes.status).toBe(400)
  })

  it('returns 409 without binding an Identity whose runtime has no registered Enbor driver [spec: agents/identity-binding]', async () => {
    const authorization = await signIn()
    const createResponse = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Unsupported runtime Agent')),
    })
    expect(createResponse.status).toBe(201)
    const agent = (await createResponse.json()) as { metadata: { uid: string } }
    const project = await env.DB.prepare('SELECT project_id FROM agents WHERE id = ?')
      .bind(agent.metadata.uid)
      .first<{ project_id: string }>()
    if (!project) throw new Error('Expected signed-in Project')
    const identityId = 'identity_unsupported_runtime'
    const now = '2026-09-03T00:00:00.000Z'
    await env.DB.prepare(`INSERT INTO identities (
      id,project_id,organization_id,name,username,runtime,state,vault_id,credential_id,remote_agent_id,issuer,subject,
      idempotency_key_hash,request_fingerprint,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        identityId,
        project.project_id,
        defaultClaims().organizationId,
        'Hermes Identity',
        'hermes-worker',
        'hermes',
        'active',
        'vault_unsupported_runtime',
        'credential_unsupported_runtime',
        'realmroot_agent_unsupported_runtime',
        'https://id.realmroot.dev/api/auth',
        'realmroot_subject_unsupported_runtime',
        'hash_unsupported_runtime',
        'fingerprint_unsupported_runtime',
        now,
        now,
      )
      .run()

    const response = await jsonFetch(`/api/v1/agents/${agent.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { identityRef: identityId } }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        type: 'identity_runtime_unsupported',
        message: 'Identity runtime is not supported by this Enbor deployment: hermes.',
      },
    })
    await expect(
      env.DB.prepare('SELECT bound_agent_id FROM identities WHERE id = ?')
        .bind(identityId)
        .first<{ bound_agent_id: string | null }>(),
    ).resolves.toEqual({ bound_agent_id: null })
  })

  it('[spec: agents/api-schedulability] filters by Identity runtime and current Inbox scheduling readiness', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Schedulable Codex agent', { model: 'gpt-5.6-sol' })),
    })
    expect(createRes.status).toBe(201)
    const agent = (await createRes.json()) as { metadata: { uid: string } }
    const project = await env.DB.prepare('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1').first<{
      id: string
    }>()
    if (!project) throw new Error('Expected project')

    const now = new Date().toISOString()
    const identityId = 'identity_schedulable_codex'
    const subject = '019ff41a-7da6-708f-8b05-44d4d0373999'
    await env.DB.prepare(`INSERT INTO identities (
      id,project_id,organization_id,name,username,runtime,state,vault_id,credential_id,remote_agent_id,issuer,subject,
      idempotency_key_hash,request_fingerprint,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        identityId,
        project.id,
        defaultClaims().organizationId,
        'Schedulable Identity',
        'schedulable-codex',
        'codex',
        'active',
        'vault_schedulable_codex',
        'credential_schedulable_codex',
        subject,
        'https://id.realmroot.dev/api/auth',
        subject,
        'hash_schedulable_codex',
        'fingerprint_schedulable_codex',
        now,
        now,
      )
      .run()
    const bindRes = await jsonFetch(`/api/v1/agents/${agent.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { identityRef: identityId } }),
    })
    expect(bindRes.status).toBe(200)

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO environments (
        id,project_id,name,hosting_mode,current_version_id,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?)`).bind(
        'environment_schedulable_codex',
        project.id,
        'Local Codex',
        'self_hosted',
        'environment_version_schedulable_codex',
        now,
        now,
      ),
      env.DB.prepare(`INSERT INTO environment_versions (
        id,environment_id,project_id,version,packages,variables,hosting_mode,network_policy,mcp_policy,
        package_manager_policy,resource_limits,runtime_config,metadata,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        'environment_version_schedulable_codex',
        'environment_schedulable_codex',
        project.id,
        1,
        '[]',
        '{}',
        'self_hosted',
        '{"mode":"unrestricted"}',
        '{}',
        '{}',
        '{}',
        '{}',
        '{}',
        now,
      ),
      env.DB.prepare(`INSERT INTO runners (
        id,organization_id,project_id,name,environment_id,state,current_load,max_concurrent,runtimes,last_heartbeat_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        'runner_schedulable_codex',
        defaultClaims().organizationId,
        project.id,
        'Codex runner',
        'environment_schedulable_codex',
        'active',
        0,
        1,
        JSON.stringify([{ runtime: 'codex', models: ['gpt-5.6-sol'], state: 'ready' }]),
        now,
        now,
        now,
      ),
      env.DB.prepare(`INSERT INTO triggers (
        id,organization_id,project_id,agent_id,environment_id,trigger_type,runtime,name,prompt_template,enabled,
        inbox_subscription_id,inbox_callback_token_hash,inbox_callback_token_ciphertext,inbox_provisioning_state,
        inbox_registered_agent_subject,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        'trigger_schedulable_codex',
        defaultClaims().organizationId,
        project.id,
        agent.metadata.uid,
        'environment_schedulable_codex',
        'inbox',
        'codex',
        'Downstream Inbox',
        'Handle the notification.',
        1,
        'subscription_schedulable_codex',
        'callback_hash_schedulable_codex',
        'callback_ciphertext_schedulable_codex',
        'active',
        subject,
        now,
        now,
      ),
    ])

    const listRes = await jsonFetch('/api/v1/agents?runtime=codex&schedulable=true', authorization)
    expect(listRes.status).toBe(200)
    await expect(listRes.json()).resolves.toMatchObject({
      data: [{ metadata: { uid: agent.metadata.uid }, status: { schedulable: true } }],
    })
    const otherRuntime = await jsonFetch('/api/v1/agents?runtime=ama', authorization)
    await expect(otherRuntime.json()).resolves.toMatchObject({ data: [] })

    await env.DB.prepare("UPDATE runners SET state = 'offline' WHERE id = ?").bind('runner_schedulable_codex').run()
    const unavailable = await jsonFetch('/api/v1/agents?schedulable=true', authorization)
    await expect(unavailable.json()).resolves.toMatchObject({ data: [] })
    const direct = await jsonFetch(`/api/v1/agents/${agent.metadata.uid}`, authorization)
    await expect(direct.json()).resolves.toMatchObject({ status: { schedulable: false } })
  })

  it('[spec: agents/create-idempotency] replays a bound Agent creation and rejects a changed request', async () => {
    const authorization = await signIn()
    expect((await jsonFetch('/api/v1/agents', authorization)).status).toBe(200)
    const project = await env.DB.prepare('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1').first<{
      id: string
    }>()
    if (!project) throw new Error('Expected project')
    const now = new Date().toISOString()
    const identityId = 'identity_agent_idempotency'
    await env.DB.prepare(`INSERT INTO identities (
      id,project_id,organization_id,name,username,runtime,state,vault_id,credential_id,remote_agent_id,issuer,subject,
      idempotency_key_hash,request_fingerprint,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        identityId,
        project.id,
        defaultClaims().organizationId,
        'Idempotent Identity',
        'idempotent-agent',
        'codex',
        'active',
        'vault_agent_idempotency',
        'credential_agent_idempotency',
        '019ff41a-7da6-708f-8b05-44d4d0373888',
        'https://id.realmroot.dev/api/auth',
        '019ff41a-7da6-708f-8b05-44d4d0373888',
        'hash_agent_idempotency',
        'fingerprint_agent_idempotency',
        now,
        now,
      )
      .run()
    const body = agentBody('Idempotent Agent', { identityRef: identityId })
    const create = () =>
      jsonFetch('/api/v1/agents', authorization, {
        method: 'POST',
        headers: { 'idempotency-key': 'agent-create-idempotency-1' },
        body: JSON.stringify(body),
      })
    const [first, replay] = await Promise.all([create(), create()])
    expect(first.status).toBe(201)
    const firstAgent = (await first.json()) as {
      metadata: {
        uid: string
        name: string
        description: string | null
        createdAt: string
        updatedAt: string
      }
    }
    expect(replay.status).toBe(201)
    await expect(replay.json()).resolves.toMatchObject({ metadata: { uid: firstAgent.metadata.uid } })
    const counts = await env.DB.prepare(
      'SELECT (SELECT count(*) FROM agents WHERE name = ?) AS agents, (SELECT count(*) FROM agent_versions WHERE agent_id = ?) AS versions',
    )
      .bind('Idempotent Agent', firstAgent.metadata.uid)
      .first<{ agents: number; versions: number }>()
    expect(counts).toEqual({ agents: 1, versions: 1 })

    const update = await jsonFetch(`/api/v1/agents/${firstAgent.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({
        metadata: { name: 'Renamed Agent', description: 'Updated description.' },
        spec: { systemPrompt: 'Updated after creation.' },
      }),
    })
    expect(update.status).toBe(200)
    await expect(update.json()).resolves.toMatchObject({
      metadata: { name: 'Renamed Agent', description: 'Updated description.' },
      spec: { systemPrompt: 'Updated after creation.' },
      status: { version: 2 },
    })

    const deleted = await jsonFetch(`/api/v1/agents/${firstAgent.metadata.uid}`, authorization, { method: 'DELETE' })
    expect(deleted.status).toBe(204)

    const postUpdateReplay = await create()
    expect(postUpdateReplay.status).toBe(409)
    await expect(postUpdateReplay.json()).resolves.toMatchObject({ error: { type: 'idempotency_conflict' } })

    const conflict = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      headers: { 'idempotency-key': 'agent-create-idempotency-1' },
      body: JSON.stringify(agentBody('Changed Agent', { identityRef: identityId })),
    })
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ error: { type: 'idempotency_conflict' } })
  })

  it('returns 409 when replacing or removing Identity from an Agent with a live Inbox Trigger [spec: agents/inbox-identity-rebind]', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/agents', authorization, {
      method: 'POST',
      body: JSON.stringify(agentBody('Inbox-bound agent')),
    })
    expect(createRes.status).toBe(201)
    const agent = (await createRes.json()) as { metadata: { uid: string } }
    const project = await env.DB.prepare('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1').first<{
      id: string
    }>()
    if (!project) throw new Error('Expected project')
    const now = '2026-08-31T00:00:00.000Z'
    const insertIdentity = async (id: string, username: string, agentId: string, subject: string) =>
      env.DB.prepare(`INSERT INTO identities (
        id,project_id,organization_id,name,username,runtime,state,vault_id,credential_id,remote_agent_id,issuer,subject,
        idempotency_key_hash,request_fingerprint,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(
          id,
          project.id,
          defaultClaims().organizationId,
          username,
          username,
          'ama',
          'active',
          `vault_${id}`,
          `credential_${id}`,
          agentId,
          'https://id.realmroot.dev/api/auth',
          subject,
          `hash_${id}`,
          `fingerprint_${id}`,
          now,
          now,
        )
        .run()
    await insertIdentity(
      'identity_inbox_a',
      'inbox-a',
      '01a05643-33a4-704f-8d6b-bec364657b5c',
      '01a05643-33a4-704f-8d6b-bec364657b5d',
    )
    await insertIdentity(
      'identity_inbox_b',
      'inbox-b',
      '01a05643-33a4-704f-8d6b-bec364657b5e',
      '01a05643-33a4-704f-8d6b-bec364657b5f',
    )
    const bind = await jsonFetch(`/api/v1/agents/${agent.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { identityRef: 'identity_inbox_a' } }),
    })
    expect(bind.status).toBe(200)
    const versionsBeforeGuard = await env.DB.prepare(
      'SELECT id, version FROM agent_versions WHERE agent_id = ? ORDER BY version ASC',
    )
      .bind(agent.metadata.uid)
      .all<{ id: string; version: number }>()
    await env.DB.prepare(`INSERT INTO triggers (
      id,organization_id,project_id,agent_id,trigger_type,runtime,name,prompt_template,enabled,
      inbox_subscription_id,inbox_callback_token_hash,inbox_callback_token_ciphertext,
      inbox_provisioning_state,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        'trigger_inbox_identity_guard',
        defaultClaims().organizationId,
        project.id,
        agent.metadata.uid,
        'inbox',
        'ama',
        'Inbox guard',
        'Handle the message.',
        1,
        'sub_0123456789abcdef0123456789abcdee',
        'callback-hash',
        'callback-ciphertext',
        'active',
        now,
        now,
      )
      .run()

    for (const identityRef of ['identity_inbox_b', null]) {
      const response = await jsonFetch(`/api/v1/agents/${agent.metadata.uid}`, authorization, {
        method: 'PATCH',
        body: JSON.stringify({ spec: { identityRef } }),
      })
      expect(response.status).toBe(409)
      await expect(response.json()).resolves.toMatchObject({
        error: { message: 'Agent Identity cannot be changed while a live Inbox Trigger exists.' },
      })
    }
    const versionsAfterGuard = await env.DB.prepare(
      'SELECT id, version FROM agent_versions WHERE agent_id = ? ORDER BY version ASC',
    )
      .bind(agent.metadata.uid)
      .all<{ id: string; version: number }>()
    expect(versionsAfterGuard.results).toEqual(versionsBeforeGuard.results)
    const guardedAgent = await env.DB.prepare('SELECT current_version_id FROM agents WHERE id = ?')
      .bind(agent.metadata.uid)
      .first<{ current_version_id: string }>()
    expect(versionsAfterGuard.results.some((version) => version.id === guardedAgent?.current_version_id)).toBe(true)

    const safeUpdate = await jsonFetch(`/api/v1/agents/${agent.metadata.uid}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { systemPrompt: 'Continue using the same Inbox Identity.' } }),
    })
    expect(safeUpdate.status).toBe(200)
    const versionsAfterSafeUpdate = await env.DB.prepare(
      'SELECT version FROM agent_versions WHERE agent_id = ? ORDER BY version ASC',
    )
      .bind(agent.metadata.uid)
      .all<{ version: number }>()
    expect(versionsAfterSafeUpdate.results.map((version) => version.version)).toEqual([1, 2, 3])
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
