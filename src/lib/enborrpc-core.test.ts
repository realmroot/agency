import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type CapturedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const capturedClientOptions = vi.hoisted(() => ({ fetch: undefined as CapturedFetch | undefined }))

vi.mock('hono/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hono/client')>()
  const wrappedHc = ((baseUrl: string, options?: { fetch?: CapturedFetch }) => {
    capturedClientOptions.fetch = options?.fetch
    return actual.hc(baseUrl, options)
  }) as typeof actual.hc
  return { ...actual, hc: wrappedHc }
})

await import('./enborrpc/core')

describe('Enbor RPC transport input normalization', () => {
  beforeEach(() => {
    window.localStorage.setItem('enbor:e2e-access-token', 'e2e:core-transport')
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('normalizes URL inputs and defaults their method to GET', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const input = new URL('https://enbor.example.test/api/v1/agents?archived=true#fragment')

    await capturedClientOptions.fetch!(input)

    expect(fetchMock).toHaveBeenCalledWith(input, expect.objectContaining({ headers: expect.any(Headers) }))
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('authorization')).toBe('Bearer e2e:core-transport')
    expect(headers.has('dpop')).toBe(false)
  })

  it('uses Request methods and merges Request headers with init headers', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const input = new Request('https://enbor.example.test/api/v1/agents/agent_1', {
      method: 'PATCH',
      headers: { 'x-request-header': 'request' },
    })

    await capturedClientOptions.fetch!(input, { headers: { 'x-init-header': 'init' } })

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get('x-request-header')).toBe('request')
    expect(headers.get('x-init-header')).toBe('init')
    expect(headers.get('authorization')).toBe('Bearer e2e:core-transport')
    expect(headers.has('dpop')).toBe(false)
  })
})
