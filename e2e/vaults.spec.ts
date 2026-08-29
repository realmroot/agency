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

test('hides system-managed Identity credentials and stores a normal credential [spec: vaults/add-credential-sheet]', async ({
  page,
  token,
  api,
  runId,
}) => {
  const vaultResponse = await api.post('/api/v1/vaults', {
    data: {
      metadata: { name: `credential-vault-${runId}` },
      spec: { scope: 'project' },
    },
  })
  expect(vaultResponse.status(), 'seed vault').toBe(201)
  const vault = (await vaultResponse.json()) as { metadata: { uid: string } }

  await gotoAuthed(page, token, `/vaults/${vault.metadata.uid}`)
  await page.getByRole('button', { name: 'Add credential' }).first().click()
  await expect(page.getByRole('heading', { name: 'Add credential' })).toBeVisible()

  await page.getByLabel('Type').click()
  await expect(page.getByRole('option', { name: 'Realmroot Agent state' })).toHaveCount(0)
  await expect(page.getByRole('option', { name: 'Opaque' })).toBeVisible()
  await page.getByRole('option', { name: 'Opaque' }).click()

  await page.getByLabel('Name').fill('Runtime API token')
  await page.getByLabel('Data value 1').fill(`secret-${runId}`)

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/v1/vaults/${vault.metadata.uid}/credentials`),
  )
  await page.getByRole('button', { name: 'Save credential' }).click()
  const credentialResponse = await responsePromise

  expect(credentialResponse.status(), 'create opaque credential').toBe(201)
  expect(credentialResponse.request().postDataJSON()).toEqual({
    name: 'Runtime API token',
    type: 'opaque',
    metadata: {},
    secret: { stringData: { value: `secret-${runId}` } },
  })
  await expect(page.getByText('Credential stored')).toBeVisible()
})
