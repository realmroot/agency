import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { ClientPagination } from '@/console/use-client-pagination'
import { McpView } from '@/features/mcp/McpView'
import type { Connector } from '@/lib/amarpc'

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

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'github',
    name: 'GitHub',
    description: 'Repository access',
    category: 'development',
    trustLevel: 'verified',
    capabilities: ['repo'],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: ['credential'],
    tools: [
      {
        name: 'repo.read',
        description: 'Read repository',
        inputSchema: {},
        approvalMode: 'project_policy',
        policyMetadata: {},
      },
    ],
    metadata: {},
    availability: 'available',
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

describe('resource list UI contracts [spec: web-console/resource-lists]', () => {
  it('renders MCP catalog rows with identity and description separated', () => {
    const connectors = [connector()]
    render(
      <MemoryRouter>
        <McpView connectors={connectors} connectorPagination={pagination(connectors)} />
      </MemoryRouter>,
    )

    const connectorCell = screen.getByText('GitHub').closest('td')
    expect(connectorCell).toBeTruthy()
    expect(within(connectorCell as HTMLElement).getByText('github')).toBeTruthy()
    const description = screen.getByRole('button', { name: 'Repository access' })
    expect(description.closest('td')).not.toBe(connectorCell)
    expect(screen.getAllByText('1-1 of 1')).toHaveLength(1)
  })
})
