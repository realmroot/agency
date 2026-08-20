import { expect, gotoAuthed, test } from './fixtures'

test('shows the Realmroot Agent actor and controller chain on desktop and mobile [spec: audit/console-detail]', async ({
  page,
  token,
}) => {
  const recordId = 'audit_agent_controller'
  const actorId = 'realmroot-agent_01jz8example'
  const controllerId = token.userId
  await page.route(`**/api/v1/audit-records/${recordId}`, (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: recordId,
        projectId: token.projectId,
        actorUserId: actorId,
        controllerUserId: controllerId,
        actorType: 'agent',
        action: 'session.create',
        resourceType: 'session',
        resourceId: 'session_agent_controller',
        outcome: 'success',
        requestId: 'request_agent_controller',
        correlationId: 'correlation_agent_controller',
        sessionId: 'session_agent_controller',
        policyCategory: null,
        metadata: { identityProvider: 'realmroot' },
        before: {},
        after: { phase: 'idle' },
        createdAt: '2026-08-19T12:00:00.000Z',
      }),
    }),
  )

  const assertActorChain = async () => {
    await expect(page.getByRole('heading', { name: 'session.create' })).toBeVisible()
    await expect(page.getByText('Actor', { exact: true }).locator('..')).toContainText(actorId)
    await expect(page.getByText('Actor type', { exact: true }).locator('..')).toContainText('agent')
    await expect(page.getByText('Controller', { exact: true }).locator('..')).toContainText(controllerId)
  }

  await page.setViewportSize({ width: 1280, height: 800 })
  await gotoAuthed(page, token, `/audit/${recordId}`)
  await assertActorChain()

  await page.setViewportSize({ width: 390, height: 844 })
  await assertActorChain()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'audit detail fits the 390px viewport without horizontal overflow',
  ).toBe(true)
})
