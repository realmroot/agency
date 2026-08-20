import { expect, gotoAuthed, test } from './fixtures'

// Real browser happy-path: a seeded session renders in the console list and its
// routed detail page opens (session create drives the runtime + auto-selects the
// active agent/env — that flow is covered by web component tests + integration).
test('opens a DPoP-authenticated session socket and shows Realmroot Toolbox integration [spec: web-console/routed-pages] [spec: sessions/connection] [spec: quickstart/integration-examples]', async ({
  page,
  token,
  api,
  runId,
}) => {
  // Agents must pin a provider+model from the global catalog; seed it first.
  await api.post('/api/v1/e2e/catalog/seed', { data: {} })
  const agentRes = await api.post('/api/v1/agents', {
    data: {
      metadata: { name: `s-agent-${runId}` },
      spec: {
        systemPrompt: 'x',
        provider: 'workers-ai',
        model: '@cf/moonshotai/kimi-k2.6',
      },
    },
  })
  expect(agentRes.status(), 'seed session agent').toBe(201)
  const agent = (await agentRes.json()) as { metadata: { uid: string } }
  const environmentRes = await api.post('/api/v1/environments', {
    data: { metadata: { name: `s-env-${runId}` }, spec: {} },
  })
  expect(environmentRes.status(), 'seed session environment').toBe(201)
  const environment = (await environmentRes.json()) as { metadata: { uid: string } }
  const title = `ui-session-${runId}`
  const res = await api.post('/api/v1/sessions', {
    data: {
      prompt: `Open seeded session ${runId}`,
      metadata: { name: title },
      spec: {
        agentId: agent.metadata.uid,
        environmentId: environment.metadata.uid,
        runtime: 'ama',
      },
    },
  })
  expect(res.status(), 'seed session').toBe(201)
  const session = (await res.json()) as { metadata: { uid: string } }

  await page.addInitScript(() => {
    type SocketAttempt = { url: string; protocols: string[] }
    const target = window as typeof window & { __amaSocketAttempts?: SocketAttempt[] }
    target.__amaSocketAttempts = []
    window.WebSocket = new Proxy(window.WebSocket, {
      construct(WebSocketConstructor, args: [string | URL, string | string[] | undefined]) {
        const [url, protocols] = args
        target.__amaSocketAttempts?.push({
          url: String(url),
          protocols: typeof protocols === 'string' ? [protocols] : (protocols ?? []),
        })
        return Reflect.construct(WebSocketConstructor, args)
      },
    })
  })
  await gotoAuthed(page, token, '/sessions')
  await expect(page.getByText(title)).toBeVisible()

  await page.goto(`/sessions/${session.metadata.uid}`)
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.metadata.uid}$`))
  await expect
    .poll(() =>
      page.evaluate((sessionId) => {
        const attempts = (
          window as typeof window & {
            __amaSocketAttempts?: Array<{ url: string; protocols: string[] }>
          }
        ).__amaSocketAttempts
        return (
          attempts?.filter((attempt) => new URL(attempt.url).pathname === `/api/v1/sessions/${sessionId}/socket`)
            .length ?? 0
        )
      }, session.metadata.uid),
    )
    .toBeGreaterThan(0)
  const socketAttempt = await page.evaluate((sessionId) => {
    const attempts = (
      window as typeof window & {
        __amaSocketAttempts?: Array<{ url: string; protocols: string[] }>
      }
    ).__amaSocketAttempts
    return attempts?.find((attempt) => new URL(attempt.url).pathname === `/api/v1/sessions/${sessionId}/socket`)
  }, session.metadata.uid)
  expect(socketAttempt).toBeTruthy()
  const socketUrl = new URL(socketAttempt!.url)
  expect(socketUrl.pathname).toBe(`/api/v1/sessions/${session.metadata.uid}/socket`)
  expect(socketUrl.searchParams.has('access_token')).toBe(false)
  expect(socketAttempt!.protocols[0]).toBe('ama-dpop')
  expect(socketAttempt!.protocols.some((protocol) => protocol.startsWith('ama-access.'))).toBe(true)
  expect(socketAttempt!.protocols.some((protocol) => protocol.startsWith('ama-proof.'))).toBe(true)

  await page.goto(`/quickstart?step=integration&session=${session.metadata.uid}`)
  await expect(page.getByText('Realmroot CLI')).toBeVisible()
  await expect(page.locator('pre').filter({ hasText: 'realmroot toolbox sync any-managed-agents' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/\bBearer\b/i)
  await expect(page.getByText('curl', { exact: true })).toHaveCount(0)
  await expect(page.getByText('restish', { exact: true })).toHaveCount(0)
})
