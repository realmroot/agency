import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { MemoryStore, MemoryStoreMemory } from '@/lib/amarpc'
import { createCollection, HttpResponse, http, resourceHandlers, server } from '@/test/msw'
import {
  type MemoryOverrides,
  type MemoryStoreOverrides,
  memoryStore,
  memory as resourceMemory,
} from '@/test/resource-fixtures'
import { MemoryStoreDetailPage } from './MemoryStoreDetailPage'
import { CreateMemoryStoreSheet, MemoryEntrySheet } from './MemoryStoreForms'
import { MemoryStoresPage } from './MemoryStoresPage'

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function store(overrides: MemoryStoreOverrides = {}): MemoryStore {
  return memoryStore({
    id: 'memstore_1',
    name: 'Team memory',
    description: 'Shared runbook',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  })
}

function memory(overrides: MemoryOverrides = {}): MemoryStoreMemory {
  return resourceMemory({
    storeId: 'memstore_1',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  })
}

function renderWithClient(ui: ReactElement, initialEntries = ['/']) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function setupMemoryStoreHandlers(stores: MemoryStore[] = [], memories: MemoryStoreMemory[] = []) {
  const storeCollection = createCollection(stores)
  const memoryCollection = createCollection(memories)
  server.use(
    ...resourceHandlers('memory-stores', storeCollection, (body, index) =>
      store({
        id: `memstore_new_${index}`,
        name: String((body.metadata as { name?: unknown } | undefined)?.name ?? 'New store'),
        description:
          typeof (body.metadata as { description?: unknown } | undefined)?.description === 'string'
            ? String((body.metadata as { description?: unknown }).description)
            : null,
      }),
    ),
    http.get('*/api/v1/memory-stores/:storeId/memories', () =>
      HttpResponse.json({ data: memoryCollection.list(), pagination: { limit: 50, hasMore: false, nextCursor: null } }),
    ),
    http.post('*/api/v1/memory-stores/:storeId/memories', async ({ params, request }) => {
      const body = (await request.json()) as Record<string, unknown>
      return HttpResponse.json(
        memory({
          id: `memory_new_${memoryCollection.items.size}`,
          storeId: String(params.storeId),
          path: String(body.path ?? ''),
          content: String(body.content ?? ''),
        }),
        { status: 201 },
      )
    }),
    http.patch('*/api/v1/memory-stores/:storeId/memories/:memoryId', async ({ params, request }) => {
      const existing = memoryCollection.get(String(params.memoryId)) ?? memory({ id: String(params.memoryId) })
      const patch = (await request.json()) as Record<string, unknown>
      return HttpResponse.json(
        memoryCollection.put({
          ...existing,
          spec: {
            ...existing.spec,
            path: typeof patch.path === 'string' ? patch.path : existing.spec.path,
            content: typeof patch.content === 'string' ? patch.content : existing.spec.content,
          },
        }),
      )
    }),
    http.delete('*/api/v1/memory-stores/:storeId/memories/:memoryId', ({ params }) => {
      memoryCollection.remove(String(params.memoryId))
      return new HttpResponse(null, { status: 204 })
    }),
  )
}

