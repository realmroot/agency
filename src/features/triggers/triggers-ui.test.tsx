import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import { useClientPagination } from '@/console/use-client-pagination'
import type { Agent, Environment, Trigger } from '@/lib/amarpc'
import { createCollection, HttpResponse, http, resourceHandlers, server } from '@/test/msw'
import {
  type AgentOverrides,
  type EnvironmentOverrides,
  agent as resourceAgent,
  environment as resourceEnvironment,
  trigger as resourceTrigger,
  type TriggerOverrides,
} from '@/test/resource-fixtures'
import { CreateTriggerSheet } from './CreateTriggerSheet'
import { TriggersPage } from './TriggersPage'
import { formatInterval, TriggersView } from './TriggersView'
import { useTriggerActions } from './use-trigger-actions'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function trigger(overrides: TriggerOverrides = {}): Trigger {
  return resourceTrigger({
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-18T12:00:00.000Z',
    ...overrides,
  })
}

function pagination<T>(items: T[]): ClientPagination<T> {
  return {
    items,
    page: 1,
    pageCount: 1,
    pageSize: 10,
    total: items.length,
    start: items.length === 0 ? 0 : 1,
    end: items.length,
    canPrevious: false,
    canNext: false,
    viewportRef: { current: null },
    previous: vi.fn(),
    next: vi.fn(),
  }
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function setupTriggerHandlers(triggers: Trigger[] = [], agents: Agent[] = [agent()]) {
  const collection = createCollection<Trigger>(triggers)
  server.use(
    ...resourceHandlers('triggers', collection, (body, idx) =>
      trigger({ id: `trigger_new_${idx}`, name: String(body.name ?? 'New'), ...body }),
    ),
    http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope(agents))),
  )
  return { collection }
}

function listEnvelope<T>(data: T[]) {
  return { data, pagination: { limit: 50, hasMore: false, nextCursor: null } }
}

function agent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({
    skills: [],
    allowedTools: [],
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  })
}

function environment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({
    networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  })
}

// ─── formatInterval ──────────────────────────────────────────────────────────

describe('[spec: triggers/console-list] formatInterval', () => {
  it('formats day, hour, minute, and second intervals', () => {
    expect(formatInterval(86400)).toBe('every 1d')
    expect(formatInterval(7200)).toBe('every 2h')
    expect(formatInterval(300)).toBe('every 5m')
    expect(formatInterval(45)).toBe('every 45s')
  })
})

// ─── TriggersView ────────────────────────────────────────────────────────────

