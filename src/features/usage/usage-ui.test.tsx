import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { UsageSummary } from '@/lib/enborrpc'
import { HttpResponse, http, server } from '@/test/msw'
import { UsagePage } from './UsagePage'
import { UsageView } from './UsageView'

function buildSummary(overrides: Partial<UsageSummary> = {}): UsageSummary {
  return {
    groupBy: 'provider',
    totals: {
      records: 3,
      promptTokens: 12,
      completionTokens: 5,
      totalTokens: 17,
      durationMs: 160,
      costMicros: 25,
      currency: 'USD',
    },
    groups: [
      {
        key: { provider: 'workers-ai' },
        records: 2,
        promptTokens: 12,
        completionTokens: 5,
        totalTokens: 17,
        durationMs: 150,
        costMicros: 25,
        currency: 'USD',
      },
      {
        key: { provider: 'sandbox' },
        records: 1,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        durationMs: 10,
        costMicros: 0,
        currency: 'USD',
      },
    ],
    ...overrides,
  }
}

// The page reads GET /api/v1/usage-summary through the real api client; MSW serves it.
function usageSummary(summary: UsageSummary | null) {
  return http.get('*/api/v1/usage-summary', () => HttpResponse.json(summary))
}

describe('[spec: usage/console-view] UsageView', () => {
  it('renders grand totals and a row per group', () => {
    render(<UsageView summary={buildSummary()} />)

    expect(screen.getByText('Usage summary')).toBeInTheDocument()
    const records = screen.getByText('Records').closest('div') as HTMLElement
    expect(within(records).getByText('3')).toBeInTheDocument()
    expect(screen.getByText(/"provider": "workers-ai"/)).toBeInTheDocument()
    expect(screen.getByText(/"provider": "sandbox"/)).toBeInTheDocument()
  })

  it('shows an empty state when there is no summary', () => {
    render(<UsageView summary={null} />)

    expect(screen.getByText('No usage summary')).toBeInTheDocument()
  })

  it('shows an empty grouped row when totals exist but no groups do', () => {
    render(<UsageView summary={buildSummary({ groups: [] })} />)

    expect(screen.getByText('Usage summary')).toBeInTheDocument()
    expect(screen.getByText('Grouped usage appears after sessions record provider events.')).toBeInTheDocument()
  })
})

describe('[spec: usage/console-page] UsagePage', () => {
  function renderUsagePage(initialSearch = '') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/usage${initialSearch}`]}>
          <Routes>
            <Route path="/usage" element={<UsagePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders page header and group-by and date filter controls', () => {
    server.use(usageSummary(null))
    renderUsagePage()

    expect(screen.getByText('Usage')).toBeInTheDocument()
    expect(screen.getByLabelText('Group usage by')).toBeInTheDocument()
    expect(screen.getByLabelText('Usage from')).toBeInTheDocument()
    expect(screen.getByLabelText('Usage to')).toBeInTheDocument()
  })

  it('shows no usage summary when the api returns null', async () => {
    server.use(usageSummary(null))
    renderUsagePage()

    expect(await screen.findByText('No usage summary')).toBeInTheDocument()
  })

  it('renders summary data returned by the api', async () => {
    server.use(usageSummary(buildSummary()))
    renderUsagePage()

    expect(await screen.findByText('Usage summary')).toBeInTheDocument()
    expect(screen.getByText(/"provider": "workers-ai"/)).toBeInTheDocument()
  })

  it('updates the date-from filter when the user changes the input', () => {
    server.use(usageSummary(null))
    renderUsagePage()

    const fromInput = screen.getByLabelText('Usage from') as HTMLInputElement
    fireEvent.change(fromInput, { target: { value: '2026-01-01T00:00' } })
    expect(fromInput.value).toBe('2026-01-01T00:00')
  })

  it('updates the date-to filter when the user changes the input', () => {
    server.use(usageSummary(null))
    renderUsagePage()

    const toInput = screen.getByLabelText('Usage to') as HTMLInputElement
    fireEvent.change(toInput, { target: { value: '2026-06-01T00:00' } })
    expect(toInput.value).toBe('2026-06-01T00:00')
  })

  it('pre-populates groupBy from the URL search param', async () => {
    server.use(usageSummary(null))
    renderUsagePage('?groupBy=model')

    await waitFor(() => {
      expect(screen.getByLabelText('Group usage by').textContent).toContain('Model')
    })
  })

  it('pre-populates date filters from the URL search params', () => {
    server.use(usageSummary(null))
    renderUsagePage('?createdFrom=2026-01-01T00%3A00&createdTo=2026-06-01T00%3A00')

    expect((screen.getByLabelText('Usage from') as HTMLInputElement).value).toBe('2026-01-01T00:00')
    expect((screen.getByLabelText('Usage to') as HTMLInputElement).value).toBe('2026-06-01T00:00')
  })
})
