import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import type { Env } from './env'

describe('app error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs unhandled API errors with a request id and returns that id to the caller', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await createApp().fetch(
      new Request('https://example.test/api/v1/projects', {
        headers: {
          authorization: 'Bearer e2e:logging_error',
          'x-request-id': 'req_logging_error',
          'x-ama-project-id': 'project_logging',
        },
      }),
      { AMA_RUNTIME_MODE: 'test', AMA_E2E_TEST_AUTH: 'true', OIDC_CLIENT_ID: 'ama-test' } as Env,
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('x-request-id')).toBe('req_logging_error')
    await expect(response.json()).resolves.toEqual({
      error: {
        type: 'internal_error',
        message: 'Internal server error',
        details: { requestId: 'req_logging_error' },
      },
    })

    expect(spy).toHaveBeenCalledOnce()
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(payload).toMatchObject({
      level: 'error',
      event: 'http.request.failed',
      requestId: 'req_logging_error',
      method: 'GET',
      path: '/api/v1/projects',
      enborProjectId: 'project_logging',
      error: {
        name: 'TypeError',
        message: expect.stringContaining('Cannot read properties of undefined'),
      },
    })
  })

  it('redacts callback and Basic credentials at the real HTTP error boundary', async () => {
    const callbackToken = 'A'.repeat(43)
    const basicCredential = 'Basic c2VydmljZS1jbGllbnQ6c2VydmljZS1zZWNyZXQ='
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await createApp().fetch(
      new Request('https://example.test/api/v1/projects', {
        headers: { authorization: 'Bearer e2e:http_boundary_redaction' },
      }),
      {
        AMA_RUNTIME_MODE: 'test',
        AMA_E2E_TEST_AUTH: 'true',
        OIDC_CLIENT_ID: 'ama-test',
        DB: {
          prepare() {
            throw new Error(`upstream body ${callbackToken}; authorization ${basicCredential}`)
          },
        },
      } as unknown as Env,
    )

    expect(response.status).toBe(500)
    expect(spy).toHaveBeenCalledOnce()
    const logged = String(spy.mock.calls[0]?.[0])
    expect(logged).not.toContain(callbackToken)
    expect(logged).not.toContain('c2VydmljZS1jbGllbnQ6c2VydmljZS1zZWNyZXQ')
    expect(logged).toContain('[redacted]')
  })

  it.each([
    '/.well-known/oauth-protected-resource/api',
    '/api',
    '/api/v1/openapi.json',
  ])('fails closed for canonical resource endpoint %s when OIDC_RESOURCE is missing', async (path) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await createApp().fetch(new Request(`https://hostile.example${path}`), {
      AMA_RUNTIME_MODE: 'live',
      OIDC_ISSUER: 'https://id.example.test/api/auth',
      OIDC_CLIENT_ID: 'ama-test',
    } as Env)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: { type: 'internal_error', message: 'Internal server error' },
    })
  })

  it('fails closed when OpenAPI identity-provider discovery has no OIDC_ISSUER', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await createApp().fetch(new Request('https://hostile.example/api/v1/openapi.json'), {
      AMA_RUNTIME_MODE: 'live',
      OIDC_CLIENT_ID: 'ama-test',
      OIDC_RESOURCE: 'https://ama.tftt.cc/api',
    } as Env)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: { type: 'internal_error', message: 'Internal server error' },
    })
  })
})