describe('[spec: triggers/console-list] TriggersView', () => {
  it('explains the empty state when no triggers exist', () => {
    render(
      <MemoryRouter>
        <TriggersView
          triggers={[]}
          pagination={pagination<Trigger>([])}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No triggers')).toBeTruthy()
    expect(screen.getByText(/Schedule a trigger to dispatch an agent/)).toBeTruthy()
  })

  it('renders rows with name, agent, schedule, status, and a pause action when active', () => {
    const triggers = [trigger()]
    const triggerAgent = agent({ name: 'Research agent' })
    render(
      <MemoryRouter>
        <TriggersView
          triggers={triggers}
          pagination={pagination(triggers)}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onDelete={vi.fn()}
          agentById={new Map([[triggerAgent.metadata.uid, triggerAgent]])}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Daily research heartbeat' }).getAttribute('href')).toBe(
      '/triggers/trigger_1',
    )
    expect(screen.getByText('Research agent')).toBeTruthy()
    expect(screen.getByText('agent_1')).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: 'Research agent agent_1. Provider/model: workers-ai / @cf/moonshotai/kimi-k2.6',
      }),
    ).toBeTruthy()
    expect(screen.getByText('every 1d')).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pause trigger' })).toBeTruthy()
  })

  it('renders a resume action and paused status when suspended', () => {
    const triggers = [trigger({ suspend: true })]
    render(
      <MemoryRouter>
        <TriggersView
          triggers={triggers}
          pagination={pagination(triggers)}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('paused')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Resume trigger' })).toBeTruthy()
  })

  it('shows an em dash when the trigger has never dispatched', () => {
    const triggers = [trigger({ lastDispatchedAt: null })]
    render(
      <MemoryRouter>
        <TriggersView
          triggers={triggers}
          pagination={pagination(triggers)}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('—')).toBeTruthy()
  })

  it('shows HTTP triggers without schedule timing', () => {
    const triggers = [trigger({ source: { type: 'http' }, nextDueAt: null })]
    render(
      <MemoryRouter>
        <TriggersView
          triggers={triggers}
          pagination={pagination(triggers)}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('HTTP POST')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('calls onPause when the pause button is clicked', () => {
    const onPause = vi.fn()
    const triggers = [trigger()]
    render(
      <MemoryRouter>
        <TriggersView
          triggers={triggers}
          pagination={pagination(triggers)}
          onPause={onPause}
          onResume={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Pause trigger' }))
    expect(onPause).toHaveBeenCalledWith('trigger_1')
  })

  it('calls onResume when the resume button is clicked', () => {
    const onResume = vi.fn()
    const triggers = [trigger({ suspend: true })]
    render(
      <MemoryRouter>
        <TriggersView
          triggers={triggers}
          pagination={pagination(triggers)}
          onPause={vi.fn()}
          onResume={onResume}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Resume trigger' }))
    expect(onResume).toHaveBeenCalledWith('trigger_1')
  })

  it('calls onDelete only after the destructive delete is confirmed', async () => {
    const onDelete = vi.fn()
    const triggers = [trigger()]
    render(
      <MemoryRouter>
        <TriggersView
          triggers={triggers}
          pagination={pagination(triggers)}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete trigger' }))
    expect(onDelete).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Delete trigger?')).toBeTruthy())
    const confirmBtns = screen.getAllByRole('button', { name: 'Delete trigger', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('trigger_1'))
  })

  it('paginates correctly with multiple triggers', () => {
    const triggers = Array.from({ length: 11 }, (_, i) => trigger({ id: `trigger_${i + 1}`, name: `Trigger ${i + 1}` }))

    function Harness() {
      const pag = useClientPagination(triggers)
      return (
        <MemoryRouter>
          <TriggersView triggers={pag.items} pagination={pag} onPause={vi.fn()} onResume={vi.fn()} onDelete={vi.fn()} />
        </MemoryRouter>
      )
    }

    render(<Harness />)
    expect(screen.getByText('1-10 of 11')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('11-11 of 11')).toBeTruthy()
  })
})

// ─── TriggersPage ────────────────────────────────────────────────────────────

describe('[spec: triggers/console-page] TriggersPage', () => {
  function renderPage(triggers: Trigger[] = [], initialPath = '/', agents: Agent[] = [agent()]) {
    setupTriggerHandlers(triggers, agents)
    const client = makeQueryClient()
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders the page header and filter controls', () => {
    renderPage()
    expect(screen.getByText('Triggers')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search triggers' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeTruthy()
  })

  it('renders trigger rows after data loads', async () => {
    renderPage([trigger()])
    expect(await screen.findByText('Daily research heartbeat')).toBeTruthy()
  })

  it('shows the empty state when no triggers are returned', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('No triggers')).toBeTruthy())
  })

  it('filters triggers by search text matching name', async () => {
    renderPage([
      trigger({ id: 'trigger_1', name: 'Alpha trigger', agentId: 'agent_a' }),
      trigger({ id: 'trigger_2', name: 'Beta trigger', agentId: 'agent_b' }),
    ])
    await screen.findByText('Alpha trigger')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search triggers' }), { target: { value: 'Alpha' } })

    expect(screen.getByText('Alpha trigger')).toBeTruthy()
    expect(screen.queryByText('Beta trigger')).toBeNull()
  })

  it('filters triggers by agent name', async () => {
    renderPage(
      [
        trigger({ id: 'trigger_1', name: 'Alpha trigger', agentId: 'agent_a' }),
        trigger({ id: 'trigger_2', name: 'Beta trigger', agentId: 'agent_b' }),
      ],
      '/',
      [agent({ id: 'agent_a', name: 'Research agent' }), agent({ id: 'agent_b', name: 'Review agent' })],
    )
    await screen.findByText('Alpha trigger')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search triggers' }), { target: { value: 'Review' } })

    expect(screen.queryByText('Alpha trigger')).toBeNull()
    expect(screen.getByText('Beta trigger')).toBeTruthy()
    expect(screen.getByText('Review agent')).toBeTruthy()
  })

  it('filters triggers to paused when status=paused is set', async () => {
    renderPage(
      [
        trigger({ id: 'trigger_on', name: 'Active trigger', suspend: false }),
        trigger({ id: 'trigger_off', name: 'Paused trigger', suspend: true }),
      ],
      '/?status=paused',
    )

    expect(await screen.findByText('Paused trigger')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Active trigger')).toBeNull())
  })

  it('pauses a trigger via PATCH suspend:true when the pause action is clicked', async () => {
    let patchedBody: Record<string, unknown> | null = null
    const collection = createCollection<Trigger>([trigger()])
    server.use(
      http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope([agent()]))),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: collection.list(), pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.patch('*/api/v1/triggers/:id', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ suspend: true }))
      }),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Pause trigger' }))
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect((patchedBody!.spec as { suspend: boolean }).suspend).toBe(true)
  })
})

