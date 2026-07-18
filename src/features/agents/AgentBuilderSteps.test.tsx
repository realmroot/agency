/**
 * AgentBuilderSteps — component tests.
 * CoreStep fetches /api/v1/providers/:id/models; use MSW for that.
 * All other steps are purely prop-driven.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { Connector, Environment, ProviderModel } from '@/lib/amarpc'
import { HttpResponse, http, server } from '@/test/msw'
import { type EnvironmentOverrides, environment as resourceEnvironment } from '@/test/resource-fixtures'
import { BuilderStepper, CoreStep, SandboxStep, StartStep, TestEnvironmentField, ToolsStep } from './AgentBuilderSteps'
import { emptyBuilderDraft } from './agent-builder-model'

const now = '2026-05-23T00:00:00.000Z'

const listEnvelope = <T,>(data: T[]) => ({
  data,
  pagination: { limit: 50, hasMore: false, nextCursor: null as string | null },
})

function buildConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'connector_1',
    name: 'GitHub connector',
    description: 'Provides GitHub API access',
    category: 'development',
    trustLevel: 'verified',
    capabilities: ['read'],
    supportedAuthModes: ['vault_credential'],
    setupRequirements: [],
    tools: [
      {
        name: 'github.list_repos',
        description: 'List repositories',
        inputSchema: { type: 'object' },
        approvalMode: 'none',
        policyMetadata: {},
      },
    ],
    metadata: {},
    availability: 'available',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildProviderModel(overrides: Partial<ProviderModel> = {}): ProviderModel {
  return {
    id: 'model_1',
    providerId: 'workers-ai',
    modelId: '@cf/moonshotai/kimi-k2.6',
    displayName: 'Kimi K2.6',
    capabilities: [],
    contextWindow: null,
    pricing: {},
    availability: 'available',
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function buildEnvironment(overrides: EnvironmentOverrides = {}): Environment {
  return resourceEnvironment({
    packages: [{ name: 'tsx', version: 'latest' }],
    networkPolicy: { mode: 'restricted', allowedHosts: ['registry.npmjs.org'] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  })
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// ─── BuilderStepper ────────────────────────────────────────────────────────

describe('BuilderStepper', () => {
  it('renders all steps except done when not published', () => {
    render(
      <MemoryRouter>
        <BuilderStepper current="start" published={false} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Goal/)).toBeInTheDocument()
    expect(screen.getByText(/Core settings/)).toBeInTheDocument()
    expect(screen.queryByText(/API examples/)).toBeNull()
  })

  it('renders the done step when published', () => {
    render(
      <MemoryRouter>
        <BuilderStepper current="done" published={true} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/API examples/)).toBeInTheDocument()
  })

  it('marks current step as aria-current=step', () => {
    render(
      <MemoryRouter>
        <BuilderStepper current="core" published={false} />
      </MemoryRouter>,
    )
    const coreLink = screen.getByText(/Core settings/).closest('a')
    expect(coreLink?.getAttribute('aria-current')).toBe('step')
  })

  it('does not mark non-current steps as aria-current', () => {
    render(
      <MemoryRouter>
        <BuilderStepper current="core" published={false} />
      </MemoryRouter>,
    )
    const startLink = screen.getByText(/Goal/).closest('a')
    expect(startLink?.getAttribute('aria-current')).toBeNull()
  })
})

// ─── StartStep ─────────────────────────────────────────────────────────────

describe('StartStep', () => {
  it('renders goal textarea, draft button, skip button, and templates', () => {
    render(
      <MemoryRouter>
        <StartStep goal="" setGoal={vi.fn()} onDraftFromGoal={vi.fn()} onUseTemplate={vi.fn()} onSkip={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draft agent configuration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start from scratch' })).toBeInTheDocument()
    expect(screen.getByText('Coding agent')).toBeInTheDocument()
    expect(screen.getByText('Research assistant')).toBeInTheDocument()
    expect(screen.getByText('Operations triage')).toBeInTheDocument()
  })

  it('disables draft button when goal is empty whitespace', () => {
    render(
      <MemoryRouter>
        <StartStep goal="   " setGoal={vi.fn()} onDraftFromGoal={vi.fn()} onUseTemplate={vi.fn()} onSkip={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Draft agent configuration' })).toBeDisabled()
  })

  it('enables draft button when goal has content', () => {
    render(
      <MemoryRouter>
        <StartStep
          goal="Review PRs"
          setGoal={vi.fn()}
          onDraftFromGoal={vi.fn()}
          onUseTemplate={vi.fn()}
          onSkip={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Draft agent configuration' })).not.toBeDisabled()
  })

  it('calls onDraftFromGoal when draft button is clicked', () => {
    const onDraftFromGoal = vi.fn()
    render(
      <MemoryRouter>
        <StartStep
          goal="Review PRs"
          setGoal={vi.fn()}
          onDraftFromGoal={onDraftFromGoal}
          onUseTemplate={vi.fn()}
          onSkip={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Draft agent configuration' }))
    expect(onDraftFromGoal).toHaveBeenCalledTimes(1)
  })

  it('calls onSkip when start from scratch is clicked', () => {
    const onSkip = vi.fn()
    render(
      <MemoryRouter>
        <StartStep goal="" setGoal={vi.fn()} onDraftFromGoal={vi.fn()} onUseTemplate={vi.fn()} onSkip={onSkip} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start from scratch' }))
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('calls onUseTemplate with the coding template when first Use template is clicked', () => {
    const onUseTemplate = vi.fn()
    render(
      <MemoryRouter>
        <StartStep goal="" setGoal={vi.fn()} onDraftFromGoal={vi.fn()} onUseTemplate={onUseTemplate} onSkip={vi.fn()} />
      </MemoryRouter>,
    )
    const useBtns = screen.getAllByRole('button', { name: 'Use template' })
    fireEvent.click(useBtns[0]!)
    expect(onUseTemplate).toHaveBeenCalledTimes(1)
    expect(onUseTemplate.mock.calls[0]![0].id).toBe('coding')
  })

  it('calls setGoal when typing in the textarea', () => {
    const setGoal = vi.fn()
    render(
      <MemoryRouter>
        <StartStep goal="" setGoal={setGoal} onDraftFromGoal={vi.fn()} onUseTemplate={vi.fn()} onSkip={vi.fn()} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Build a review agent' } })
    expect(setGoal).toHaveBeenCalledWith('Build a review agent')
  })
})

// ─── CoreStep ──────────────────────────────────────────────────────────────

describe('CoreStep', () => {
  function renderCoreStep(props: Partial<Parameters<typeof CoreStep>[0]> = {}, models: ProviderModel[] = []) {
    server.use(http.get('*/api/v1/providers/models', () => HttpResponse.json(listEnvelope(models))))
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoreStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} {...props} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('renders name, description, system prompt, and model fields', () => {
    renderCoreStep()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
    expect(screen.getByLabelText('System prompt')).toBeInTheDocument()
    expect(screen.getByLabelText('Model')).toBeInTheDocument()
  })

  it('renders provider error when errors.provider is set', () => {
    renderCoreStep({ errors: { provider: 'Provider is required.' } })
    expect(screen.getByText('Provider is required.')).toBeInTheDocument()
  })

  it('renders name error when errors.name is set', () => {
    renderCoreStep({ errors: { name: 'Name is required.' } })
    expect(screen.getByText('Name is required.')).toBeInTheDocument()
  })

  it('renders system prompt error when errors.systemPrompt is set', () => {
    renderCoreStep({ errors: { systemPrompt: 'System prompt is required.' } })
    expect(screen.getByText('System prompt is required.')).toBeInTheDocument()
  })

  it('renders current model in the list when model is set but not in catalog', () => {
    renderCoreStep({ draft: { ...emptyBuilderDraft, provider: 'workers-ai', model: 'custom-model' } })
    expect(screen.getByText(/custom-model/)).toBeInTheDocument()
  })

  it('renders catalog display name when available', async () => {
    renderCoreStep({ draft: { ...emptyBuilderDraft, provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6' } }, [
      buildProviderModel({ displayName: 'Kimi Latest', availability: 'available' }),
    ])
    expect(await screen.findByText(/Kimi Latest/)).toBeInTheDocument()
  })

  it('renders a selected model when the catalog is empty', () => {
    const draft = { ...emptyBuilderDraft, provider: 'workers-ai', model: '@cf/moonshotai/kimi-k2.6' }
    renderCoreStep({ draft })
    expect(screen.getByText(/@cf\/moonshotai\/kimi-k2\.6/)).toBeInTheDocument()
  })

  it('calls setField when description is typed', () => {
    const setField = vi.fn()
    renderCoreStep({ setField })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'My agent description' } })
    expect(setField).toHaveBeenCalledWith('description', 'My agent description')
  })

  it('sets both provider and model when a catalog model is picked', async () => {
    const setField = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: () => {},
      configurable: true,
    })
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json(
          listEnvelope([
            buildProviderModel({
              providerId: 'anthropic',
              modelId: 'claude-3-5-sonnet',
              displayName: '',
              availability: 'available',
            }),
          ]),
        ),
      ),
    )
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoreStep draft={emptyBuilderDraft} errors={{}} setField={setField} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const modelTrigger = screen.getByRole('combobox', { name: 'Model' })
    modelTrigger.focus()
    fireEvent.pointerDown(modelTrigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
    fireEvent.mouseDown(modelTrigger)
    const option = await screen.findByRole('option', { name: /claude-3-5-sonnet/ })
    fireEvent.click(option)
    expect(setField).toHaveBeenCalledWith('provider', 'anthropic')
    expect(setField).toHaveBeenCalledWith('model', 'claude-3-5-sonnet')
  })

  it('renders the selected model when draft.model is set', async () => {
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json(
          listEnvelope([
            buildProviderModel({
              providerId: 'anthropic',
              modelId: 'claude-3-5-sonnet',
              displayName: '',
              availability: 'available',
            }),
          ]),
        ),
      ),
    )
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoreStep
            draft={{ ...emptyBuilderDraft, provider: 'anthropic', model: 'claude-3-5-sonnet' }}
            errors={{}}
            setField={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/claude-3-5-sonnet/)).toBeInTheDocument()
  })

  it('filters available models and shows only available ones', async () => {
    server.use(
      http.get('*/api/v1/providers/models', () =>
        HttpResponse.json(
          listEnvelope([
            buildProviderModel({
              providerId: 'anthropic',
              modelId: 'claude-3-5-sonnet',
              displayName: '',
              availability: 'available',
            }),
            buildProviderModel({
              providerId: 'anthropic',
              modelId: 'claude-2',
              displayName: '',
              availability: 'unavailable',
            }),
          ]),
        ),
      ),
    )
    const queryClient = makeQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CoreStep
            draft={{ ...emptyBuilderDraft, provider: 'anthropic', model: 'claude-3-5-sonnet' }}
            errors={{}}
            setField={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByText(/claude-3-5-sonnet/)).toBeInTheDocument())
  })
})

