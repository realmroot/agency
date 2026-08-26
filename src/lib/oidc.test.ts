import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearCachedWebSession,
  completeSignIn,
  getAuthHeaders,
  getCurrentUser,
  getStoredAccessToken,
  signIn,
  signOut,
} from './oidc'

beforeEach(() => {
  window.localStorage.clear()
  clearCachedWebSession()
})

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('browser BFF session client', () => {
  it('exposes only CSRF from the opaque server session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          csrfToken: 'csrf-1',
          user: { id: 'user-1', email: 'user@example.test', name: 'User' },
          organization: { id: 'org-1', name: 'Organization' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(getAuthHeaders()).resolves.toEqual({ 'x-csrf-token': 'csrf-1' })
    await expect(getCurrentUser()).resolves.toMatchObject({
      access_token: '',
      profile: { sub: 'user-1', email: 'user@example.test', org_id: 'org-1' },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/sessions/current', { credentials: 'same-origin' })
  })

  it('returns no browser credential when the server session is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    await expect(getAuthHeaders()).resolves.toEqual({})
    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it('keeps the explicit e2e token isolated from production browser sessions', async () => {
    window.localStorage.setItem('ama:e2e-access-token', 'e2e:run-1')
    await expect(getAuthHeaders()).resolves.toEqual({ authorization: 'Bearer e2e:run-1' })
    expect(getStoredAccessToken()).toBe('e2e:run-1')
    await expect(getCurrentUser()).resolves.toMatchObject({ profile: { sub: 'user_e2e_run-1' } })
  })

  it('starts login through the BFF with a safe return path', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    await signIn('//attacker.example')
    expect(assign).toHaveBeenCalledWith('/api/v1/auth/login?returnTo=%2F')
    await expect(completeSignIn()).resolves.toBe('/')
  })

  it('logs out with CSRF and the same-origin cookie', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            csrfToken: 'csrf-logout',
            user: { id: 'user-1', email: 'user@example.test', name: null },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const assign = vi.fn()
    vi.stubGlobal('location', { assign })
    await signOut()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/auth/sessions/current', {
      method: 'DELETE',
      headers: { 'x-csrf-token': 'csrf-logout' },
      credentials: 'same-origin',
    })
    expect(assign).toHaveBeenCalledWith('/')
  })
})
