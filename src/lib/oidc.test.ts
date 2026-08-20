import type { User } from 'oidc-client-ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Shared mock functions — these are closed over by the class below and captured
// at module-evaluation time, so they survive vi.clearAllMocks() (which only
// clears call history, not the function reference).
const mockGetUser = vi.fn()
const mockSigninRedirect = vi.fn()
const mockSigninRedirectCallback = vi.fn()
const mockSignoutRedirect = vi.fn()
const mockUserManagerConstructor = vi.fn()
const mockRemoveUser = vi.fn()
const jwtAccessToken = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature'

vi.mock('oidc-client-ts', () => {
  // Must be a real class (constructor) — vi.fn() arrow fns are not constructors.
  class UserManagerMock {
    constructor(settings: unknown) {
      mockUserManagerConstructor(settings)
    }

    getUser = mockGetUser
    signinRedirect = mockSigninRedirect
    signinRedirectCallback = mockSigninRedirectCallback
    signoutRedirect = mockSignoutRedirect
    removeUser = mockRemoveUser
  }

  return {
    UserManager: UserManagerMock,
    WebStorageStateStore: class {},
    IndexedDbDPoPStore: class {},
  }
})

// Helper: import a fresh copy of the oidc module (clears module-level singletons).
// The vi.mock factory above is hoisted and stays registered across resets.
async function freshOidc() {
  vi.resetModules()
  return import('./oidc')
}

function configzResponse(
  body = {
    version: 1,
    service: { name: 'Any Managed Agents', origin: window.location.origin },
    auth: {
      oidc: {
        issuer: 'https://auth.example.com',
        resource: window.location.origin,
        browser: { clientId: 'test-client-id', scopes: ['openid', 'email', 'profile'] },
        runner: null,
      },
    },
  } as {
    version: number
    service: { name: string; origin: string }
    auth: {
      oidc: {
        issuer: string
        resource: string
        browser: { clientId: string; scopes: string[] }
        runner: { clientId: string; scopes: string[] } | null
      }
    }
  },
) {
  return new Response(JSON.stringify(body), { status: 200 })
}

function configzFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/v1/configz') {
      return configzResponse()
    }
    return new Response(JSON.stringify({}), { status: 200 })
  })
}

