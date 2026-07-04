import { afterEach, describe, expect, it, vi } from 'vitest'
import { logError, type SerializedError, serializeError } from './logging'

describe('structured logging', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serializes error causes and query details for database failures', () => {
    const cause = new Error('D1_ERROR: no such table: projects')
    const error = new Error('Failed query: select "id" from "projects" where "projects"."organization_id" = ?', {
      cause,
    }) as Error & { query: string; params: unknown[] }
    error.query = 'select "id" from "projects" where "projects"."organization_id" = ?'
    error.params = ['user:b54e9c4d-3fc5-4b86-a9b4-695a835f7e1a', 'Bearer secrettoken123']

    const serialized = serializeError(error) as SerializedError

    expect(serialized).toMatchObject({
      name: 'Error',
      message: 'Failed query: select "id" from "projects" where "projects"."organization_id" = ?',
      cause: {
        name: 'Error',
        message: 'D1_ERROR: no such table: projects',
      },
      details: {
        query: 'select "id" from "projects" where "projects"."organization_id" = ?',
        params: ['user:b54e9c4d-3fc5-4b86-a9b4-695a835f7e1a', '[redacted]'],
      },
    })
  })

  it('writes JSON error logs with context', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    logError('http.request.failed', new Error('boom'), { requestId: 'req_1', path: '/api/v1/projects' })

    expect(spy).toHaveBeenCalledOnce()
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(payload).toMatchObject({
      level: 'error',
      event: 'http.request.failed',
      requestId: 'req_1',
      path: '/api/v1/projects',
      error: { name: 'Error', message: 'boom' },
    })
    expect(payload.timestamp).toEqual(expect.any(String))
  })
})
