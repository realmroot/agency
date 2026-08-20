/**
 * Tests for QuickstartSteps components.
 * Pattern: MSW + real api client, MemoryRouter, screen + fireEvent, .toBeTruthy()/.toBe().
 * QuickstartAgentStep (draft≠null) renders CoreStep which calls useQuery — wrap in
 * QueryClientProvider (retry:false) and add MSW handler for provider models.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { AgentBuilderDraft } from '@/features/agents/agent-builder-model'
import { emptyBuilderDraft } from '@/features/agents/agent-builder-model'
import type { Environment, Provider } from '@/lib/amarpc'
import { HttpResponse, http, server } from '@/test/msw'
import { type EnvironmentOverrides, environment as resourceEnvironment } from '@/test/resource-fixtures'
import {
  OpenPageLink,
  QuickstartAgentStep,
  QuickstartEnvironmentStep,
  QuickstartIntegrationStep,
  QuickstartProviderStep,
} from './QuickstartSteps'
import type { QuickstartEnvironmentForm } from './quickstart-model'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

// ─── Fixtures ───

const now = '2026-05-23T00:00:00.000Z'

function buildProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'workers-ai',
    slug: 'workers-ai',
    displayName: 'Workers AI',
    enabled: true,
    metadata: {},
    modelCatalogState: 'ready',
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({
    networkPolicy: { mode: 'unrestricted' },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
}

const defaultEnvForm: QuickstartEnvironmentForm = {
  name: 'Quickstart environment',
  networkChoice: 'unrestricted',
  allowedHosts: 'registry.npmjs.org',
  mcpAccess: true,
  packageManagerAccess: true,
}

// ─── OpenPageLink ───

describe('OpenPageLink', () => {
  it('renders a link with the given label and href', () => {
    render(
      <MemoryRouter>
        <OpenPageLink to="/settings/providers" label="Open providers" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'Open providers' })
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('/settings/providers')
  })
})

// ─── QuickstartProviderStep ───

describe('QuickstartProviderStep', () => {
  it('renders available providers list', () => {
    render(
      <MemoryRouter>
        <QuickstartProviderStep
          providers={[buildProvider()]}
          onRunDefault={vi.fn()}
          runPending={false}
          onContinue={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Workers AI')).toBeTruthy()
    expect(screen.getByText('workers-ai')).toBeTruthy()
  })

  it('renders empty providers list without error', () => {
    render(
      <MemoryRouter>
        <QuickstartProviderStep providers={[]} onRunDefault={vi.fn()} runPending={false} onContinue={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Run the default Workers AI agent')).toBeTruthy()
  })

  it('shows pending label when runPending is true', () => {
    render(
      <MemoryRouter>
        <QuickstartProviderStep providers={[]} onRunDefault={vi.fn()} runPending={true} onContinue={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Starting Workers AI agent')).toBeTruthy()
  })

  it('calls onRunDefault when the run button is clicked', () => {
    const onRunDefault = vi.fn()
    render(
      <MemoryRouter>
        <QuickstartProviderStep providers={[]} onRunDefault={onRunDefault} runPending={false} onContinue={vi.fn()} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('Run the default Workers AI agent'))
    expect(onRunDefault).toHaveBeenCalledTimes(1)
  })

  it('calls onContinue when Continue is clicked', () => {
    const onContinue = vi.fn()
    render(
      <MemoryRouter>
        <QuickstartProviderStep providers={[]} onRunDefault={vi.fn()} runPending={false} onContinue={onContinue} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('Continue to next step'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('disables run button when runPending is true', () => {
    render(
      <MemoryRouter>
        <QuickstartProviderStep providers={[]} onRunDefault={vi.fn()} runPending={true} onContinue={vi.fn()} />
      </MemoryRouter>,
    )
    const btn = screen.getByText('Starting Workers AI agent').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('renders the provider slug and display name', () => {
    render(
      <MemoryRouter>
        <QuickstartProviderStep
          providers={[buildProvider({ slug: 'anthropic', displayName: 'Anthropic' })]}
          onRunDefault={vi.fn()}
          runPending={false}
          onContinue={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Anthropic')).toBeTruthy()
    expect(screen.getByText('anthropic')).toBeTruthy()
  })
})

// ─── QuickstartEnvironmentStep ───

describe('QuickstartEnvironmentStep', () => {
  it('renders the environment name field with default form values', () => {
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={defaultEnvForm}
          setForm={vi.fn()}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByDisplayValue('Quickstart environment')).toBeTruthy()
    expect(screen.getByText('Create environment')).toBeTruthy()
  })

  it('shows Creating environment label when createPending is true', () => {
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={defaultEnvForm}
          setForm={vi.fn()}
          environments={[]}
          onCreate={vi.fn()}
          createPending={true}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Creating environment')).toBeTruthy()
  })

  it('calls onCreate when Create environment button is clicked', () => {
    const onCreate = vi.fn()
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={defaultEnvForm}
          setForm={vi.fn()}
          environments={[]}
          onCreate={onCreate}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('Create environment'))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('does not show existing-environment select when environments list is empty', () => {
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={defaultEnvForm}
          setForm={vi.fn()}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Use a custom environment')).toBeNull()
  })

  it('shows existing-environment select when active environments exist', () => {
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={defaultEnvForm}
          setForm={vi.fn()}
          environments={[buildEnvironment()]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Use a custom environment')).toBeTruthy()
    expect(screen.getByText('Selecting an existing environment completes this step without changes.')).toBeTruthy()
  })

  it('does not show existing-environment select when all environments are archived', () => {
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={defaultEnvForm}
          setForm={vi.fn()}
          environments={[buildEnvironment({ archivedAt: now })]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Use a custom environment')).toBeNull()
  })

  it('shows restricted-network fields when networkChoice is restricted', () => {
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={{ ...defaultEnvForm, networkChoice: 'restricted' }}
          setForm={vi.fn()}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Allowed hosts')).toBeTruthy()
    expect(screen.getByText('Allow MCP connector access')).toBeTruthy()
    expect(screen.getByText('Allow package-manager registry access')).toBeTruthy()
  })

  it('calls setForm with restricted networkChoice when networking select changes to restricted', () => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { value: vi.fn(() => false), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: vi.fn(), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: vi.fn(), configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true })

    const setForm = vi.fn()
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={{ ...defaultEnvForm, networkChoice: 'unrestricted' }}
          setForm={setForm}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    const trigger = screen.getByRole('combobox', { name: 'Networking' })
    trigger.focus()
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(trigger)
    const restrictedOption = screen.getByRole('option', { name: 'Limited networking' })
    fireEvent.click(restrictedOption)
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ networkChoice: 'restricted' }))
  })

  it('calls setForm with updated allowedHosts when allowed-hosts textarea changes', () => {
    const setForm = vi.fn()
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={{ ...defaultEnvForm, networkChoice: 'restricted' }}
          setForm={setForm}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    const textarea = screen.getByLabelText('Allowed hosts')
    fireEvent.change(textarea, { target: { value: 'example.com' } })
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ allowedHosts: 'example.com' }))
  })

  it('calls setForm with mcpAccess toggled when MCP checkbox is clicked', () => {
    const setForm = vi.fn()
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={{ ...defaultEnvForm, networkChoice: 'restricted', mcpAccess: true }}
          setForm={setForm}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Allow MCP connector access' })
    fireEvent.click(checkbox)
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ mcpAccess: false }))
  })

  it('calls setForm with packageManagerAccess toggled when package-manager checkbox is clicked', () => {
    const setForm = vi.fn()
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={{ ...defaultEnvForm, networkChoice: 'restricted', packageManagerAccess: true }}
          setForm={setForm}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Allow package-manager registry access' })
    fireEvent.click(checkbox)
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ packageManagerAccess: false }))
  })

  it('does not show restricted-network fields when networkChoice is unrestricted', () => {
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={{ ...defaultEnvForm, networkChoice: 'unrestricted' }}
          setForm={vi.fn()}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByText('Allowed hosts')).toBeNull()
  })

  it('disables Create environment button when name is empty', () => {
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={{ ...defaultEnvForm, name: '' }}
          setForm={vi.fn()}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    const btn = screen.getByText('Create environment').closest('button')
    expect(btn?.disabled).toBe(true)
  })

  it('calls setForm with updated name when name field changes', () => {
    const setForm = vi.fn()
    render(
      <MemoryRouter>
        <QuickstartEnvironmentStep
          form={defaultEnvForm}
          setForm={setForm}
          environments={[]}
          onCreate={vi.fn()}
          createPending={false}
          onSelectExisting={vi.fn()}
        />
      </MemoryRouter>,
    )
    const input = screen.getByDisplayValue('Quickstart environment')
    fireEvent.change(input, { target: { value: 'My environment' } })
    expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ name: 'My environment' }))
  })
})

// ─── QuickstartAgentStep ───

describe('QuickstartAgentStep [draft=null — start view]', () => {
  it('shows template/goal entry when draft is null', () => {
    render(
      <MemoryRouter>
        <QuickstartAgentStep
          draft={null}
          goal=""
          setGoal={vi.fn()}
          onDraft={vi.fn()}
          onUseTemplate={vi.fn()}
          onStartFromScratch={vi.fn()}
          onDiscardDraft={vi.fn()}
          setField={vi.fn()}
          errors={{}}
          onCreate={vi.fn()}
          createPending={false}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Open agent builder')).toBeTruthy()
  })

  it('calls onDraft when Draft agent configuration is clicked', () => {
    const onDraft = vi.fn()
    render(
      <MemoryRouter>
        <QuickstartAgentStep
          draft={null}
          goal="Build a coding assistant"
          setGoal={vi.fn()}
          onDraft={onDraft}
          onUseTemplate={vi.fn()}
          onStartFromScratch={vi.fn()}
          onDiscardDraft={vi.fn()}
          setField={vi.fn()}
          errors={{}}
          onCreate={vi.fn()}
          createPending={false}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByText('Draft agent configuration'))
    expect(onDraft).toHaveBeenCalledTimes(1)
  })
})

describe('QuickstartAgentStep [draft≠null — review view]', () => {
  const draft: AgentBuilderDraft = { ...emptyBuilderDraft, name: 'My Agent', systemPrompt: 'Do stuff' }

  // CoreStep inside QuickstartAgentStep calls useQuery for the global model
  // catalog — MSW handles GET /api/v1/providers/models.
  function renderWithClient(props: React.ComponentProps<typeof QuickstartAgentStep>) {
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <QuickstartAgentStep {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('shows Create agent and Back to templates buttons when draft is set', () => {
    renderWithClient({
      draft,
      goal: '',
      setGoal: vi.fn(),
      onDraft: vi.fn(),
      onUseTemplate: vi.fn(),
      onStartFromScratch: vi.fn(),
      onDiscardDraft: vi.fn(),
      setField: vi.fn(),
      errors: {},
      onCreate: vi.fn(),
      createPending: false,
    })
    expect(screen.getByText('Create agent')).toBeTruthy()
    expect(screen.getByText('Back to templates')).toBeTruthy()
  })

  it('shows Creating agent label when createPending is true', () => {
    renderWithClient({
      draft,
      goal: '',
      setGoal: vi.fn(),
      onDraft: vi.fn(),
      onUseTemplate: vi.fn(),
      onStartFromScratch: vi.fn(),
      onDiscardDraft: vi.fn(),
      setField: vi.fn(),
      errors: {},
      onCreate: vi.fn(),
      createPending: true,
    })
    expect(screen.getByText('Creating agent')).toBeTruthy()
  })

  it('calls onCreate when Create agent button is clicked', () => {
    const onCreate = vi.fn()
    renderWithClient({
      draft,
      goal: '',
      setGoal: vi.fn(),
      onDraft: vi.fn(),
      onUseTemplate: vi.fn(),
      onStartFromScratch: vi.fn(),
      onDiscardDraft: vi.fn(),
      setField: vi.fn(),
      errors: {},
      onCreate,
      createPending: false,
    })
    fireEvent.click(screen.getByText('Create agent'))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('calls onDiscardDraft when Back to templates is clicked', () => {
    const onDiscardDraft = vi.fn()
    renderWithClient({
      draft,
      goal: '',
      setGoal: vi.fn(),
      onDraft: vi.fn(),
      onUseTemplate: vi.fn(),
      onStartFromScratch: vi.fn(),
      onDiscardDraft,
      setField: vi.fn(),
      errors: {},
      onCreate: vi.fn(),
      createPending: false,
    })
    fireEvent.click(screen.getByText('Back to templates'))
    expect(onDiscardDraft).toHaveBeenCalledTimes(1)
  })

  it('renders mcpConnectors error when errors.mcpConnectors is set', () => {
    renderWithClient({
      draft: { ...draft, mcpConnectors: [] },
      goal: '',
      setGoal: vi.fn(),
      onDraft: vi.fn(),
      onUseTemplate: vi.fn(),
      onStartFromScratch: vi.fn(),
      onDiscardDraft: vi.fn(),
      setField: vi.fn(),
      errors: { mcpConnectors: 'MCP error occurred' },
      onCreate: vi.fn(),
      createPending: false,
    })
    expect(screen.getByText('MCP error occurred')).toBeTruthy()
  })

  it('renders mcpConnectors list when draft has connectors', () => {
    renderWithClient({
      draft: { ...draft, mcpConnectors: ['connector-a', 'connector-b'] },
      goal: '',
      setGoal: vi.fn(),
      onDraft: vi.fn(),
      onUseTemplate: vi.fn(),
      onStartFromScratch: vi.fn(),
      onDiscardDraft: vi.fn(),
      setField: vi.fn(),
      errors: {},
      onCreate: vi.fn(),
      createPending: false,
    })
    expect(screen.getByText('connector-a, connector-b')).toBeTruthy()
  })

  it('renders None drafted when mcpConnectors is empty', () => {
    renderWithClient({
      draft: { ...draft, mcpConnectors: [] },
      goal: '',
      setGoal: vi.fn(),
      onDraft: vi.fn(),
      onUseTemplate: vi.fn(),
      onStartFromScratch: vi.fn(),
      onDiscardDraft: vi.fn(),
      setField: vi.fn(),
      errors: {},
      onCreate: vi.fn(),
      createPending: false,
    })
    expect(screen.getByText('None drafted')).toBeTruthy()
  })
})

// ─── QuickstartIntegrationStep ───

describe('QuickstartIntegrationStep', () => {
  it('renders placeholder when input is null', () => {
    render(
      <MemoryRouter>
        <QuickstartIntegrationStep input={null} />
      </MemoryRouter>,
    )
    expect(
      screen.getByText('Create a session in the previous step to generate integration examples for it.'),
    ).toBeTruthy()
  })

  it('renders the Realmroot toolbox example when input is provided', () => {
    render(
      <MemoryRouter>
        <QuickstartIntegrationStep
          input={{
            agentId: 'agent_123',
            environmentId: 'env_456',
            sessionId: 'sess_789',
          }}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Realmroot CLI')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open session detail' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open usage' })).toBeTruthy()
  })
})
