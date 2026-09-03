import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { ProviderModel } from '@/lib/enborrpc'
import { HttpResponse, http, server } from '@/test/msw'
import { ProvidersPage } from './ProvidersPage'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function mkClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// ---------------------------------------------------------------------------
// ProvidersPage (global model catalog)
// ---------------------------------------------------------------------------

function buildModel(overrides: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: 'model_1',
    providerId: 'moonshotai',
    modelId: '@cf/moonshotai/kimi-k2.6',
    displayName: 'Kimi K2.6',
    capabilities: ['text', 'tools'],
    contextWindow: 262144,
    pricing: {},
    availability: 'available',
    metadata: {},
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
    ...overrides,
  }
}

function renderProviders() {
  render(
    <QueryClientProvider client={mkClient()}>
      <MemoryRouter>
        <ProvidersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ProvidersPage', () => {
  it('shows the catalog header while loading', () => {
    server.use(http.get('*/api/v1/providers/models', () => new Promise(() => {})))
    renderProviders()
    expect(screen.getByText('Model catalog')).toBeTruthy()
  })

  it('shows the empty state when the catalog has no models', async () => {
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )
    renderProviders()
    await waitFor(() => expect(screen.getByText('No models yet')).toBeTruthy())
  })

  it('renders model rows with model id, vendor, context, and availability', async () => {
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json({
          data: [buildModel()],
          pagination: { limit: 50, hasMore: false, nextCursor: null },
        }),
      ),
    )
    renderProviders()
    await waitFor(() => expect(screen.getByText('@cf/moonshotai/kimi-k2.6')).toBeTruthy())
    expect(screen.getByText('moonshotai')).toBeTruthy()
    expect(screen.getByText('262144')).toBeTruthy()
  })

  it('renders a dash for an unknown context window', async () => {
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json({
          data: [buildModel({ id: 'model_2', contextWindow: null })],
          pagination: { limit: 50, hasMore: false, nextCursor: null },
        }),
      ),
    )
    renderProviders()
    await waitFor(() => expect(screen.getByText('@cf/moonshotai/kimi-k2.6')).toBeTruthy())
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('triggers a catalog refresh when the refresh button is clicked', async () => {
    let refreshed = false
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.post('*/api/v1/providers/refresh', () => {
        refreshed = true
        return HttpResponse.json({ outcome: 'succeeded', discoveredCount: 12, vendors: 3 })
      }),
    )
    renderProviders()
    await waitFor(() => expect(screen.getByText('No models yet')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Refresh catalog/ }))
    await waitFor(() => expect(refreshed).toBe(true))
  })

  it('does not report success when the refresh returns outcome failed', async () => {
    let invalidated = false
    server.use(
      http.get('*/api/v1/providers/models', () => {
        invalidated = true
        return HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } })
      }),
      http.post('*/api/v1/providers/refresh', () =>
        HttpResponse.json({ outcome: 'failed', discoveredCount: 0, vendors: 0, category: 'auth' }),
      ),
    )
    renderProviders()
    await waitFor(() => expect(screen.getByText('No models yet')).toBeTruthy())
    invalidated = false
    fireEvent.click(screen.getByRole('button', { name: /Refresh catalog/ }))
    // A failed outcome must not re-fetch the catalog as if it succeeded.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(invalidated).toBe(false)
  })

  it('surfaces a refresh failure without crashing', async () => {
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.post('*/api/v1/providers/refresh', () =>
        HttpResponse.json({ error: { type: 'internal_error', message: 'boom' } }, { status: 500 }),
      ),
    )
    renderProviders()
    await waitFor(() => expect(screen.getByText('No models yet')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Refresh catalog/ }))
    await waitFor(() => expect(screen.getByText('Model catalog')).toBeTruthy())
  })
})
