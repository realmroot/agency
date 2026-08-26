import { createReadyAgent, expect, gotoAuthed, test } from './fixtures'

// Real browser happy-path: a seeded session renders in the console list and its
// routed detail page opens (session create drives the runtime + auto-selects the
// active agent/env — that flow is covered by web component tests + integration).
test('exchanges a Bearer credential for an opaque session socket ticket [spec: web-console/routed-pages] [spec: sessions/connection]', async ({
  page,
  token,
  api,
  runId,
}) => {
  // Agents must pin a provider+model from the global catalog; seed it first.
  await api.post('/api/v1/e2e/catalog/seed', { data: {} })
  const agent = await createReadyAgent(api, runId, `s-agent-${runId}`)
  const environmentRes = await api.post('/api/v1/environments', {
    data: { metadata: { name: `s-env-${runId}` }, spec: {} },
  })
  expect(environmentRes.status(), 'seed session environment').toBe(201)
  const environment = (await environmentRes.json()) as { metadata: { uid: string } }
  const title = `ui-session-${runId}`
  const res = await api.post('/api/v1/sessions', {
    data: {
      spec: {
        agentId: agent.metadata.uid,
        environmentId: environment.metadata.uid,
        runtime: 'ama',
      },
      prompt: title,
    },
  })
  expect(res.status(), 'seed session').toBe(201)
  const session = (await res.json()) as { metadata: { uid: string } }

  await page.addInitScript(() => {
    type ConnectionEvent = { kind: 'ticket-response' | 'socket'; url: string; protocols?: string[] }
    const target = window as typeof window & { __amaConnectionEvents?: ConnectionEvent[] }
    target.__amaConnectionEvents = []
    const nativeFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args)
      const input = args[0]
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
      if (new URL(url, window.location.href).pathname.endsWith('/socket-tickets')) {
        target.__amaConnectionEvents?.push({ kind: 'ticket-response', url: response.url })
      }
      return response
    }
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(WebSocketConstructor, args: [string | URL, string | string[] | undefined]) {
        const [url, protocols] = args
        target.__amaConnectionEvents?.push({
          kind: 'socket',
          url: String(url),
          protocols: typeof protocols === 'string' ? [protocols] : (protocols ?? []),
        })
        return Reflect.construct(WebSocketConstructor, args)
      },
    })
  })
  await gotoAuthed(page, token, '/sessions')
  await expect(page.getByText(title)).toBeVisible()

  const socketTicketRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/v1/sessions/${session.metadata.uid}/socket-tickets`,
  )
  await page.goto(`/sessions/${session.metadata.uid}`)
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.metadata.uid}$`))
  const socketTicketRequest = await socketTicketRequestPromise
  expect(socketTicketRequest.headers().authorization).toBe(`Bearer ${token.accessToken}`)
  expect(socketTicketRequest.headers().dpop).toBeUndefined()
  await expect
    .poll(() =>
      page.evaluate((sessionId) => {
        const events = (
          window as typeof window & {
            __amaConnectionEvents?: Array<{
              kind: 'ticket-response' | 'socket'
              url: string
              protocols?: string[]
            }>
          }
        ).__amaConnectionEvents
        return (
          events?.filter(
            (event) =>
              event.kind === 'socket' && new URL(event.url).pathname === `/api/v1/sessions/${sessionId}/socket`,
          ).length ?? 0
        )
      }, session.metadata.uid),
    )
    .toBeGreaterThan(0)
  const connectionEvents = await page.evaluate((sessionId) => {
    const events = (
      window as typeof window & {
        __amaConnectionEvents?: Array<{
          kind: 'ticket-response' | 'socket'
          url: string
          protocols?: string[]
        }>
      }
    ).__amaConnectionEvents
    return events?.filter((event) => {
      const path = new URL(event.url).pathname
      return path === `/api/v1/sessions/${sessionId}/socket-tickets` || path === `/api/v1/sessions/${sessionId}/socket`
    })
  }, session.metadata.uid)
  expect(connectionEvents?.map((event) => event.kind)).toEqual(['ticket-response', 'socket'])
  const socketAttempt = connectionEvents?.find((event) => event.kind === 'socket')
  expect(socketAttempt).toBeTruthy()
  const socketUrl = new URL(socketAttempt!.url)
  expect(socketUrl.pathname).toBe(`/api/v1/sessions/${session.metadata.uid}/socket`)
  expect(socketUrl.search).toBe('')
  expect(socketAttempt!.protocols).toHaveLength(2)
  expect(socketAttempt!.protocols?.[0]).toBe('ama-ticket')
  expect(socketAttempt!.protocols?.[1]).toMatch(/^ama-ticket\.[A-Za-z0-9_-]{43}$/)
  expect(socketAttempt!.protocols?.some((protocol) => protocol.startsWith('ama-access.'))).toBe(false)
  expect(socketAttempt!.protocols?.some((protocol) => protocol.startsWith('ama-proof.'))).toBe(false)
})
