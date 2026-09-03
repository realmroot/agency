import { type E2eToken, expect, gotoAuthed, test } from './fixtures'

function apiHeaders(token: E2eToken) {
  return {
    authorization: `Bearer ${token.accessToken}`,
    'x-enbor-project-id': token.projectId,
  }
}

test('creates a Codex Identity, binds an Agent, and locks the Session Runtime [spec: identities/console] [spec: agents/identity-binding] [spec: sessions/identity-materialization]', async ({
  page,
  runId,
}) => {
  const tokenResponse = await page.request.post('/api/v1/e2e/auth/token', {
    data: { runId: `identity-${runId}`, personal: true },
  })
  expect(tokenResponse.status(), 'mint personal project token').toBe(201)
  const token = (await tokenResponse.json()) as E2eToken
  const headers = apiHeaders(token)

  const catalogResponse = await page.request.post('/api/v1/e2e/catalog/seed', { headers, data: {} })
  expect(catalogResponse.status(), 'seed provider catalog').toBe(201)

  const environmentResponse = await page.request.post('/api/v1/environments', {
    headers,
    data: { metadata: { name: `Identity environment ${runId}` }, spec: { type: 'self_hosted' } },
  })
  expect(environmentResponse.status(), 'seed environment').toBe(201)
  const environment = (await environmentResponse.json()) as { metadata: { uid: string } }
  const runnerHeaders = {
    authorization: `Bearer ${token.accessToken.replace(/^e2e:/, 'e2e-runner:')}`,
    'x-enbor-project-id': token.projectId,
  }
  const runnerResponse = await page.request.post('/api/v1/runners', {
    headers: runnerHeaders,
    data: { name: `Identity runner ${runId}`, environmentId: environment.metadata.uid },
  })
  expect(runnerResponse.status(), 'register compatible runner').toBe(201)
  const runner = (await runnerResponse.json()) as { id: string }
  const heartbeatResponse = await page.request.put(`/api/v1/runners/${runner.id}/heartbeat`, {
    headers: runnerHeaders,
    data: { state: 'active', runtimes: [{ runtime: 'codex', models: [], state: 'ready' }] },
  })
  expect(heartbeatResponse.status(), 'advertise Codex Runtime').toBe(200)

  await gotoAuthed(page, token, '/identities')
  await page.getByRole('button', { name: 'Create identity' }).click()
  const identityName = `Codex identity ${runId}`
  const username = `codex-${Date.now()}`
  await page.getByLabel('Name', { exact: true }).fill(identityName)
  await page.getByLabel('Username').fill(username)
  const identityResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/identities',
  )
  await page.getByRole('button', { name: 'Create identity' }).last().click()
  const identityResponse = await identityResponsePromise
  expect(identityResponse.status(), await identityResponse.text()).toBe(201)
  const identity = (await identityResponse.json()) as { metadata: { uid: string }; spec: { runtime: string } }
  expect(identity.spec.runtime).toBe('codex')
  const identityLink = page.getByRole('link', { name: identityName })
  await expect(identityLink).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Assigned agent' })).toBeVisible()
  await expect(page.getByText('Unassigned', { exact: true })).toBeVisible()
  await identityLink.click()
  await expect(page.getByText('Username', { exact: true })).toBeVisible()
  await expect(page.getByText(username, { exact: true })).toBeVisible()
  await expect(page.getByText('Status', { exact: true })).toBeVisible()
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Assigned agent', { exact: true })).toBeVisible()
  await expect(page.getByText('Unassigned', { exact: true })).toBeVisible()
  await expect(page.getByText('External ID', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Identity details are safe to view. Credentials remain protected.')).toBeVisible()

  await page.goto('/agents')
  await page.getByRole('button', { name: 'Create agent' }).click()
  const agentDialog = page.getByRole('dialog', { name: 'Create Agent' })
  await expect(agentDialog.getByLabel('Skills')).toHaveValue('')
  await agentDialog.getByRole('combobox').nth(1).click()
  await page.getByRole('option', { name: `${identityName} · codex` }).click()
  const agentResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/agents',
  )
  await agentDialog.getByRole('button', { name: 'Save agent' }).click()
  const agentResponse = await agentResponsePromise
  expect(agentResponse.status(), await agentResponse.text()).toBe(201)
  const agent = (await agentResponse.json()) as {
    metadata: { uid: string }
    spec: { identity: { identityId: string; runtime: string } | null; skills: string[] }
  }
  expect(agent.spec.identity).toMatchObject({ identityId: identity.metadata.uid, runtime: 'codex' })
  expect(agent.spec.skills).toEqual([])
  const pinProviderResponse = await page.request.patch(`/api/v1/agents/${agent.metadata.uid}`, {
    headers,
    data: { spec: { provider: 'workers-ai' } },
  })
  expect(pinProviderResponse.status(), 'pin Agent provider for Session creation').toBe(200)

  await page.goto(`/identities/${identity.metadata.uid}`)
  await expect(page.getByText('Assigned', { exact: true })).toBeVisible()
  await expect(page.getByText(agent.metadata.uid, { exact: true })).toHaveCount(0)

  await page.goto('/sessions')
  await page.getByRole('button', { name: 'Create session' }).click()
  const sessionDialog = page.getByRole('dialog', { name: 'Create Session' })
  await expect(sessionDialog.getByText('Set by the selected identity.')).toBeVisible()
  const runtimeSelect = sessionDialog.getByRole('combobox').nth(2)
  await expect(runtimeSelect).toBeDisabled()
  await expect(runtimeSelect).toContainText('Codex')
  await sessionDialog.getByLabel('Prompt').fill(`Run with Identity ${runId}`)

  const sessionResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/sessions',
  )
  await sessionDialog.getByRole('button', { name: 'Create session' }).click()
  const sessionResponse = await sessionResponsePromise
  expect(sessionResponse.status(), await sessionResponse.text()).toBe(201)
  const session = (await sessionResponse.json()) as {
    metadata: { uid: string }
    spec: { runtime: string }
    status: { bindings: { agent: { snapshot: { identity: { identityId: string } | null } } } }
  }
  expect(session.spec.runtime).toBe('codex')
  expect(session.status.bindings.agent.snapshot.identity?.identityId).toBe(identity.metadata.uid)
  await expect(page).toHaveURL(new RegExp(`/sessions/${session.metadata.uid}$`))
})