describe('oidc helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.stubGlobal('fetch', configzFetch())
  })

  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  // ---------------------------------------------------------------------------
  // getStoredAccessToken — no singleton involved; use a single module import.
  // ---------------------------------------------------------------------------
  describe('getStoredAccessToken', () => {
    it('returns the e2e token when ama:e2e-access-token is set', async () => {
      const { getStoredAccessToken } = await freshOidc()
      window.localStorage.setItem('ama:e2e-access-token', 'e2e:myrun')
      expect(getStoredAccessToken()).toBe('e2e:myrun')
    })

    it('returns null when browser auth storage is empty', async () => {
      const { getStoredAccessToken } = await freshOidc()
      expect(getStoredAccessToken()).toBeNull()
    })

    it('returns token from oidc.user: key when not expired', async () => {
      const { getStoredAccessToken } = await freshOidc()
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600
      window.sessionStorage.setItem(
        'oidc.user:https://auth.example.com:test-client-id',
        JSON.stringify({ access_token: jwtAccessToken, expires_at: futureExpiry }),
      )
      expect(getStoredAccessToken()).toBe(jwtAccessToken)
    })

    it('does not return opaque oidc access tokens', async () => {
      const { getStoredAccessToken } = await freshOidc()
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600
      window.sessionStorage.setItem(
        'oidc.user:https://auth.example.com:test-client-id',
        JSON.stringify({ access_token: 'opaque_token_abc', expires_at: futureExpiry }),
      )
      expect(getStoredAccessToken()).toBeNull()
      expect(window.sessionStorage.getItem('oidc.user:https://auth.example.com:test-client-id')).toBeNull()
    })

    it('returns null when oidc token is expired', async () => {
      const { getStoredAccessToken } = await freshOidc()
      const pastExpiry = Math.floor(Date.now() / 1000) - 1
      window.sessionStorage.setItem(
        'oidc.user:https://auth.example.com:test-client-id',
        JSON.stringify({ access_token: 'expired_token', expires_at: pastExpiry }),
      )
      expect(getStoredAccessToken()).toBeNull()
    })

    it('returns token when oidc entry has no expires_at', async () => {
      const { getStoredAccessToken } = await freshOidc()
      window.sessionStorage.setItem(
        'oidc.user:https://auth.example.com:test-client-id',
        JSON.stringify({ access_token: jwtAccessToken }),
      )
      expect(getStoredAccessToken()).toBe(jwtAccessToken)
    })

    it('skips keys that do not start with oidc.user:', async () => {
      const { getStoredAccessToken } = await freshOidc()
      window.sessionStorage.setItem('other:key', JSON.stringify({ access_token: 'should_not_return' }))
      expect(getStoredAccessToken()).toBeNull()
    })

    it('handles malformed JSON in oidc.user: key gracefully', async () => {
      const { getStoredAccessToken } = await freshOidc()
      window.sessionStorage.setItem('oidc.user:https://auth.example.com:test-client-id', 'not-json{')
      expect(getStoredAccessToken()).toBeNull()
    })

    it('does not accept a production oidc.user token persisted in localStorage', async () => {
      const { getStoredAccessToken } = await freshOidc()
      window.localStorage.setItem(
        'oidc.user:https://auth.example.com:test-client-id',
        JSON.stringify({ access_token: jwtAccessToken, expires_at: Math.floor(Date.now() / 1000) + 3600 }),
      )
      expect(getStoredAccessToken()).toBeNull()
    })
  })

  describe('getAuthHeaders', () => {
    it('uses Bearer for the test-gated Console token', async () => {
      const { getAuthHeaders } = await freshOidc()
      window.localStorage.setItem('ama:e2e-access-token', 'e2e:proof-test')
      await expect(getAuthHeaders()).resolves.toEqual({ authorization: 'Bearer e2e:proof-test' })
    })

    it('uses Bearer for the matching signed Console access token', async () => {
      const { getAuthHeaders } = await freshOidc()
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600
      window.sessionStorage.setItem(
        'oidc.user:https://auth.example.com:test-client-id',
        JSON.stringify({ access_token: jwtAccessToken, expires_at: futureExpiry }),
      )
      const user = { expired: false, access_token: jwtAccessToken } as User
      mockGetUser.mockResolvedValueOnce(user)
      await expect(getAuthHeaders()).resolves.toEqual({ authorization: `Bearer ${jwtAccessToken}` })
    })
  })

  // ---------------------------------------------------------------------------
  // getCurrentUser
  // ---------------------------------------------------------------------------
  describe('getCurrentUser', () => {
    it('returns a synthetic user when ama:e2e-access-token is set', async () => {
      const { getCurrentUser } = await freshOidc()
      window.localStorage.setItem('ama:e2e-access-token', 'e2e:myrunid')
      const user = await getCurrentUser()
      expect(user).toBeTruthy()
      expect((user as User).access_token).toBe('e2e:myrunid')
      expect((user as User).profile.sub).toBe('user_e2e_myrunid')
    })

    it('builds safe run id from e2e token with special chars', async () => {
      const { getCurrentUser } = await freshOidc()
      window.localStorage.setItem('ama:e2e-access-token', 'e2e:api-test/run 1')
      const user = await getCurrentUser()
      expect(user).toBeTruthy()
      expect((user as User).profile.sub).toBe('user_e2e_api-test_run_1')
    })

    it('falls back to "run" when token part is empty after slicing e2e: prefix', async () => {
      const { getCurrentUser } = await freshOidc()
      window.localStorage.setItem('ama:e2e-access-token', 'e2e:')
      const user = await getCurrentUser()
      expect(user).toBeTruthy()
      expect((user as User).profile.sub).toBe('user_e2e_run')
    })

    it('token without e2e: prefix falls back to "run" for runId', async () => {
      const { getCurrentUser } = await freshOidc()
      window.localStorage.setItem('ama:e2e-access-token', 'plain-token')
      const user = await getCurrentUser()
      expect(user).toBeTruthy()
      // When the token does not start with "e2e:", runId is set to the literal "run".
      expect((user as User).profile.sub).toBe('user_e2e_run')
    })

    it('returns null when manager returns null and there is no e2e token', async () => {
      const { getCurrentUser } = await freshOidc()
      mockGetUser.mockResolvedValueOnce(null)
      const user = await getCurrentUser()
      expect(user).toBeNull()
    })

    it('returns null when user is expired and there is no e2e token', async () => {
      const { getCurrentUser } = await freshOidc()
      mockGetUser.mockResolvedValueOnce({ expired: true, access_token: 'stale' })
      const user = await getCurrentUser()
      expect(user).toBeNull()
    })

    it('returns the real user when manager returns a valid, non-expired user', async () => {
      const { getCurrentUser } = await freshOidc()
      const fakeUser = { expired: false, access_token: jwtAccessToken } as unknown as User
      mockGetUser.mockResolvedValueOnce(fakeUser)
      const user = await getCurrentUser()
      expect(user).toBe(fakeUser)
    })

    it('removes current oidc user and returns null for opaque access tokens', async () => {
      const { getCurrentUser } = await freshOidc()
      mockGetUser.mockResolvedValueOnce({ expired: false, access_token: 'opaque_token' })
      const user = await getCurrentUser()
      expect(user).toBeNull()
      expect(mockRemoveUser).toHaveBeenCalled()
    })
  })

  // ---------------------------------------------------------------------------
  // signIn
  // ---------------------------------------------------------------------------
  describe('signIn', () => {
    it('calls signinRedirect with the returnTo state', async () => {
      const { signIn } = await freshOidc()
      mockSigninRedirect.mockResolvedValueOnce(undefined)
      await signIn('/dashboard')
      expect(mockSigninRedirect).toHaveBeenCalledWith({ state: { returnTo: '/dashboard' } })
    })
  })

  // ---------------------------------------------------------------------------
  // completeSignIn
  // ---------------------------------------------------------------------------
  describe('completeSignIn', () => {
    it('stores the callback user locally and returns returnTo path without creating a server session', async () => {
      const { completeSignIn } = await freshOidc()
      const fakeUser = {
        access_token: 'callback_token',
        state: { returnTo: '/my-app' },
      } as unknown as User
      mockSigninRedirectCallback.mockResolvedValueOnce(fakeUser)

      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/v1/configz') {
          return configzResponse()
        }
        return new Response(JSON.stringify({}), { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await completeSignIn()
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/configz')
      expect(fetchMock).not.toHaveBeenCalledWith('/api/v1/auth/sessions', expect.anything())
      expect(result).toBe('/my-app')
    })

    it('returns "/" when returnTo is an absolute URL', async () => {
      const { completeSignIn } = await freshOidc()
      const fakeUser = {
        access_token: 'token',
        state: { returnTo: 'https://evil.example.com' },
      } as unknown as User
      mockSigninRedirectCallback.mockResolvedValueOnce(fakeUser)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === '/api/v1/configz') {
            return configzResponse()
          }
          return new Response(JSON.stringify({}), { status: 200 })
        }),
      )
      const result = await completeSignIn()
      expect(result).toBe('/')
    })

    it('returns "/" when state has no returnTo', async () => {
      const { completeSignIn } = await freshOidc()
      const fakeUser = { access_token: 'token', state: undefined } as unknown as User
      mockSigninRedirectCallback.mockResolvedValueOnce(fakeUser)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === '/api/v1/configz') {
            return configzResponse()
          }
          return new Response(JSON.stringify({}), { status: 200 })
        }),
      )
      const result = await completeSignIn()
      expect(result).toBe('/')
    })

    it('returns "/" when returnTo starts with //', async () => {
      const { completeSignIn } = await freshOidc()
      const fakeUser = {
        access_token: 'token',
        state: { returnTo: '//evil.com' },
      } as unknown as User
      mockSigninRedirectCallback.mockResolvedValueOnce(fakeUser)
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input) === '/api/v1/configz') {
            return configzResponse()
          }
          return new Response(JSON.stringify({}), { status: 200 })
        }),
      )
      const result = await completeSignIn()
      expect(result).toBe('/')
    })
  })

  // ---------------------------------------------------------------------------
  // getOidcManager — config validation guard
  // ---------------------------------------------------------------------------
  describe('getOidcManager', () => {
    it('uses configured OIDC resource when provided', async () => {
      vi.resetModules()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          configzResponse({
            version: 1,
            service: { name: 'Any Managed Agents', origin: 'https://ama.example.com' },
            auth: {
              oidc: {
                issuer: 'https://auth.example.com',
                resource: 'https://ama.example.com',
                browser: { clientId: 'cid', scopes: ['openid'] },
                runner: null,
              },
            },
          }),
        ),
      )
      const { getOidcManager } = await import('./oidc')
      await getOidcManager()
      expect(mockUserManagerConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ resource: 'https://ama.example.com' }),
      )
    })

    it('throws when OIDC config has no authority', async () => {
      vi.resetModules()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          configzResponse({
            version: 1,
            service: { name: 'Any Managed Agents', origin: window.location.origin },
            auth: {
              oidc: {
                issuer: '',
                resource: window.location.origin,
                browser: { clientId: 'cid', scopes: ['openid'] },
                runner: null,
              },
            },
          }),
        ),
      )
      const { getOidcManager } = await import('./oidc')
      await expect(getOidcManager()).rejects.toThrow('OIDC browser configuration is missing')
    })

    it('throws when OIDC config has no clientId', async () => {
      vi.resetModules()
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          configzResponse({
            version: 1,
            service: { name: 'Any Managed Agents', origin: window.location.origin },
            auth: {
              oidc: {
                issuer: 'https://auth.example.com',
                resource: window.location.origin,
                browser: { clientId: '', scopes: ['openid'] },
                runner: null,
              },
            },
          }),
        ),
      )
      const { getOidcManager } = await import('./oidc')
      await expect(getOidcManager()).rejects.toThrow('OIDC browser configuration is missing')
    })
  })

  // ---------------------------------------------------------------------------
  // getCurrentUser — toStorageString is callable on the synthetic user
  // ---------------------------------------------------------------------------
  describe('getCurrentUser toStorageString', () => {
    it('synthetic e2e user toStorageString returns empty string', async () => {
      const { getCurrentUser } = await freshOidc()
      window.localStorage.setItem('ama:e2e-access-token', 'e2e:ts-test')
      const user = await getCurrentUser()
      expect((user as User).toStorageString()).toBe('')
    })
  })

  // ---------------------------------------------------------------------------
  // signOut
  // ---------------------------------------------------------------------------
  describe('signOut', () => {
    it('removes e2e token from localStorage and calls signoutRedirect', async () => {
      const { signOut } = await freshOidc()
      window.localStorage.setItem('ama:e2e-access-token', 'e2e:should-be-removed')
      mockSignoutRedirect.mockResolvedValueOnce(undefined)
      await signOut()
      expect(window.localStorage.getItem('ama:e2e-access-token')).toBeNull()
      expect(mockSignoutRedirect).toHaveBeenCalled()
    })
  })
})
