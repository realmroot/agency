import { expect, gotoAuthed, test } from './fixtures'

test('starts Realmroot PKCE with a DPoP-bound authorization code [spec: auth/e2e-sign-in]', async ({ page }) => {
  let authorizationNonce = ''
  const callbackAccessToken = [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'realmroot-e2e-user', exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
      'base64url',
    ),
    'e2e-signature',
  ].join('.')
  await page.route('**/.well-known/openid-configuration*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        issuer: 'https://oidc.test/api/auth',
        authorization_endpoint: 'https://oidc.test/authorize',
        token_endpoint: 'https://oidc.test/token',
        jwks_uri: 'https://oidc.test/jwks',
        end_session_endpoint: 'https://oidc.test/logout',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['ES256'],
        code_challenge_methods_supported: ['S256'],
      }),
    }),
  )
  await page.route('https://oidc.test/authorize*', (route) => {
    const authorizationUrl = new URL(route.request().url())
    authorizationNonce = authorizationUrl.searchParams.get('nonce') ?? ''
    const callbackUrl = new URL(authorizationUrl.searchParams.get('redirect_uri')!)
    callbackUrl.searchParams.set('code', 'realmroot-e2e-code')
    callbackUrl.searchParams.set('state', authorizationUrl.searchParams.get('state')!)
    return route.fulfill({ status: 302, headers: { location: callbackUrl.toString() } })
  })
  await page.route('https://oidc.test/token', (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'content-type,dpop',
        },
      })
    }
    return route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        access_token: callbackAccessToken,
        id_token: [
          Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
          Buffer.from(
            JSON.stringify({
              iss: 'https://oidc.test/api/auth',
              aud: 'ama-e2e',
              sub: 'realmroot-e2e-user',
              nonce: authorizationNonce,
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 3600,
            }),
          ).toString('base64url'),
          'e2e-signature',
        ].join('.'),
        token_type: 'DPoP',
        expires_in: 3600,
        scope: 'openid profile email offline_access',
      }),
    })
  })

  await page.goto('/agents')
  const amaResource = await page.evaluate(async () => {
    const response = await fetch('/api/v1/configz')
    const config = (await response.json()) as { auth: { oidc: { resource: string } } }
    return config.auth.oidc.resource
  })
  const authorizationRequestPromise = page.waitForRequest('https://oidc.test/authorize*')
  const tokenRequestPromise = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url() === 'https://oidc.test/token',
  )
  await page.getByRole('button', { name: 'Continue with OIDC provider' }).click()
  const authorizationUrl = new URL((await authorizationRequestPromise).url())

  expect(authorizationUrl.searchParams.get('response_type')).toBe('code')
  expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256')
  expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy()
  expect(authorizationUrl.searchParams.get('dpop_jkt')).toBeTruthy()
  expect(authorizationUrl.searchParams.get('resource')).toBe(amaResource)
  expect(authorizationUrl.searchParams.get('state')).toBeTruthy()

  const tokenRequest = await tokenRequestPromise
  expect(tokenRequest.headers().dpop).toBeTruthy()
  expect(tokenRequest.postData() ?? '').toContain('code=realmroot-e2e-code')
  expect(tokenRequest.postData() ?? '').toMatch(/code_verifier=[^&]+/)
  await expect(page).toHaveURL(/\/agents$/)
  await expect
    .poll(() =>
      page.evaluate(() => {
        for (let index = 0; index < window.localStorage.length; index += 1) {
          const key = window.localStorage.key(index)
          if (!key?.startsWith('oidc.user:')) continue
          const value = window.localStorage.getItem(key)
          if (value) return JSON.parse(value) as { access_token?: string; token_type?: string }
        }
        return null
      }),
    )
    .toMatchObject({ access_token: callbackAccessToken, token_type: 'DPoP' })
})

// The browser dimension of the e2e crown: drives the real SPA + Worker + D1 + auth
// through Chromium. Reserved for hermetic console journeys (sign-in, routing, admin
// CRUD that only writes D1) per the skill — a handful, not one-per-feature.
test.describe('console (real browser)', () => {
  test('signs in and navigates the console shell [spec: web-console/shell] [spec: auth/e2e-sign-in]', async ({
    page,
    token,
  }) => {
    const apiRequests: import('@playwright/test').Request[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/v1/')) apiRequests.push(request)
    })
    await gotoAuthed(page, token, '/agents')

    // The authenticated shell rendered (the e2e identity resolved client-side).
    await expect(page.getByText('Any Managed Agents').first()).toBeVisible()

    // Navigate to Environments through the primary nav — real client-side routing.
    await page.getByRole('link', { name: 'Environments' }).first().click()
    await expect(page).toHaveURL(/\/environments$/)
    await expect(page.getByRole('button', { name: 'Create environment' })).toBeVisible()

    const protectedRpcRequests = apiRequests.filter((request) => {
      const path = new URL(request.url()).pathname
      return path !== '/api/v1/configz' && path !== '/api/v1/auth/config'
    })
    expect(protectedRpcRequests.length).toBeGreaterThan(0)
    for (const request of protectedRpcRequests) {
      const headers = request.headers()
      const proofUrl = new URL(request.url())
      proofUrl.search = ''
      proofUrl.hash = ''
      expect(headers.authorization).toBe(`DPoP ${token.accessToken}`)
      expect(headers.dpop).toBe(`e2e-proof:${request.method()}:${proofUrl.toString()}`)
      expect(headers.authorization).not.toMatch(/^Bearer /i)
    }
    expect(
      apiRequests.some(
        (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/auth/sessions',
      ),
    ).toBe(false)
  })

  test('creates an environment through the UI and sees it listed [spec: web-console/resource-lists]', async ({
    page,
    token,
    runId,
  }) => {
    await gotoAuthed(page, token, '/environments')

    await page.getByRole('button', { name: 'Create environment' }).click()
    const name = `ui-env-${runId}`
    const nameField = page.getByRole('textbox', { name: 'Name', exact: true })
    await nameField.fill(name)
    await page.getByRole('button', { name: 'Save environment' }).click()

    // The form's mutation writes D1, the list query invalidates + refetches from the
    // real backend, and the new row appears — the full SPA→Worker→D1 round-trip.
    await expect(page.getByText(name)).toBeVisible()
  })
})
