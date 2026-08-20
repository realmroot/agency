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
          authorization: 'DPoP e2e:logging_error',
          dpop: 'e2e-proof:GET:https://example.test/api/v1/projects',
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
      amaProjectId: 'project_logging',
      error: {
        name: 'TypeError',
        message: expect.stringContaining('Cannot read properties of undefined'),
      },
    })
  })
})
