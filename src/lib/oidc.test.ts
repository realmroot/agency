import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthHeaders, getCurrentUser, signIn, signOut } from './oidc'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('server-owned browser authentication', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('uses no browser-readable credential for a cookie session', async () => {
    await expect(getAuthHeaders()).resolves.toEqual({})
  })

  it('keeps the explicit e2e Bearer credential isolated from production browser sessions', async () => {
    window.localStorage.setItem('ama:e2e-access-token', 'e2e:proof-test')

    await expect(getAuthHeaders()).resolves.toEqual({ authorization: 'Bearer e2e:proof-test' })
  })

  it('reads the current user from the opaque cookie session endpoint', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        user: { id: 'user_1', email: 'owner@example.com', name: 'Owner' },
        organization: { id: 'org_1', name: 'Acme' },
        project: { id: 'project_1', name: 'Control Plane' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getCurrentUser()).resolves.toEqual({
      profile: {
        sub: 'user_1',
        email: 'owner@example.com',
        name: 'Owner',
      },
      organization: { id: 'org_1', name: 'Acme' },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/sessions/current', {
      headers: { accept: 'application/json' },
    })
  })

  it('returns no current user when the cookie session is absent or expired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { type: 'authentication_required' } }, 401)),
    )

    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it('surfaces an unexpected current-session failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { type: 'unavailable' } }, 503)),
    )

    await expect(getCurrentUser()).rejects.toThrow('Failed to read browser session')
  })

  it('starts server-owned authorization with the requested return path', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ authorizationUrl: `${window.location.href}#oidc-redirect-placeholder` }, 201),
    )
    vi.stubGlobal('fetch', fetchMock)

    await signIn('/agents?status=active')

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/authorization-attempts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo: '/agents?status=active' }),
    })
  })

  it('does not navigate when authorization attempt creation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { type: 'unavailable' } }, 503)),
    )

    await expect(signIn('/agents')).rejects.toThrow('Failed to start sign-in')
  })

  it('logs out through the server session endpoint and clears the e2e credential', async () => {
    window.localStorage.setItem('ama:e2e-access-token', 'e2e:logout')
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await signOut()

    expect(window.localStorage.getItem('ama:e2e-access-token')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/sessions/current', { method: 'DELETE' })
  })

  it('surfaces logout failure after clearing the e2e credential', async () => {
    window.localStorage.setItem('ama:e2e-access-token', 'e2e:logout-failure')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { type: 'forbidden' } }, 403)),
    )

    await expect(signOut()).rejects.toThrow('Failed to sign out')
    expect(window.localStorage.getItem('ama:e2e-access-token')).toBeNull()
  })
})
