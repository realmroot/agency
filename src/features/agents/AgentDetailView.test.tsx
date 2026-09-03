/**
 * AgentDetailView — pure component tests (no API, no MSW needed).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Agent, AgentVersion, Session, SessionAgentSnapshot } from '@/lib/enborrpc'
import {
  type AgentOverrides,
  type AgentVersionOverrides,
  agent as resourceAgent,
  agentVersion as resourceAgentVersion,
} from '@/test/resource-fixtures'
import { buildTestSession, type TestSessionOverrides } from '@/testing/session'
import { AgentDetailView } from './AgentDetailView'

const now = '2026-05-23T00:00:00.000Z'

function buildAgent(overrides: AgentOverrides = {}): Agent {
  return resourceAgent({ createdAt: now, updatedAt: now, ...overrides })
}

function buildAgentVersion(overrides: AgentVersionOverrides = {}): AgentVersion {
  return resourceAgentVersion({
    allowedTools: ['read'],
    createdAt: now,
    ...overrides,
  })
}

function buildSessionAgentSnapshot(overrides: Partial<SessionAgentSnapshot> = {}): SessionAgentSnapshot {
  return {
    id: 'agentver_1',
    agentId: 'agent_1',
    projectId: 'project_1',
    version: 1,
    systemPrompt: 'Do the work',
    provider: 'workers-ai',
    model: '@cf/moonshotai/kimi-k2.6',
    skills: [],
    subagents: [],
    allowedTools: ['read', 'bash'],
    mcpConnectors: [],
    identity: null,
    createdAt: now,
    ...overrides,
  }
}

function buildSession(overrides: TestSessionOverrides = {}): Session {
  return buildTestSession({ agentSnapshot: buildSessionAgentSnapshot(), name: 'Test session', ...overrides })
}

describe('[spec: agents/console-detail] AgentDetailView', () => {
  it('renders empty state when agent is null', () => {
    render(
      <MemoryRouter>
        <AgentDetailView agent={null} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Agent not found')).toBeInTheDocument()
  })

  it('renders agent configuration fields without raw runtime JSON', () => {
    const agent = buildAgent({ systemPrompt: 'Act as the project coding agent.' })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Agent configuration')).toBeInTheDocument()
    expect(screen.getByText('workers-ai')).toBeInTheDocument()
    expect(screen.getByText('@cf/moonshotai/kimi-k2.6')).toBeInTheDocument()
    expect(screen.getByText('System prompt')).toBeInTheDocument()
    expect(screen.getByText('Act as the project coding agent.')).toBeInTheDocument()
    expect(screen.getByText('ama@coding-agent')).toBeInTheDocument()
    expect(screen.getByText('read, write')).toBeInTheDocument()
    expect(screen.queryByText(/"systemPrompt"/)).toBeNull()
  })

  it('renders the sessions tab with related sessions', async () => {
    const agent = buildAgent()
    const session = buildSession()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[session]} />
      </MemoryRouter>,
    )
    const sessionsTab = screen.getByRole('tab', { name: 'Sessions' })
    fireEvent.pointerDown(sessionsTab, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(sessionsTab)
    fireEvent.mouseUp(sessionsTab)
    fireEvent.click(sessionsTab)
    await waitFor(() => expect(sessionsTab.getAttribute('data-state')).toBe('active'))
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0)
  })

  it('renders version selector when versions list is non-empty', () => {
    const agent = buildAgent()
    const version = buildAgentVersion()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[version]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getAllByText('v1').length).toBeGreaterThanOrEqual(1)
  })

  it('[spec: agents/identity-binding] renders the selected immutable version Identity without private references', () => {
    const agent = buildAgent()
    const version = buildAgentVersion({
      identity: {
        identityId: 'identity_codex',
        agentId: 'realmroot_agent_1',
        issuer: 'https://id.realmroot.dev/api/auth',
        subject: 'agent:realmroot_agent_1',
        username: 'codex-operator',
        runtime: 'codex',
      },
    })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[version]} sessions={[]} />
      </MemoryRouter>,
    )

    expect(screen.getByText('codex-operator')).toBeInTheDocument()
    expect(screen.getByText('codex')).toBeInTheDocument()
    expect(screen.queryByText(/credentialRef|ama-secret|private_key|access_token/i)).toBeNull()
  })

  it('falls back to agent fields when versions list is empty', () => {
    const agent = buildAgent({ version: 3 })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('v3')).toBeInTheDocument()
  })

  it('renders delete button when onDelete is provided', async () => {
    const onDelete = vi.fn()
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} onDelete={onDelete} />
      </MemoryRouter>,
    )
    const deleteButton = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(deleteButton)
    const confirmBtn = await screen.findByRole('button', { name: 'Delete agent' })
    fireEvent.click(confirmBtn)
    expect(onDelete).toHaveBeenCalledWith('agent_1')
  })

  it('does not render delete button when onDelete is not provided', () => {
    const agent = buildAgent()
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('renders None for skills, allowed tools, and connectors when all are empty', () => {
    const agent = buildAgent({
      skills: [],
      allowedTools: [],
      mcpConnectors: [],
    })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    const nones = screen.getAllByText('None')
    expect(nones.length).toBeGreaterThanOrEqual(3)
  })

  it('renders agent without currentVersionId falling back to agent.id', () => {
    const agent = buildAgent({ currentVersionId: null })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Agent configuration')).toBeInTheDocument()
  })

  it('renders MCP connectors value', () => {
    const agent = buildAgent({ mcpConnectors: ['github-connector'] })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('github-connector')).toBeInTheDocument()
  })

  it('renders allowed tools value when set', () => {
    const agent = buildAgent({ allowedTools: ['read', 'bash'] })
    render(
      <MemoryRouter>
        <AgentDetailView agent={agent} versions={[]} sessions={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('read, bash')).toBeInTheDocument()
  })
})
