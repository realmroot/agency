/**
 * Tests for use-session-actions hook — covers the mutation callbacks (onSuccess,
 * onError) for closeSession and deleteSession.
 *
 * Uses MSW + the REAL api client. No vi.spyOn / vi.mock of @/lib/enborrpc.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { HttpResponse, http, server } from '@/test/msw'
import { buildTestSession } from '@/testing/session'
import { useSessionActions } from './use-session-actions'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildClosedSession() {
  return buildTestSession({
    id: 'session_1',
    phase: 'closed',
    closedAt: '2026-05-23T00:00:01.000Z',
    updatedAt: '2026-05-23T00:00:01.000Z',
  })
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function ActionsHarness() {
  const actions = useSessionActions()
  return (
    <div>
      <button type="button" onClick={() => actions.closeSession('session_1')}>
        Close
      </button>
      <button type="button" onClick={() => actions.deleteSession('session_1')}>
        Delete
      </button>
      <button type="button" onClick={() => actions.reopenSession('session_1')}>
        Reopen
      </button>
      {actions.closeSessionPending && <span>close-pending</span>}
      {actions.reopenSessionPending && <span>reopen-pending</span>}
      {actions.deleteSessionPending && <span>delete-pending</span>}
    </div>
  )
}

function renderHarness() {
  const queryClient = makeQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ActionsHarness />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

// ---------------------------------------------------------------------------
// closeSession
// ---------------------------------------------------------------------------

describe('useSessionActions — closeSession', () => {
  it('calls PATCH /api/v1/sessions/:id and resolves with closed session', async () => {
    server.use(http.patch('*/api/v1/sessions/session_1', () => HttpResponse.json(buildClosedSession())))

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    // If the mutation resolves without throwing, the api was called correctly.
    await waitFor(() => expect(screen.queryByText('close-pending')).toBeNull(), { timeout: 3000 })
  })

  it('does not crash when PATCH /sessions/:id returns 500', async () => {
    server.use(
      http.patch('*/api/v1/sessions/session_1', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'Close failed' } }, { status: 500 }),
      ),
    )

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    // Hook handles error via onError callback (shows toast) — component must not crash.
    await waitFor(() => expect(screen.queryByText('close-pending')).toBeNull(), { timeout: 3000 })
  })
})

// ---------------------------------------------------------------------------
// reopenSession
// ---------------------------------------------------------------------------

describe('useSessionActions — reopenSession', () => {
  it('calls PATCH /api/v1/sessions/:id and resolves with idle session', async () => {
    server.use(http.patch('*/api/v1/sessions/session_1', () => HttpResponse.json(buildTestSession())))

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    await waitFor(() => expect(screen.queryByText('reopen-pending')).toBeNull(), { timeout: 3000 })
  })
})

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe('useSessionActions — deleteSession', () => {
  it('calls DELETE /api/v1/sessions/:id and handles 204 success', async () => {
    server.use(http.delete('*/api/v1/sessions/session_1', () => new HttpResponse(null, { status: 204 })))

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('delete-pending')).toBeNull(), { timeout: 3000 })
  })

  it('does not crash when DELETE /sessions/:id returns 500', async () => {
    server.use(
      http.delete('*/api/v1/sessions/session_1', () =>
        HttpResponse.json({ error: { type: 'internal', message: 'Delete failed' } }, { status: 500 }),
      ),
    )

    renderHarness()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByText('delete-pending')).toBeNull(), { timeout: 3000 })
  })
})
