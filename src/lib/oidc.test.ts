import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.fn()
const signinRedirect = vi.fn()
const signinRedirectCallback = vi.fn()
const signoutRedirect = vi.fn()

vi.mock('oidc-client-ts', () => ({
  UserManager: class {
    getUser = getUser
    signinRedirect = signinRedirect
    signinRedirectCallback = signinRedirectCallback
    signoutRedirect = signoutRedirect
    removeUser = vi.fn()
  },
  WebStorageStateStore: class {},
}))

async function freshOidc() {
  vi.resetModules()
  return import('./oidc')
}

describe('[spec: auth/resource-token] Realmroot public SPA authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          auth: {
            oidc: {
              issuer: 'https://id.example.com/api/auth',
              resource: 'https://ama.example.com/api',
              browser: { clientId: 'ama-browser', scopes: ['openid', 'agents:read', 'agents:write'] },
            },
          },
        }),
      ),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends the AMA Resource token only in the standard Authorization header', async () => {
    const oidc = await freshOidc()
    const token = 'header.payload.signature'
    window.sessionStorage.setItem(
      'oidc.user:https://id.example.com/api/auth:ama-browser',
      JSON.stringify({ access_token: token, expires_at: Math.floor(Date.now() / 1000) + 300 }),
    )
    getUser.mockResolvedValue({ expired: false, access_token: token })
    await expect(oidc.getAuthHeaders()).resolves.toEqual({ authorization: `Bearer ${token}` })
  })

  it('uses authorization code with PKCE through the public SPA manager', async () => {
    const oidc = await freshOidc()
    await oidc.signIn('/agents')
    expect(signinRedirect).toHaveBeenCalledWith({ state: { returnTo: '/agents' } })
  })

  it('completes the callback and restores only a safe local return path', async () => {
    const oidc = await freshOidc()
    signinRedirectCallback.mockResolvedValue({ state: { returnTo: '/agents' } })
    await expect(oidc.completeSignIn()).resolves.toBe('/agents')
  })
})
