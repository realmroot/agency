import { createReadyAgent, expect, gotoAuthed, test } from './fixtures'

// Real browser happy-path: a seeded agent renders in the console list and its
// routed detail page opens (the agent create wizard is covered by web component
// tests + the create endpoint by the integration crown).
test('lists a seeded agent and opens its detail page [spec: web-console/routed-pages]', async ({
  page,
  token,
  api,
  runId,
}) => {
  const name = `ui-agent-${runId}`
  await api.post('/api/v1/e2e/catalog/seed', { data: {} })
  const agent = await createReadyAgent(api, runId, name)

  await gotoAuthed(page, token, '/agents')
  await expect(page.getByRole('link', { name })).toBeVisible()

  await page.getByRole('link', { name }).click()
  await expect(page).toHaveURL(new RegExp(`/agents/${agent.metadata.uid}$`))
})
