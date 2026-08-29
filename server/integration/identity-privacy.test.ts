import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { createVaultRepo } from '@server/adapters/repos/vaults'
import { drizzle } from 'drizzle-orm/d1'
import { beforeEach, describe, expect, it } from 'vitest'
import { dpopHeaders, setupOidcProvider, signIn } from './auth'

async function api(path: string, authorization: string) {
  return SELF.fetch(`https://example.com${path}`, { headers: dpopHeaders(authorization, 'GET', path) })
}

async function currentScope(authorization: string) {
  await api('/api/v1/vaults', authorization)
  const project = await env.DB.prepare(
    'SELECT id, organization_id FROM projects ORDER BY created_at DESC LIMIT 1',
  ).first<{ id: string; organization_id: string }>()
  if (!project) throw new Error('Expected authenticated project')
  return project
}

describe('[CF] Identity privacy boundaries', () => {
  beforeEach(setupOidcProvider)

  it('hides Identity-managed Vaults from public list/find while allowing the internal lookup', async () => {
    const authorization = await signIn()
    const scope = await currentScope(authorization)
    const now = '2026-08-28T00:00:00.000Z'
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO vaults (id,organization_id,project_id,name,scope,managed_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        'vault_public',
        scope.organization_id,
        scope.id,
        'Public',
        'project',
        null,
        now,
        now,
      ),
      env.DB.prepare(`INSERT INTO vaults (id,organization_id,project_id,name,scope,managed_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        'vault_identity',
        scope.organization_id,
        scope.id,
        'Managed Identity',
        'project',
        'identity',
        now,
        now,
      ),
    ])

    const list = await api('/api/v1/vaults', authorization)
    expect(list.status).toBe(200)
    const body = (await list.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(body.data.map((vault) => vault.metadata.uid)).toContain('vault_public')
    expect(body.data.map((vault) => vault.metadata.uid)).not.toContain('vault_identity')
    expect((await api('/api/v1/vaults/vault_identity', authorization)).status).toBe(404)

    const repo = createVaultRepo(drizzle(env.DB))
    await expect(
      repo.find('vault_identity', { organizationId: scope.organization_id, projectId: scope.id }),
    ).resolves.toBeNull()
    await expect(
      repo.findIdentityManaged?.('vault_identity', { organizationId: scope.organization_id, projectId: scope.id }),
    ).resolves.toMatchObject({
      metadata: { uid: 'vault_identity' },
    })
  })

  it('never serializes credentialRef or private Realmroot state from Identity, Agent, or Session responses', async () => {
    const authorization = await signIn()
    const scope = await currentScope(authorization)
    const now = '2026-08-28T00:00:00.000Z'
    const privateRef = 'ama://vaults/vault_identity_private/credentials/cred_private_state'
    const descriptor = {
      identityId: 'identity_1',
      agentId: 'rr_identity_1',
      issuer: 'https://realmroot.example/api/auth',
      subject: 'rr_identity_1',
      username: 'reviewer',
      runtime: 'codex',
      credentialRef: privateRef,
    }
    const snapshot = {
      id: 'agentver_1',
      agentId: 'agent_1',
      projectId: scope.id,
      version: 1,
      systemPrompt: 'Work.',
      provider: 'workers-ai',
      model: null,
      skills: [],
      subagents: [],
      allowedTools: [],
      mcpConnectors: [],
      identity: descriptor,
      createdAt: now,
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO vaults (id,organization_id,project_id,name,scope,managed_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).bind(
        'vault_identity_private',
        scope.organization_id,
        scope.id,
        'Managed Identity',
        'project',
        'identity',
        now,
        now,
      ),
      env.DB.prepare(`INSERT INTO identities (
        id,project_id,organization_id,name,username,runtime,state,vault_id,credential_id,remote_agent_id,issuer,subject,idempotency_key_hash,request_fingerprint,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        'identity_1',
        scope.id,
        scope.organization_id,
        'Reviewer',
        'reviewer',
        'codex',
        'active',
        'vault_identity_private',
        'cred_private_state',
        'rr_identity_1',
        descriptor.issuer,
        descriptor.subject,
        'hash_1',
        'fingerprint_1',
        now,
        now,
      ),
      env.DB.prepare(`INSERT INTO agents (
        id,project_id,name,system_prompt,skills,subagents,allowed_tools,mcp_connectors,identity_id,identity_snapshot,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        'agent_1',
        scope.id,
        'Identity Agent',
        'Work.',
        '[]',
        '[]',
        '[]',
        '[]',
        'identity_1',
        JSON.stringify(descriptor),
        now,
        now,
      ),
      env.DB.prepare(`INSERT INTO sessions (
        id,agent_id,organization_id,agent_snapshot,title,project_id,durable_object_name,state,metadata,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
        'session_1',
        'agent_1',
        scope.organization_id,
        JSON.stringify(snapshot),
        'Private identity session',
        scope.id,
        'do_identity_1',
        'stopped',
        JSON.stringify({ runtime: 'codex', privateStateMarker: 'must-not-cross-http' }),
        now,
        now,
      ),
    ])

    for (const path of ['/api/v1/identities/identity_1', '/api/v1/agents/agent_1', '/api/v1/sessions/session_1']) {
      const response = await api(path, authorization)
      expect(response.status, path).toBe(200)
      const serialized = JSON.stringify(await response.json())
      expect(serialized, path).not.toContain('credentialRef')
      expect(serialized, path).not.toContain('cred_private_state')
      expect(serialized, path).not.toContain('agent_private_key')
      expect(serialized, path).not.toContain('state.json')
      expect(serialized, path).not.toContain('must-not-cross-http')
    }
  })
})
