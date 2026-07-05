import { SELF } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupOidcProvider, signIn } from './auth'

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

describe('[CF] /api/v1/vaults', () => {
  beforeEach(async () => {
    await setupOidcProvider()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires authentication before creating vault metadata', async () => {
    const res = await SELF.fetch('https://example.com/api/v1/vaults', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ metadata: { name: 'Provider credentials' }, spec: {} }),
    })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({
      error: {
        type: 'authentication_required',
        message: 'Authentication required',
      },
    })
  })

  it('creates, lists, reads, updates, and archives project-scoped vaults [spec: vaults/api-crud]', async () => {
    const authorization = await signIn()
    const createRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({
        metadata: { name: 'Provider credentials', description: 'Runtime credential metadata' },
        spec: { scope: 'project' },
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as {
      metadata: { uid: string; name: string; archivedAt: string | null }
      spec: { scope: string }
      status: { phase: string }
    }
    const createdId = created.metadata.uid
    expect(created).toMatchObject({
      metadata: { archivedAt: null },
      spec: { scope: 'project' },
      status: { phase: 'active' },
    })
    expect(created).not.toHaveProperty('organizationId')

    const readRes = await jsonFetch(`/api/v1/vaults/${createdId}`, authorization)
    expect(readRes.status).toBe(200)
    await expect(readRes.json()).resolves.toMatchObject({ metadata: { uid: createdId, name: 'Provider credentials' } })

    const updateRes = await jsonFetch(`/api/v1/vaults/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ metadata: { name: 'Updated credentials' } }),
    })
    expect(updateRes.status).toBe(200)
    await expect(updateRes.json()).resolves.toMatchObject({ metadata: { uid: createdId, name: 'Updated credentials' } })

    const archiveRes = await jsonFetch(`/api/v1/vaults/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true }),
    })
    expect(archiveRes.status).toBe(200)
    await expect(archiveRes.json()).resolves.toMatchObject({
      metadata: { uid: createdId, archivedAt: expect.any(String) },
    })

    const deleteRes = await jsonFetch(`/api/v1/vaults/${createdId}`, authorization, { method: 'DELETE' })
    expect(deleteRes.status).toBe(404)

    const defaultListRes = await jsonFetch('/api/v1/vaults', authorization)
    const defaultList = (await defaultListRes.json()) as { data: Array<{ metadata: { uid: string } }> }
    expect(defaultList.data).not.toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ uid: createdId }) }),
    )

    const archivedListRes = await jsonFetch('/api/v1/vaults?archived=true', authorization)
    const archivedList = (await archivedListRes.json()) as {
      data: Array<{ metadata: { uid: string; archivedAt: string | null } }>
    }
    expect(archivedList.data).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ uid: createdId, archivedAt: expect.any(String) }),
      }),
    )

    const createCredentialRes = await jsonFetch(`/api/v1/vaults/${createdId}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Archived vault token',
        type: 'opaque',
        secret: { stringData: { value: 'raw-secret-for-archived-vault' } },
      }),
    })
    expect(createCredentialRes.status).toBe(409)
    await expect(createCredentialRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Vault is archived' },
    })

    const restoreRes = await jsonFetch(`/api/v1/vaults/${createdId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ archived: false }),
    })
    expect(restoreRes.status).toBe(200)
    await expect(restoreRes.json()).resolves.toMatchObject({ metadata: { uid: createdId, archivedAt: null } })
  })

  it('stores credential secret references only, redacts every response, updates secrets, and exposes read-only versions', async () => {
    const rawSecret = 'raw-secret-material'
    const rotatedSecret = 'rotated-secret-material'
    const thirdSecret = 'third-secret-material'
    const authorization = await signIn()
    const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({ metadata: { name: 'Provider credentials' }, spec: {} }),
    })
    const vault = (await vaultRes.json()) as { metadata: { uid: string } }
    const vaultId = vault.metadata.uid

    const createCredentialRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Workers AI token',
        type: 'opaque',
        secret: { stringData: { value: rawSecret } },
      }),
    })
    expect(createCredentialRes.status).toBe(201)
    const credential = (await createCredentialRes.json()) as {
      metadata: { uid: string }
      status: {
        phase: string
        activeVersionId: string
        activeVersion: {
          metadata: { uid: string }
          spec: { version: number; secretRef: string; hasSecret: boolean }
          status: { phase: string }
        }
      }
    }
    const credentialId = credential.metadata.uid
    const firstVersionId = credential.status.activeVersion.metadata.uid
    expect(credential.status.phase).toBe('active')
    expect(credential.status.activeVersion.spec.version).toBe(1)
    expect(credential.status.activeVersion.status.phase).toBe('active')
    expect(credential.status.activeVersion.spec.hasSecret).toBe(true)
    expect(credential.status.activeVersion).not.toHaveProperty('deletedAt')
    expect(JSON.stringify(credential)).not.toContain(rawSecret)

    const readCredentialRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials/${credentialId}`, authorization)
    expect(readCredentialRes.status).toBe(200)
    expect(JSON.stringify(await readCredentialRes.clone().json())).not.toContain(rawSecret)

    const listCredentialsRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials`, authorization)
    expect(listCredentialsRes.status).toBe(200)
    expect(JSON.stringify(await listCredentialsRes.clone().json())).not.toContain(rawSecret)

    const scopeChangeRes = await jsonFetch(`/api/v1/vaults/${vaultId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ spec: { scope: 'organization' } }),
    })
    expect(scopeChangeRes.status).toBe(409)
    await expect(scopeChangeRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Vault scope cannot change after credentials exist' },
    })

    const dbRows = await env.DB.prepare(
      'SELECT vault_credentials.id, vault_credentials.metadata, vault_credential_versions.secret_ref, vault_credential_versions.reference_name, vault_credential_versions.metadata AS version_metadata FROM vault_credentials JOIN vault_credential_versions ON vault_credentials.id = vault_credential_versions.credential_id',
    ).all()
    expect(JSON.stringify(dbRows.results)).not.toContain(rawSecret)

    const invalidCredentialRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Invalid token',
        type: 'opaque',
        secret: {},
      }),
    })
    expect(invalidCredentialRes.status).toBe(400)
    const credentialCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM vault_credentials WHERE vault_id = ?')
      .bind(vaultId)
      .first<{ count: number }>()
    expect(credentialCount?.count).toBe(1)

    const updateSecretRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials/${credentialId}`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ stringData: { value: rotatedSecret } }),
    })
    expect(updateSecretRes.status).toBe(200)
    const rotated = (await updateSecretRes.json()) as {
      status: {
        activeVersionId: string
        activeVersion: { metadata: { uid: string }; spec: { version: number }; status: { phase: string } }
      }
    }
    expect(rotated.status.activeVersion.spec.version).toBe(2)
    expect(JSON.stringify(rotated)).not.toContain(rotatedSecret)

    const versionsAfterRotateRes = await jsonFetch(
      `/api/v1/vaults/${vaultId}/credentials/${credentialId}/versions`,
      authorization,
    )
    const versionsAfterRotate = (await versionsAfterRotateRes.json()) as {
      data: Array<{ metadata: { uid: string }; status: { phase: string; supersededAt: string | null } }>
    }
    expect(versionsAfterRotate.data).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ uid: firstVersionId }),
        status: expect.objectContaining({ phase: 'superseded', supersededAt: expect.any(String) }),
      }),
    )

    const versionItemRes = await jsonFetch(
      `/api/v1/vaults/${vaultId}/credentials/${credentialId}/versions/${firstVersionId}`,
      authorization,
    )
    expect(versionItemRes.status).toBe(200)
    await expect(versionItemRes.json()).resolves.toMatchObject({
      metadata: { uid: firstVersionId },
      spec: { credentialId },
      status: { phase: 'superseded' },
    })

    const thirdUpdateRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials/${credentialId}`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ stringData: { value: thirdSecret } }),
    })
    expect(thirdUpdateRes.status).toBe(200)
    const thirdRotated = (await thirdUpdateRes.json()) as {
      status: { activeVersion: { metadata: { uid: string } } }
    }
    const thirdVersionId = thirdRotated.status.activeVersion.metadata.uid
    expect(JSON.stringify(thirdRotated)).not.toContain(thirdSecret)

    const versionsRes = await SELF.fetch(
      `https://example.com/api/v1/vaults/${vaultId}/credentials/${credentialId}/versions`,
    )
    expect(versionsRes.status).toBe(401)
    const authenticatedVersionsRes = await jsonFetch(
      `/api/v1/vaults/${vaultId}/credentials/${credentialId}/versions`,
      authorization,
    )
    const versions = (await authenticatedVersionsRes.json()) as {
      data: Array<{ metadata: { uid: string }; status: { phase: string } }>
    }
    expect(JSON.stringify(versions)).not.toContain(rawSecret)
    expect(JSON.stringify(versions)).not.toContain(rotatedSecret)
    expect(JSON.stringify(versions)).not.toContain(thirdSecret)

    const rotatedDbRows = await env.DB.prepare(
      'SELECT provider, secret_ref, reference_name, metadata FROM vault_credential_versions',
    ).all()
    expect(JSON.stringify(rotatedDbRows.results)).not.toContain(rawSecret)
    expect(JSON.stringify(rotatedDbRows.results)).not.toContain(rotatedSecret)
    expect(JSON.stringify(rotatedDbRows.results)).not.toContain(thirdSecret)

    const revokeRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials/${credentialId}`, authorization, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'revoked', revokeReason: 'Replaced by provider binding' }),
    })
    expect(revokeRes.status).toBe(200)
    await expect(revokeRes.json()).resolves.toMatchObject({
      metadata: { uid: credentialId },
      status: {
        phase: 'revoked',
        activeVersionId: null,
        activeVersion: null,
        revokeReason: 'Replaced by provider binding',
      },
    })
    const versionsAfterRevokeRes = await jsonFetch(
      `/api/v1/vaults/${vaultId}/credentials/${credentialId}/versions`,
      authorization,
    )
    const versionsAfterRevoke = (await versionsAfterRevokeRes.json()) as {
      data: Array<{ metadata: { uid: string }; status: { phase: string; revokedAt: string | null } }>
    }
    expect(versionsAfterRevoke.data).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ uid: thirdVersionId }),
        status: expect.objectContaining({ phase: 'revoked', revokedAt: expect.any(String) }),
      }),
    )

    const revokedListRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials?state=revoked`, authorization)
    expect(revokedListRes.status).toBe(200)
    await expect(revokedListRes.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          metadata: expect.objectContaining({ uid: credentialId }),
          status: expect.objectContaining({ phase: 'revoked' }),
        }),
      ],
    })

    const rotateRevokedRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials/${credentialId}`, authorization, {
      method: 'PUT',
      body: JSON.stringify({ stringData: { value: 'after-revoke' } }),
    })
    expect(rotateRevokedRes.status).toBe(409)
    await expect(rotateRevokedRes.json()).resolves.toMatchObject({
      error: { type: 'conflict', message: 'Credential is not active' },
    })
  })

  it('validates credential types and returns only safe data key metadata', async () => {
    const authorization = await signIn()
    const vaultRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({ metadata: { name: `Typed credentials ${crypto.randomUUID()}` }, spec: {} }),
    })
    expect(vaultRes.status).toBe(201)
    const vault = (await vaultRes.json()) as { metadata: { uid: string } }
    const vaultId = vault.metadata.uid
    const cases = [
      {
        name: 'basic-auth',
        type: 'ama.dev/basic-auth',
        stringData: { username: 'service-user', password: 'service-password' },
        dataKeys: ['password', 'username'],
        raw: 'service-password',
      },
      {
        name: 'ssh-auth',
        type: 'ama.dev/ssh-auth',
        stringData: { 'ssh-privatekey': '-----BEGIN OPENSSH PRIVATE KEY-----' },
        dataKeys: ['ssh-privatekey'],
        raw: '-----BEGIN OPENSSH PRIVATE KEY-----',
      },
      {
        name: 'tls',
        type: 'ama.dev/tls',
        stringData: { 'tls.crt': '-----BEGIN CERTIFICATE-----', 'tls.key': '-----BEGIN PRIVATE KEY-----' },
        dataKeys: ['tls.crt', 'tls.key'],
        raw: '-----BEGIN PRIVATE KEY-----',
      },
      {
        name: 'oauth-token',
        type: 'ama.dev/oauth-token',
        stringData: { 'access-token': 'oauth-access-token', 'refresh-token': 'oauth-refresh-token' },
        dataKeys: ['access-token', 'refresh-token'],
        raw: 'oauth-access-token',
      },
      {
        name: 'private-key-jwk',
        type: 'ama.dev/private-key-jwk',
        stringData: { jwk: '{"kty":"OKP","crv":"Ed25519","x":"public","d":"jwk-secret-material"}' },
        dataKeys: ['jwk'],
        raw: 'jwk-secret-material',
      },
    ] as const

    for (const item of cases) {
      const credentialRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials`, authorization, {
        method: 'POST',
        body: JSON.stringify({
          name: item.name,
          type: item.type,
          secret: { stringData: item.stringData },
        }),
      })
      expect(credentialRes.status).toBe(201)
      const body = (await credentialRes.json()) as {
        spec: { type: string }
        status: { activeVersion: { spec: { dataKeys: string[]; metadata: Record<string, unknown> } } }
      }
      expect(body.spec.type).toBe(item.type)
      expect(body.status.activeVersion.spec.dataKeys).toEqual(item.dataKeys)
      expect(body.status.activeVersion.spec.metadata).toEqual({ dataKeys: item.dataKeys })
      expect(JSON.stringify(body)).not.toContain(item.raw)
    }

    const missingRequiredRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'bad-basic-auth',
        type: 'ama.dev/basic-auth',
        secret: { stringData: { username: 'service-user' } },
      }),
    })
    expect(missingRequiredRes.status).toBe(400)
    await expect(missingRequiredRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { secret: expect.stringContaining('password') } } },
    })

    const extraKeyRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'bad-tls',
        type: 'ama.dev/tls',
        secret: { stringData: { 'tls.crt': 'crt', 'tls.key': 'key', token: 'not-allowed' } },
      }),
    })
    expect(extraKeyRes.status).toBe(400)
    await expect(extraKeyRes.json()).resolves.toMatchObject({
      error: { type: 'validation_error', details: { fields: { secret: expect.stringContaining('token') } } },
    })

    const nonStringRes = await jsonFetch(`/api/v1/vaults/${vaultId}/credentials`, authorization, {
      method: 'POST',
      body: JSON.stringify({
        name: 'bad-string-data',
        type: 'opaque',
        secret: { stringData: { enabled: true } },
      }),
    })
    expect(nonStringRes.status).toBe(400)
  })

  it('isolates project vaults inside the same organization and shares organization-scoped vaults [spec: vaults/api-tenancy]', async () => {
    const authorization = await signIn()
    const projectVaultRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({ metadata: { name: 'Project vault' }, spec: { scope: 'project' } }),
    })
    const projectVault = (await projectVaultRes.json()) as { metadata: { uid: string } }
    const projectVaultId = projectVault.metadata.uid
    const orgVaultRes = await jsonFetch('/api/v1/vaults', authorization, {
      method: 'POST',
      body: JSON.stringify({ metadata: { name: 'Organization vault' }, spec: { scope: 'organization' } }),
    })
    const orgVault = (await orgVaultRes.json()) as { metadata: { uid: string } }
    const orgVaultId = orgVault.metadata.uid

    const vaultRow = await env.DB.prepare('SELECT organization_id FROM vaults WHERE id = ?')
      .bind(projectVaultId)
      .first<{ organization_id: string }>()
    expect(vaultRow?.organization_id).toBeTruthy()

    const alternateProjectId = `project_${crypto.randomUUID().replaceAll('-', '')}`
    await env.DB.prepare(
      'INSERT INTO projects (id, organization_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(
        alternateProjectId,
        vaultRow?.organization_id,
        'Alternate Project',
        new Date().toISOString(),
        new Date().toISOString(),
      )
      .run()
    const projectReadRes = await jsonFetch(`/api/v1/vaults/${projectVaultId}`, authorization, {
      headers: { 'x-ama-project-id': alternateProjectId },
    })
    expect(projectReadRes.status).toBe(404)

    const orgReadRes = await jsonFetch(`/api/v1/vaults/${orgVaultId}`, authorization, {
      headers: { 'x-ama-project-id': alternateProjectId },
    })
    expect(orgReadRes.status).toBe(200)
    await expect(orgReadRes.json()).resolves.toMatchObject({
      metadata: { uid: orgVaultId },
      spec: { scope: 'organization' },
    })
  })
})
