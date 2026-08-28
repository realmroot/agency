import { type APIResponse, test as base, expect, type Page, request } from '@playwright/test'

const BASE = process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5173}`

export type E2eToken = {
  accessToken: string
  projectId: string
  userId: string
  organizationId: string
}

type Fixtures = {
  // A per-test run id, unique enough to isolate the rows each crown creates.
  runId: string
  // The local e2e Console token (minted only by the AMA_E2E_TEST_AUTH harness route).
  token: E2eToken
  // An authenticated Console client for raw control-plane setup calls.
  api: E2eApi
}

type E2eApi = {
  post(url: string, options?: { data?: unknown }): Promise<APIResponse>
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture deps from the destructured arg; this fixture has none.
  runId: async ({}, use) => {
    await use(`e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  },
  token: async ({ runId }, use) => {
    const res = await fetch(`${BASE}/api/v1/e2e/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId }),
    })
    if (res.status !== 201) {
      throw new Error(`POST /api/v1/e2e/auth/token returned ${res.status}: ${await res.text()}`)
    }
    await use((await res.json()) as E2eToken)
  },
  api: async ({ token }, use) => {
    const ctx = await request.newContext({
      baseURL: BASE,
    })
    await use({
      post: (url, options) =>
        ctx.post(url, {
          ...options,
          headers: {
            authorization: `Bearer ${token.accessToken}`,
            'x-ama-project-id': token.projectId,
          },
        }),
    })
    await ctx.dispose()
  },
})

// Sign the browser in through the gated test endpoint so browser journeys use
// the same opaque HttpOnly session cookie as production OIDC callbacks.
export async function gotoAuthed(page: Page, token: E2eToken, path: string) {
  const response = await page.request.post(`${BASE}/api/v1/e2e/auth/session`, {
    data: { accessToken: token.accessToken },
  })
  if (response.status() !== 204) {
    throw new Error(`POST /api/v1/e2e/auth/session returned ${response.status()}: ${await response.text()}`)
  }
  await page.addInitScript((projectId) => {
    window.localStorage.setItem('ama:selected-project-id', projectId)
  }, token.projectId)
  await page.goto(path)
}

export { expect }
