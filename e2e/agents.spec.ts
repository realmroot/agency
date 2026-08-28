import { expect, gotoAuthed, test } from './fixtures'

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
  const res = await api.post('/api/v1/agents', {
    data: {
      metadata: { name },
      spec: { systemPrompt: 'E2E view journey' },
    },
  })
  expect(res.status(), 'seed agent').toBe(201)
  const agent = (await res.json()) as { metadata: { uid: string } }

  await gotoAuthed(page, token, '/agents')
  await expect(page.getByRole('link', { name })).toBeVisible()

  await page.getByRole('link', { name }).click()
  await expect(page).toHaveURL(new RegExp(`/agents/${agent.metadata.uid}$`))
})
