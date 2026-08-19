import { expect, gotoAuthed, test } from './fixtures'

// Real browser happy-path: create a vault through the console UI and see it listed.
test('creates a vault through the UI and sees it listed [spec: web-console/resource-lists]', async ({
  page,
  token,
  runId,
}) => {
  await gotoAuthed(page, token, '/vaults')

  await page.getByRole('button', { name: 'Create vault' }).click()
  const name = `ui-vault-${runId}`
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Save vault' }).click()

  // Mutation writes D1, the list query refetches, the new vault appears.
  await expect(page.getByText(name)).toBeVisible()
})

test('stores Realmroot Agent state from the credential sheet [spec: agents/realmroot-binding]', async ({
  page,
  token,
  api,
  runId,
}) => {
  const vaultResponse = await api.post('/api/v1/vaults', {
    data: {
      metadata: { name: `realmroot-vault-${runId}` },
      spec: { scope: 'project' },
    },
  })
  expect(vaultResponse.status(), 'seed vault').toBe(201)
  const vault = (await vaultResponse.json()) as { metadata: { uid: string } }

  await gotoAuthed(page, token, `/vaults/${vault.metadata.uid}`)
  await page.getByRole('button', { name: 'Add credential' }).first().click()
  await expect(page.getByRole('heading', { name: 'Add credential' })).toBeVisible()

  await page.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Realmroot Agent state' }).click()
  await expect(page.getByLabel('Realmroot Agent state JSON')).toBeVisible()
  await expect(
    page.getByText('Paste the complete YW1h.json enrolled with AGENT=ama. AMA stores it as state.json.'),
  ).toBeVisible()

  const state = JSON.stringify({
    version: 18,
    agent_id: `agent-${runId}`,
    origin: 'https://realmroot.example',
    issuer: 'https://realmroot.example',
    runtime: 'ama',
    host_id: `host-${runId}`,
    agent_key_id: `key-${runId}`,
    enrollment_idempotency_key: `enrollment-${runId}`,
    agent_private_key: 'A'.repeat(86),
  })
  await page.getByLabel('Name').fill('Realmroot identity')
  await page.getByLabel('Realmroot Agent state JSON').fill(state)

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/v1/vaults/${vault.metadata.uid}/credentials`),
  )
  await page.getByRole('button', { name: 'Save credential' }).click()
  const credentialResponse = await responsePromise

  expect(credentialResponse.status(), 'create Realmroot credential').toBe(201)
  expect(credentialResponse.request().postDataJSON()).toEqual({
    name: 'Realmroot identity',
    type: 'ama.dev/realmroot-agent-state',
    metadata: {},
    secret: { stringData: { 'state.json': state } },
  })
  await expect(page.getByText('Credential stored')).toBeVisible()
})
