import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { Env } from '../env'
import { requireAuthIdentity } from './session'

describe('[spec: auth/oidc-claims] synthesized personal E2E authorization', () => {
  it('preserves the normalized Realmroot issuer in AuthContext', async () => {
    const app = new Hono<{ Bindings: Env }>()
    app.get('/auth-context', async (c) => {
      const auth = await requireAuthIdentity(c)
      return auth instanceof Response ? auth : c.json(auth)
    })

    const response = await app.request(
      'https://enbor.example.com/auth-context',
      { headers: { authorization: 'Bearer e2e:user_issuer;personal=1' } },
      {
        RUNTIME_MODE: 'test',
        E2E_TEST_AUTH: 'true',
        OIDC_ISSUER: 'https://realmroot.example/api/auth/',
        OIDC_CLIENT_ID: 'enbor',
        OIDC_RESOURCE: 'https://enbor.example.com',
      } as Env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      organization: { id: 'user:user_e2e_user_issuer', name: 'Personal workspace' },
      oidc: {
        subject: 'user_e2e_user_issuer',
        issuer: 'https://realmroot.example/api/auth',
      },
    })
  })
})