// ─── ToolsStep ─────────────────────────────────────────────────────────────

describe('ToolsStep', () => {
  it('renders allowed tools selector and empty connector message when no connectors', () => {
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Allowed tools')).toBeInTheDocument()
    expect(screen.getByText('No MCP connectors are available in the catalog.')).toBeInTheDocument()
  })

  it('renders connector options with tools when connectors are present', () => {
    const connector = buildConnector()
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('GitHub connector')).toBeInTheDocument()
    expect(screen.getByText('github.list_repos')).toBeInTheDocument()
    expect(screen.getByText('Approval mode: none')).toBeInTheDocument()
  })

  it('renders connector tool description when present', () => {
    const connector = buildConnector({
      tools: [
        {
          name: 'github.list_repos',
          description: 'Lists all repos',
          inputSchema: {},
          approvalMode: 'none',
          policyMetadata: {},
        },
      ],
    })
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Lists all repos')).toBeInTheDocument()
  })

  it('disables connector checkbox when availability is unavailable', () => {
    const connector = buildConnector({ availability: 'unavailable' })
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeDisabled()
  })

  it('calls setField to add connector when available checkbox is clicked', () => {
    const setField = vi.fn()
    const connector = buildConnector()
    render(
      <MemoryRouter>
        <ToolsStep
          draft={{ ...emptyBuilderDraft, mcpConnectors: [] }}
          errors={{}}
          setField={setField}
          connectors={[connector]}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox'))
    expect(setField).toHaveBeenCalled()
  })

  it('calls setField to remove connector when already-selected connector is unchecked', () => {
    const setField = vi.fn()
    const connector = buildConnector()
    render(
      <MemoryRouter>
        <ToolsStep
          draft={{ ...emptyBuilderDraft, mcpConnectors: ['connector_1'] }}
          errors={{}}
          setField={setField}
          connectors={[connector]}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('checkbox'))
    expect(setField).toHaveBeenCalled()
  })

  it('shows error when errors.allowedTools is set', () => {
    render(
      <MemoryRouter>
        <ToolsStep
          draft={emptyBuilderDraft}
          errors={{ allowedTools: 'Tool is blocked by policy.' }}
          setField={vi.fn()}
          connectors={[]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Tool is blocked by policy.')).toBeInTheDocument()
  })

  it('renders FieldError when errors.mcpConnectors is set', () => {
    render(
      <MemoryRouter>
        <ToolsStep
          draft={emptyBuilderDraft}
          errors={{ mcpConnectors: 'Connector not available.' }}
          setField={vi.fn()}
          connectors={[]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Connector not available.')).toBeInTheDocument()
  })

  it('shows checked connector when it is already selected in draft', () => {
    const connector = buildConnector()
    render(
      <MemoryRouter>
        <ToolsStep
          draft={{ ...emptyBuilderDraft, mcpConnectors: ['connector_1'] }}
          errors={{}}
          setField={vi.fn()}
          connectors={[connector]}
        />
      </MemoryRouter>,
    )
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox.getAttribute('data-state')).toBe('checked')
  })

  it('renders connector tool inputSchema JSON when non-empty', () => {
    const connector = buildConnector({
      tools: [
        {
          name: 'tool_x',
          description: null,
          inputSchema: { type: 'object', properties: { x: {} } },
          approvalMode: 'none',
          policyMetadata: {},
        },
      ],
    })
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    expect(screen.getByText(/Schema:/)).toBeInTheDocument()
  })

  it('does not render tool description when tool.description is null', () => {
    const connector = buildConnector({
      tools: [
        {
          name: 'tool_x',
          description: null,
          inputSchema: {},
          approvalMode: 'none',
          policyMetadata: {},
        },
      ],
    })
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} connectors={[connector]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('tool_x')).toBeInTheDocument()
  })

  it('calls setField with new value when selecting an allowed tool', async () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <ToolsStep draft={emptyBuilderDraft} errors={{}} setField={setField} connectors={[]} />
      </MemoryRouter>,
    )
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Allowed tools' }), {
      button: 0,
      ctrlKey: false,
      pointerId: 1,
      pointerType: 'mouse',
    })
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'read' }))
    expect(setField).toHaveBeenCalledWith('allowedTools', 'read')
  })
})