describe('[spec: memory-stores/console] [spec: sessions/memory-store-resources] memory store UI', () => {
  it('renders an empty memory store list', async () => {
    setupMemoryStoreHandlers()
    renderWithClient(<MemoryStoresPage />)
    expect(await screen.findByText('No memory stores')).toBeTruthy()
  })

  it('renders memory stores and opens the create form', async () => {
    setupMemoryStoreHandlers([store()])
    renderWithClient(<MemoryStoresPage />)
    expect(await screen.findByRole('link', { name: 'Team memory' })).toHaveAttribute(
      'href',
      '/memory-stores/memstore_1',
    )
    fireEvent.click(screen.getByRole('button', { name: /Create store/ }))
    expect(await screen.findByText('Create Memory Store')).toBeTruthy()
  })

  it('deletes a memory store from the list', async () => {
    setupMemoryStoreHandlers([store()])
    renderWithClient(<MemoryStoresPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete memory store' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete store' }))
    await waitFor(() => expect(screen.queryByText('Delete memory store?')).toBeNull())
  })

  it('keeps the list visible when delete fails', async () => {
    setupMemoryStoreHandlers([store({ description: null })])
    server.use(
      http.delete('*/api/v1/memory-stores/:storeId', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'Still in use' } }, { status: 409 }),
      ),
    )
    renderWithClient(<MemoryStoresPage />)
    expect(await screen.findByText('memstore_1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete memory store' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete store' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Team memory' })).toBeTruthy())
  })

  it('submits the create memory store form', async () => {
    setupMemoryStoreHandlers()
    const opened: boolean[] = []
    renderWithClient(<CreateMemoryStoreSheet open onOpenChange={(open) => opened.push(open)} />)
    const [nameInput, descriptionInput] = screen.getAllByRole('textbox')
    fireEvent.change(nameInput!, { target: { value: 'Release memory' } })
    fireEvent.change(descriptionInput!, { target: { value: 'Release notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create memory store' }))
    await waitFor(() => expect(opened).toContain(false))
  })

  it('keeps the create sheet open when creation fails', async () => {
    server.use(
      http.post('*/api/v1/memory-stores', () =>
        HttpResponse.json({ error: { type: 'validation', message: 'Name is required' } }, { status: 400 }),
      ),
    )
    const opened: boolean[] = []
    renderWithClient(<CreateMemoryStoreSheet open onOpenChange={(open) => opened.push(open)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create memory store' }))
    await waitFor(() => expect(screen.getByText('Create Memory Store')).toBeTruthy())
    expect(opened).toEqual([])
  })

  it('renders memory store detail and opens the add sheet', async () => {
    setupMemoryStoreHandlers([store()], [memory()])
    renderWithClient(
      <Routes>
        <Route path="/memory-stores/:storeId" element={<MemoryStoreDetailPage />} />
      </Routes>,
      ['/memory-stores/memstore_1'],
    )
    expect(await screen.findByText('Team memory')).toBeTruthy()
    expect(screen.getByText('guides/review.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add memory/ }))
    expect(await screen.findByText('Add Memory')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('Add Memory')).toBeNull())
  })

  it('renders memory files as an explorer and shows selected file content', async () => {
    setupMemoryStoreHandlers(
      [store()],
      [
        memory({ id: 'memory_review', path: 'guides/review.md', content: 'Review checklist' }),
        memory({ id: 'memory_plan', path: 'notes/plan.md', content: 'Planning notes' }),
      ],
    )
    renderWithClient(
      <Routes>
        <Route path="/memory-stores/:storeId" element={<MemoryStoreDetailPage />} />
      </Routes>,
      ['/memory-stores/memstore_1'],
    )

    expect(await screen.findByLabelText('Memory files')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'guides folder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'notes folder' })).toBeTruthy()
    expect(screen.getByText('Review checklist')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'notes/plan.md file' }))

    expect(screen.getByText('notes/plan.md')).toBeTruthy()
    expect(screen.getByText('Planning notes')).toBeTruthy()
  })

  it('renders memory store detail without a route param', () => {
    setupMemoryStoreHandlers([store()], [memory()])
    renderWithClient(<MemoryStoreDetailPage />)
    expect(screen.getByText('Memory store detail')).toBeTruthy()
  })

  it('deletes a memory from the detail page', async () => {
    setupMemoryStoreHandlers([store()], [memory()])
    renderWithClient(
      <Routes>
        <Route path="/memory-stores/:storeId" element={<MemoryStoreDetailPage />} />
      </Routes>,
      ['/memory-stores/memstore_1'],
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Delete memory' }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete memory' })).at(-1)!)
    expect(await screen.findByText('No memories')).toBeTruthy()
  })

  it('keeps memories visible when delete fails', async () => {
    setupMemoryStoreHandlers([store()], [memory()])
    server.use(
      http.delete('*/api/v1/memory-stores/:storeId/memories/:memoryId', () =>
        HttpResponse.json({ error: { type: 'conflict', message: 'In use' } }, { status: 409 }),
      ),
    )
    renderWithClient(
      <Routes>
        <Route path="/memory-stores/:storeId" element={<MemoryStoreDetailPage />} />
      </Routes>,
      ['/memory-stores/memstore_1'],
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Delete memory' }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'Delete memory' })).at(-1)!)
    await waitFor(() => expect(screen.getByText('guides/review.md')).toBeTruthy())
  })

  it('opens the edit sheet from the detail page', async () => {
    setupMemoryStoreHandlers([store()], [memory()])
    renderWithClient(
      <Routes>
        <Route path="/memory-stores/:storeId" element={<MemoryStoreDetailPage />} />
      </Routes>,
      ['/memory-stores/memstore_1'],
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Edit memory' }))
    expect(await screen.findByText('Edit Memory')).toBeTruthy()
  })

  it('submits add and edit memory forms', async () => {
    setupMemoryStoreHandlers([store()], [memory()])
    const closed: boolean[] = []
    const { rerender } = renderWithClient(
      <MemoryEntrySheet storeId="memstore_1" memory={null} open onOpenChange={(open) => closed.push(open)} />,
    )
    fireEvent.change(screen.getByPlaceholderText('guides/review.md'), { target: { value: 'guides/new.md' } })
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'New memory' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save memory' }))
    await waitFor(() => expect(closed).toContain(false))

    rerender(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter>
          <MemoryEntrySheet storeId="memstore_1" memory={memory()} open onOpenChange={(open) => closed.push(open)} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Edit Memory')).toBeTruthy()
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'Updated memory' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save memory' }))
    await waitFor(() => expect(closed.filter((value) => value === false)).toHaveLength(2))
  })

  it('keeps the memory entry sheet open when save fails', async () => {
    server.use(
      http.post('*/api/v1/memory-stores/:storeId/memories', () =>
        HttpResponse.json({ error: { type: 'validation', message: 'Bad path' } }, { status: 400 }),
      ),
    )
    const closed: boolean[] = []
    renderWithClient(
      <MemoryEntrySheet storeId="memstore_1" memory={null} open onOpenChange={(open) => closed.push(open)} />,
    )
    fireEvent.change(screen.getByPlaceholderText('guides/review.md'), { target: { value: 'bad path' } })
    fireEvent.change(screen.getAllByRole('textbox')[1]!, { target: { value: 'New memory' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save memory' }))
    await waitFor(() => expect(screen.getByText('Add Memory')).toBeTruthy())
    expect(closed).toEqual([])
  })
})
