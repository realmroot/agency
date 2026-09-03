/**
 * AgentsView — pure component tests (no API, no MSW needed).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Agent } from '@/lib/enborrpc'
import { type AgentOverrides, agent as resourceAgent } from '@/test/resource-fixtures'
import { AgentsView } from './AgentsView'

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ createdAt: now, updatedAt: now, ...overrides })
}

function buildPagination<T>(items: T[]): ClientPagination<T> {
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

describe('[spec: agents/console-list] AgentsView', () => {
  it('renders empty state when no agents', () => {
    render(
      <MemoryRouter>
        <AgentsView agents={[]} pagination={buildPagination([])} onCreateSession={vi.fn()} onDelete={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('No agents')).toBeInTheDocument()
  })

  it('renders a table row per agent with name, status, model, skills, tools, and version', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Coding agent')).toBeInTheDocument()
    expect(screen.getByText('workers-ai / @cf/moonshotai/kimi-k2.6')).toBeInTheDocument()
    expect(screen.getByText('ama@coding-agent')).toBeInTheDocument()
    expect(screen.getByText('read, write')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
  })

  it('renders agent id as description when description is null', () => {
    const agent = buildAgent({ description: null })
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('agent_1')).toBeInTheDocument()
  })

  it('renders agent description when provided', () => {
    const agent = buildAgent({ description: 'Does stuff' })
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Does stuff')).toBeInTheDocument()
  })

  it('calls onCreateSession with agent id when Create session button is clicked', () => {
    const onCreateSession = vi.fn()
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={onCreateSession}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
    expect(onCreateSession).toHaveBeenCalledWith('agent_1')
  })

  it('renders None for skills and tools when both are empty', () => {
    const agent = buildAgent({ skills: [], allowedTools: [] })
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )
    const nones = screen.getAllByText('None')
    expect(nones.length).toBeGreaterThanOrEqual(2)
  })

  it('renders model as None/None when providerId and model are null', () => {
    const agent = buildAgent({ provider: null, model: null })
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('None / None')).toBeInTheDocument()
  })

  it('calls onDelete with agent id when delete confirm dialog is confirmed', async () => {
    const onDelete = vi.fn()
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentsView
          agents={[agent]}
          pagination={buildPagination([agent])}
          onCreateSession={vi.fn()}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    )
    const deleteButton = screen.getByRole('button', { name: 'Delete agent' })
    fireEvent.click(deleteButton)
    const confirmButtons = await screen.findAllByRole('button', { name: 'Delete agent' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!)
    expect(onDelete).toHaveBeenCalledWith('agent_1')
  })
})