// ─── SandboxStep ───────────────────────────────────────────────────────────

describe('SandboxStep', () => {
  it('renders sandbox checkbox and description', () => {
    render(
      <MemoryRouter>
        <SandboxStep draft={emptyBuilderDraft} errors={{}} setField={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Enable sandbox execution')).toBeInTheDocument()
    expect(screen.getByText(/Cloudflare Sandbox execution/)).toBeInTheDocument()
  })

  it('hides skills textarea when sandbox is disabled', () => {
    render(
      <MemoryRouter>
        <SandboxStep draft={{ ...emptyBuilderDraft, sandboxEnabled: false }} errors={{}} setField={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.queryByLabelText('Carried skills')).toBeNull()
  })

  it('shows skills textarea when sandbox is enabled', () => {
    render(
      <MemoryRouter>
        <SandboxStep draft={{ ...emptyBuilderDraft, sandboxEnabled: true }} errors={{}} setField={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText('Carried skills')).toBeInTheDocument()
  })

  it('calls setField when checkbox is toggled', () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <SandboxStep draft={emptyBuilderDraft} errors={{}} setField={setField} />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByLabelText('Enable sandbox execution'))
    expect(setField).toHaveBeenCalled()
  })

  it('shows skills error when errors.skills is set', () => {
    render(
      <MemoryRouter>
        <SandboxStep
          draft={{ ...emptyBuilderDraft, sandboxEnabled: true }}
          errors={{ skills: 'Invalid skill ref.' }}
          setField={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Invalid skill ref.')).toBeInTheDocument()
  })

  it('calls setField with new value when typing in skills textarea', () => {
    const setField = vi.fn()
    render(
      <MemoryRouter>
        <SandboxStep draft={{ ...emptyBuilderDraft, sandboxEnabled: true }} errors={{}} setField={setField} />
      </MemoryRouter>,
    )
    fireEvent.change(screen.getByLabelText('Carried skills'), { target: { value: 'ama@coding-agent' } })
    expect(setField).toHaveBeenCalledWith('skills', 'ama@coding-agent')
  })
})

// ─── TestEnvironmentField ──────────────────────────────────────────────────

describe('TestEnvironmentField', () => {
  it('shows no active environments message when environments list is empty', () => {
    render(
      <MemoryRouter>
        <TestEnvironmentField environments={[]} environmentId="" setEnvironmentId={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Create one on the Environments page' })).toBeInTheDocument()
  })

  it('renders description text when active environments exist', () => {
    const env = buildEnvironment()
    render(
      <MemoryRouter>
        <TestEnvironmentField environments={[env]} environmentId="" setEnvironmentId={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('The draft test session runs against this environment.')).toBeInTheDocument()
  })

  it('shows no active environments link when only archived environments exist', () => {
    const archived = buildEnvironment({ id: 'env_archived', name: 'Archived Env', archivedAt: now })
    render(
      <MemoryRouter>
        <TestEnvironmentField environments={[archived]} environmentId="" setEnvironmentId={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Create one on the Environments page' })).toBeInTheDocument()
  })

  it('shows description text when at least one active environment exists', () => {
    const active = buildEnvironment({ id: 'env_active', name: 'Active Env' })
    const archived = buildEnvironment({ id: 'env_archived', name: 'Archived Env', archivedAt: now })
    render(
      <MemoryRouter>
        <TestEnvironmentField environments={[active, archived]} environmentId="" setEnvironmentId={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('The draft test session runs against this environment.')).toBeInTheDocument()
  })
})