// ─── useTriggerActions ───────────────────────────────────────────────────────

describe('[spec: triggers/actions] useTriggerActions', () => {
  function ActionHarness({ onReady }: { onReady: (actions: ReturnType<typeof useTriggerActions>) => void }) {
    const actions = useTriggerActions()
    onReady(actions)
    return null
  }

  it('calls PATCH /triggers/:id with suspend:true when pauseTrigger is invoked', async () => {
    let patchedUrl = ''
    let patchedBody: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/v1/triggers/:id', async ({ request }) => {
        patchedUrl = request.url
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ suspend: true }))
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    let capturedActions: ReturnType<typeof useTriggerActions> | null = null
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness
            onReady={(a) => {
              capturedActions = a
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    capturedActions!.pauseTrigger('trigger_1')
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect((patchedBody!.spec as { suspend: boolean }).suspend).toBe(true)
    expect(patchedUrl).toContain('trigger_1')
  })

  it('calls PATCH /triggers/:id with suspend:false when resumeTrigger is invoked', async () => {
    let patchedBody: Record<string, unknown> | null = null
    server.use(
      http.patch('*/api/v1/triggers/:id', async ({ request }) => {
        patchedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ suspend: false }))
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    let capturedActions: ReturnType<typeof useTriggerActions> | null = null
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness
            onReady={(a) => {
              capturedActions = a
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    capturedActions!.resumeTrigger('trigger_1')
    await waitFor(() => expect(patchedBody).not.toBeNull())
    expect((patchedBody!.spec as { suspend: boolean }).suspend).toBe(false)
  })

  it('calls DELETE /triggers/:id when deleteTrigger is invoked [spec: triggers/delete]', async () => {
    let deletedUrl = ''
    let deletedMethod = ''
    server.use(
      http.delete('*/api/v1/triggers/:id', ({ request }) => {
        deletedUrl = request.url
        deletedMethod = request.method
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const client = makeQueryClient()
    let capturedActions: ReturnType<typeof useTriggerActions> | null = null
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness
            onReady={(a) => {
              capturedActions = a
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    capturedActions!.deleteTrigger('trigger_1')
    await waitFor(() => expect(deletedMethod).toBe('DELETE'))
    expect(deletedUrl).toContain('trigger_1')
  })

  function renderActions() {
    const client = makeQueryClient()
    let captured: ReturnType<typeof useTriggerActions> | null = null
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness
            onReady={(a) => {
              captured = a
            }}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return () => captured!
  }

  it('toasts an error when pauseTrigger fails', async () => {
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    server.use(http.patch('*/api/v1/triggers/:id', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))
    const actions = renderActions()
    actions().pauseTrigger('trigger_1')
    await waitFor(() => expect(errorSpy).toHaveBeenCalled())
    errorSpy.mockRestore()
  })

  it('toasts an error when resumeTrigger fails', async () => {
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    server.use(http.patch('*/api/v1/triggers/:id', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))
    const actions = renderActions()
    actions().resumeTrigger('trigger_1')
    await waitFor(() => expect(errorSpy).toHaveBeenCalled())
    errorSpy.mockRestore()
  })

  it('toasts an error when deleteTrigger fails', async () => {
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    server.use(http.delete('*/api/v1/triggers/:id', () => HttpResponse.json({ error: 'boom' }, { status: 500 })))
    const actions = renderActions()
    actions().deleteTrigger('trigger_1')
    await waitFor(() => expect(errorSpy).toHaveBeenCalled())
    errorSpy.mockRestore()
  })
})

// ─── CreateTriggerSheet ──────────────────────────────────────────────────────

describe('[spec: triggers/create] CreateTriggerSheet', () => {
  it('posts the trigger with the required fields when the form is submitted', async () => {
    let postedBody: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope([agent()]))),
      http.get('*/api/v1/environments', () => HttpResponse.json(listEnvelope([environment()]))),
      http.post('*/api/v1/triggers', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ id: 'trigger_new' }), { status: 201 })
      }),
    )

    const onOpenChange = vi.fn()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateTriggerSheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Nightly research' } })
    fireEvent.change(screen.getByLabelText('Prompt template'), { target: { value: 'Research the latest offers.' } })
    fireEvent.change(screen.getByLabelText('Interval value'), { target: { value: '6' } })

    // The submit enables only once the agent/environment selects auto-fill from the loaded lists.
    const submitButton = screen.getByRole('button', { name: /create trigger/i })
    await waitFor(() => expect((submitButton as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(submitButton)

    await waitFor(() => expect(postedBody).not.toBeNull())
    expect(postedBody).toMatchObject({
      metadata: { name: 'Nightly research' },
      spec: {
        suspend: false,
        source: { type: 'schedule', schedule: { type: 'interval', intervalSeconds: 6 * 86400 } },
        template: {
          spec: {
            agentId: 'agent_1',
            environmentId: 'env_1',
            runtime: 'ama',
            promptTemplate: 'Research the latest offers.',
          },
        },
      },
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  function stubPointerEvents() {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: vi.fn(() => false),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
    })
  }

  function renderSheet(
    extraHandlers: Parameters<typeof server.use>[0][] = [],
    resources: { agents?: Agent[]; environments?: Environment[] } = {},
  ) {
    server.use(
      http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope(resources.agents ?? [agent()]))),
      http.get('*/api/v1/environments', () =>
        HttpResponse.json(listEnvelope(resources.environments ?? [environment()])),
      ),
      ...extraHandlers,
    )
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateTriggerSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  async function waitForFormReady() {
    const submitButton = screen.getByRole('button', { name: /create trigger/i })
    await waitFor(() => expect((submitButton as HTMLButtonElement).disabled).toBe(false))
    return submitButton
  }

  async function fillRequiredFields() {
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My trigger' } })
    fireEvent.change(screen.getByLabelText('Prompt template'), { target: { value: 'Do the thing.' } })
    fireEvent.change(screen.getByLabelText('Interval value'), { target: { value: '5' } })
    return waitForFormReady()
  }

  it('opens and updates the agent and environment selects', async () => {
    stubPointerEvents()
    let postedBody: Record<string, unknown> | null = null
    renderSheet(
      [
        http.post('*/api/v1/triggers', async ({ request }) => {
          postedBody = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(trigger({ id: 'trigger_new' }), { status: 201 })
        }),
      ],
      {
        agents: [agent(), agent({ id: 'agent_2', name: 'Review agent' })],
        environments: [environment(), environment({ id: 'env_2', name: 'Review environment' })],
      },
    )
    const submitButton = await fillRequiredFields()

    const agentSelect = screen.getByRole('combobox', { name: 'Agent' }) as HTMLElement
    agentSelect.focus()
    fireEvent.pointerDown(agentSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(agentSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'Review agent' }))

    const environmentSelect = screen.getByRole('combobox', { name: 'Environment' }) as HTMLElement
    environmentSelect.focus()
    fireEvent.pointerDown(environmentSelect, { button: 0, ctrlKey: false, pointerId: 2, pointerType: 'mouse' })
    fireEvent.mouseDown(environmentSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'Review environment' }))

    fireEvent.click(submitButton)
    await waitFor(() => expect(postedBody).not.toBeNull())
    expect(postedBody).toMatchObject({
      spec: {
        template: {
          spec: {
            agentId: 'agent_2',
            environmentId: 'env_2',
          },
        },
      },
    })
  })

  it('shows empty agent and environment menu states when the current project has no resources', async () => {
    stubPointerEvents()
    renderSheet([], { agents: [], environments: [] })

    expect(await screen.findByText('No active agents exist in the current project.')).toBeInTheDocument()
    expect(await screen.findByText('No active environments exist in the current project.')).toBeInTheDocument()

    const agentSelect = screen.getByRole('combobox', { name: 'Agent' }) as HTMLElement
    agentSelect.focus()
    fireEvent.pointerDown(agentSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(agentSelect)
    expect(await screen.findByText('No options')).toBeInTheDocument()
    fireEvent.keyDown(agentSelect, { key: 'Escape' })

    const environmentSelect = screen.getByRole('combobox', { name: 'Environment' }) as HTMLElement
    environmentSelect.focus()
    fireEvent.pointerDown(environmentSelect, { button: 0, ctrlKey: false, pointerId: 2, pointerType: 'mouse' })
    fireEvent.mouseDown(environmentSelect)
    expect(await screen.findByText('No options')).toBeInTheDocument()
  })

  it('toasts an error when the create mutation fails', async () => {
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => 'toast-id')
    renderSheet([http.post('*/api/v1/triggers', () => HttpResponse.json({ error: 'boom' }, { status: 500 }))])
    const submitButton = await fillRequiredFields()
    fireEvent.click(submitButton)
    await waitFor(() => expect(errorSpy).toHaveBeenCalled())
    errorSpy.mockRestore()
  })

  it('sends intervalSeconds=60 when intervalValue is 0 (fallback to minimum)', async () => {
    let postedBody: Record<string, unknown> | null = null
    renderSheet([
      http.post('*/api/v1/triggers', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ id: 'trigger_new' }), { status: 201 })
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    ])

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Zero interval trigger' } })
    fireEvent.change(screen.getByLabelText('Prompt template'), { target: { value: 'Do the thing.' } })
    // Set intervalValue to '0' — below 1, triggers the MIN_INTERVAL_SECONDS fallback
    fireEvent.change(screen.getByLabelText('Interval value'), { target: { value: '0' } })

    // Wait for agents/envs to auto-fill, then submit the form directly to bypass
    // the native number input min=1 constraint that jsdom enforces on button click
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /create trigger/i }) as HTMLButtonElement).disabled).toBe(false),
    )
    const form = screen.getByRole('button', { name: /create trigger/i }).closest('form') as HTMLFormElement
    fireEvent.submit(form)

    await waitFor(() => expect(postedBody).not.toBeNull())
    const schedule = (postedBody!.spec as { source: { schedule: Record<string, unknown> } }).source.schedule
    expect(schedule.intervalSeconds).toBe(60)
  })

  it('posts an HTTP trigger without schedule timing', async () => {
    stubPointerEvents()
    let postedBody: Record<string, unknown> | null = null
    renderSheet([
      http.post('*/api/v1/triggers', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ id: 'trigger_new', source: { type: 'http' }, nextDueAt: null }), {
          status: 201,
        })
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    ])

    const typeSelect = screen.getByRole('combobox', { name: 'Trigger type' }) as HTMLElement
    typeSelect.focus()
    fireEvent.pointerDown(typeSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(typeSelect)
    fireEvent.keyDown(typeSelect, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'HTTP POST' }))

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Webhook trigger' } })
    fireEvent.change(screen.getByLabelText('Prompt template'), {
      target: { value: 'Handle {{ body.ticket.id }}' },
    })
    const submitButton = await waitForFormReady()
    fireEvent.click(submitButton)

    await waitFor(() => expect(postedBody).not.toBeNull())
    expect(postedBody).toMatchObject({
      metadata: { name: 'Webhook trigger' },
      spec: {
        source: { type: 'http' },
        template: { spec: { promptTemplate: 'Handle {{ body.ticket.id }}' } },
      },
    })
  })

  it('updates the runtime when a different runtime is selected', async () => {
    stubPointerEvents()
    let postedBody: Record<string, unknown> | null = null
    renderSheet([
      http.post('*/api/v1/triggers', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ id: 'trigger_new' }), { status: 201 })
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    ])
    const submitButton = await fillRequiredFields()

    // Runtime is the 4th combobox in the DOM (Type=0, Agent=1, Environment=2, Runtime=3)
    const runtimeSelect = screen.getAllByRole('combobox')[3] as HTMLElement
    runtimeSelect.focus()
    fireEvent.pointerDown(runtimeSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(runtimeSelect)
    fireEvent.keyDown(runtimeSelect, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Codex' }))

    fireEvent.click(submitButton)
    await waitFor(() => expect(postedBody).not.toBeNull())
    expect((postedBody!.spec as { template: { spec: { runtime: string } } }).template.spec.runtime).toBe('codex')
  })

  it('[spec: triggers/create] locks and submits the selected Agent Identity Runtime', async () => {
    let postedBody: Record<string, unknown> | null = null
    renderSheet(
      [
        http.post('*/api/v1/triggers', async ({ request }) => {
          postedBody = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(trigger({ id: 'trigger_identity', runtime: 'codex' }), { status: 201 })
        }),
      ],
      {
        agents: [
          agent({
            identity: {
              identityId: 'identity_codex',
              agentId: 'realmroot_agent_1',
              issuer: 'https://id.realmroot.dev/api/auth',
              subject: 'agent:realmroot_agent_1',
              username: 'codex-operator',
              runtime: 'codex',
            },
          }),
        ],
      },
    )
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Identity trigger' } })
    fireEvent.change(screen.getByLabelText('Prompt template'), { target: { value: 'Run as the Realmroot identity.' } })

    expect(await screen.findByText("Locked by codex-operator's Identity.")).toBeTruthy()
    const runtimeSelect = screen.getAllByRole('combobox')[3] as HTMLButtonElement
    expect(runtimeSelect.disabled).toBe(true)
    expect(runtimeSelect.textContent).toContain('Codex')
    fireEvent.submit(screen.getByRole('button', { name: /create trigger/i }).closest('form') as HTMLFormElement)

    await waitFor(() => expect(postedBody).not.toBeNull())
    expect(postedBody).toMatchObject({ spec: { template: { spec: { runtime: 'codex' } } } })
  })

  it('updates intervalUnit when a different unit is selected', async () => {
    stubPointerEvents()
    let postedBody: Record<string, unknown> | null = null
    renderSheet([
      http.post('*/api/v1/triggers', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ id: 'trigger_new' }), { status: 201 })
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    ])

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Hourly trigger' } })
    fireEvent.change(screen.getByLabelText('Prompt template'), { target: { value: 'Do the thing.' } })
    fireEvent.change(screen.getByLabelText('Interval value'), { target: { value: '2' } })
    const submitButton = await waitForFormReady()

    // Interval unit select has aria-label="Interval unit"
    const intervalUnitSelect = screen.getByRole('combobox', { name: 'Interval unit' }) as HTMLElement
    intervalUnitSelect.focus()
    fireEvent.pointerDown(intervalUnitSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(intervalUnitSelect)
    fireEvent.keyDown(intervalUnitSelect, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'hours' }))

    fireEvent.click(submitButton)
    await waitFor(() => expect(postedBody).not.toBeNull())
    const schedule = (postedBody!.spec as { source: { schedule: Record<string, unknown> } }).source.schedule
    // 2 hours = 2 * 3600 = 7200
    expect(schedule.intervalSeconds).toBe(7200)
  })

  it('sends suspend:true when status is changed to paused', async () => {
    stubPointerEvents()
    let postedBody: Record<string, unknown> | null = null
    renderSheet([
      http.post('*/api/v1/triggers', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(trigger({ id: 'trigger_new' }), { status: 201 })
      }),
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    ])
    const submitButton = await fillRequiredFields()

    // Status select has aria-label="Status"
    const statusSelect = screen.getByRole('combobox', { name: 'Status' }) as HTMLElement
    statusSelect.focus()
    fireEvent.pointerDown(statusSelect, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(statusSelect)
    fireEvent.keyDown(statusSelect, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'paused' }))

    fireEvent.click(submitButton)
    await waitFor(() => expect(postedBody).not.toBeNull())
    expect((postedBody!.spec as { suspend: boolean }).suspend).toBe(true)
  })
})

// ─── TriggersPage — Create trigger button ────────────────────────────────────

describe('[spec: triggers/console-page] TriggersPage create trigger button', () => {
  it('opens the CreateTriggerSheet when the Create trigger button is clicked', async () => {
    server.use(
      http.get('*/api/v1/triggers', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/agents', () => HttpResponse.json(listEnvelope([agent()]))),
      http.get('*/api/v1/environments', () => HttpResponse.json(listEnvelope([environment()]))),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TriggersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /create trigger/i }))
    expect(await screen.findByText('Create Trigger')).toBeTruthy()
  })
})