test('rejects Identity provisioning for an organization Project [spec: identities/personal-only]', async ({
  page,
  token,
  runId,
}) => {
  const response = await page.request.post('/api/v1/identities', {
    headers: {
      ...apiHeaders(token),
      'idempotency-key': `organization-identity-${runId}`,
    },
    data: {
      metadata: { name: `Organization Identity ${runId}` },
      spec: { username: `organization-${Date.now()}`, runtime: 'codex' },
    },
  })

  expect(response.status()).toBe(409)
  await expect(response.json()).resolves.toMatchObject({
    error: { type: 'organization_identity_not_supported' },
  })
})

test('rejects a Session Runtime that conflicts with its bound Identity [spec: sessions/identity-materialization]', async ({
  page,
  runId,
}) => {
  const tokenResponse = await page.request.post('/api/v1/e2e/auth/token', {
    data: { runId: `identity-mismatch-${runId}`, personal: true },
  })
  expect(tokenResponse.status(), 'mint personal project token').toBe(201)
  const token = (await tokenResponse.json()) as E2eToken
  const headers = apiHeaders(token)

  const catalogResponse = await page.request.post('/api/v1/e2e/catalog/seed', { headers, data: {} })
  expect(catalogResponse.status(), 'seed provider catalog').toBe(201)
  const environmentResponse = await page.request.post('/api/v1/environments', {
    headers,
    data: { metadata: { name: `Mismatch environment ${runId}` }, spec: { type: 'self_hosted' } },
  })
  expect(environmentResponse.status(), 'seed environment').toBe(201)
  const environment = (await environmentResponse.json()) as { metadata: { uid: string } }

  const identityResponse = await page.request.post('/api/v1/identities', {
    headers: { ...headers, 'idempotency-key': `runtime-mismatch-${runId}` },
    data: {
      metadata: { name: `Mismatch Identity ${runId}` },
      spec: { username: `mismatch-${Date.now()}`, runtime: 'codex' },
    },
  })
  expect(identityResponse.status(), await identityResponse.text()).toBe(201)
  const identity = (await identityResponse.json()) as { metadata: { uid: string } }

  const agentResponse = await page.request.post('/api/v1/agents', {
    headers,
    data: {
      metadata: { name: `Mismatch Agent ${runId}` },
      spec: {
        systemPrompt: 'Validate the Identity Runtime constraint.',
        provider: 'workers-ai',
        identityRef: identity.metadata.uid,
      },
    },
  })
  expect(agentResponse.status(), await agentResponse.text()).toBe(201)
  const agent = (await agentResponse.json()) as { metadata: { uid: string } }

  const sessionResponse = await page.request.post('/api/v1/sessions', {
    headers,
    data: {
      prompt: 'This conflicting Runtime must be rejected.',
      spec: {
        agentId: agent.metadata.uid,
        environmentId: environment.metadata.uid,
        runtime: 'enbor',
      },
    },
  })

  expect(sessionResponse.status()).toBe(409)
  await expect(sessionResponse.json()).resolves.toMatchObject({ error: { type: 'identity_runtime_mismatch' } })
})
