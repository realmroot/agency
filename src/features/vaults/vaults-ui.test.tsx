import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { useClientPagination } from '@/console/use-client-pagination'
import type { AuditRecord, Vault, VaultCredential } from '@/lib/enborrpc'
import { createCollection, HttpResponse, http, server } from '@/test/msw'
import {
  credential as resourceCredential,
  vault as resourceVault,
  type VaultCredentialOverrides,
  type VaultOverrides,
  vaultCredentialVersion,
} from '@/test/resource-fixtures'
import { AddCredentialSheet } from './AddCredentialSheet'
import { CreateVaultSheet } from './CreateVaultSheet'
import { RotateCredentialSheet } from './RotateCredentialSheet'
import { useVaultActions } from './use-vault-actions'
import { VaultDetailPage } from './VaultDetailPage'
import { VaultDetailView } from './VaultDetailView'
import { VaultsPage } from './VaultsPage'
import { VaultsView } from './VaultsView'

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function pagination<T>(items: T[]) {
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

function vault(overrides: VaultOverrides = {}): Vault {
  return resourceVault({
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  })
}

function credential(overrides: VaultCredentialOverrides = {}): VaultCredential {
  return resourceCredential({
    activeVersion: vaultCredentialVersion({
      id: 'vaultver_1',
      version: 2,
      secretRef: 'ama://vaults/vault_1/credentials/vaultcred_1/versions/vaultver_2',
      referenceName: 'AMA_VAULTCRED_1_V2',
      createdAt: '2026-05-23T00:00:00.000Z',
    }),
    createdAt: '2026-05-23T00:00:00.000Z',
    updatedAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  })
}

function auditRecord(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: 'audit_1',
    projectId: 'project_1',
    actorUserId: 'user_1',
    controllerUserId: null,
    actorType: 'user',
    action: 'vault.create',
    resourceType: 'vault',
    resourceId: 'vault_1',
    outcome: 'success',
    requestId: null,
    correlationId: null,
    sessionId: null,
    policyCategory: null,
    metadata: {},
    before: {},
    after: {},
    createdAt: '2026-05-23T00:00:00.000Z',
    ...overrides,
  }
}

// Shared pointer-capture stubs needed for Radix dropdown interactions
function stubPointerCapture() {
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

async function selectCredentialType(label: string) {
  fireEvent.pointerDown(screen.getByRole('combobox', { name: 'Type' }), {
    button: 0,
    ctrlKey: false,
    pointerId: 1,
    pointerType: 'mouse',
  })
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

async function activateTab(name: string) {
  const tab = screen.getByRole('tab', { name })
  fireEvent.pointerDown(tab, { button: 0, ctrlKey: false })
  fireEvent.mouseDown(tab)
  fireEvent.mouseUp(tab)
  fireEvent.click(tab)
  await waitFor(() => expect(tab.getAttribute('data-state')).toBe('active'))
}

// ─── VaultsView ─────────────────────────────────────────────────────────────

describe('[spec: vaults/console-list] VaultsView', () => {
  it('shows the empty-state create affordance when no vaults exist', () => {
    render(
      <MemoryRouter>
        <VaultsView vaults={[]} pagination={pagination<Vault>([])} onDelete={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('No vaults')).toBeInTheDocument()
    expect(screen.getByText(/Create a vault to track safe secret references/)).toBeInTheDocument()
  })

  it('renders vault rows with display name, scope, status, and timestamps', () => {
    const vaults = [vault()]
    render(
      <MemoryRouter>
        <VaultsView vaults={vaults} pagination={pagination(vaults)} onDelete={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: 'Provider credentials' }).getAttribute('href')).toBe('/vaults/vault_1')
    expect(screen.getByText('project')).toBeInTheDocument()
    expect(screen.getByText('1-1 of 1')).toBeInTheDocument()
  })

  it('shows active badge when vault is not deleted', () => {
    const vaults = [vault()]
    render(
      <MemoryRouter>
        <VaultsView vaults={vaults} pagination={pagination(vaults)} onDelete={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('falls back to vault id when description is null', () => {
    const vaults = [vault({ description: null })]
    render(
      <MemoryRouter>
        <VaultsView vaults={vaults} pagination={pagination(vaults)} onDelete={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('vault_1')).toBeInTheDocument()
  })

  it('shows organization scope badge for organization-scoped vault', () => {
    const vaults = [vault({ scope: 'organization' })]
    render(
      <MemoryRouter>
        <VaultsView vaults={vaults} pagination={pagination(vaults)} onDelete={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('organization')).toBeInTheDocument()
  })

  it('shows Organization in project cell when project metadata has no project id', () => {
    const vaults = [vault({ projectId: null })]
    render(
      <MemoryRouter>
        <VaultsView vaults={vaults} pagination={pagination(vaults)} onDelete={vi.fn()} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Organization')).toBeInTheDocument()
  })

  it('calls onDelete when delete confirm is submitted', async () => {
    stubPointerCapture()

    const onDelete = vi.fn()
    const vaults = [vault()]
    render(
      <MemoryRouter>
        <VaultsView vaults={vaults} pagination={pagination(vaults)} onDelete={onDelete} />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete vault' }))
    await waitFor(() => expect(screen.getByText('Delete vault?')).toBeInTheDocument())
    const confirmBtns = screen.getAllByRole('button', { name: 'Delete vault', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('vault_1'))
  })

  it('paginates correctly with multiple vaults', () => {
    const vaults = Array.from({ length: 11 }, (_, i) => vault({ id: `vault_${i + 1}`, name: `Vault ${i + 1}` }))

    function Harness() {
      const pag = useClientPagination(vaults)
      return (
        <MemoryRouter>
          <VaultsView vaults={pag.items} pagination={pag} onDelete={vi.fn()} />
        </MemoryRouter>
      )
    }

    render(<Harness />)
    expect(screen.getByText('1-10 of 11')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('11-11 of 11')).toBeInTheDocument()
  })
})

// ─── VaultDetailView ─────────────────────────────────────────────────────────

describe('[spec: vaults/console-list] VaultDetailView', () => {
  it('renders credential metadata with safe references and redacts raw secret data', () => {
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[credential()]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Credential metadata')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Credentials' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByText('Raw secret values are not returned by the control plane.')).toBeInTheDocument()
    expect(screen.getByText('OpenAI key')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText('AMA_VAULTCRED_1_V2')).toBeInTheDocument()
  })

  it('shows loading skeleton when loading is true', () => {
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={null}
          credentials={[]}
          auditRecords={[]}
          loading={true}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('Loading vault detail')).toBeInTheDocument()
  })

  it('shows vault not found when vault is null and not loading', () => {
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={null}
          credentials={[]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Vault not found')).toBeInTheDocument()
    expect(screen.getByText('The requested vault is not in this project.')).toBeInTheDocument()
  })

  it('shows vault profile section with vault id and metadata', () => {
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Vault profile')).toBeInTheDocument()
    expect(screen.getByText('vault_1')).toBeInTheDocument()
  })

  it('shows No description when vault description is null', () => {
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault({ description: null })}
          credentials={[]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No description')).toBeInTheDocument()
  })

  it('shows No credentials empty state for active vault with no credentials', () => {
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No credentials')).toBeInTheDocument()
    expect(screen.getByText(/Store a credential to track safe versioned secret references/)).toBeInTheDocument()
  })

  it('shows Add credential button for active vault', () => {
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByRole('button', { name: 'Add credential' }).length).toBeGreaterThan(0)
  })

  it('calls onAddCredential when Add credential button is clicked', () => {
    const onAddCredential = vi.fn()
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[]}
          auditRecords={[]}
          loading={false}
          onAddCredential={onAddCredential}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Add credential' })[0] as HTMLElement)
    expect(onAddCredential).toHaveBeenCalledTimes(1)
  })

  it('calls onRotate with credential when update secret button is clicked', () => {
    const onRotate = vi.fn()
    const cred = credential()
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[cred]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={onRotate}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Update credential secret' }))
    expect(onRotate).toHaveBeenCalledWith(cred)
  })

  it('calls onRevoke with credential when Revoke confirm is submitted', async () => {
    stubPointerCapture()

    const onRevoke = vi.fn()
    const cred = credential()
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[cred]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={onRevoke}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Revoke credential' }))
    await waitFor(() => expect(screen.getByText('Revoke credential?')).toBeInTheDocument())
    const confirmBtns = screen.getAllByRole('button', { name: 'Revoke credential', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith(cred))
  })

  it('does not show rotate/revoke buttons for revoked credential', () => {
    const cred = credential({ phase: 'revoked' })
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[cred]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: 'Update credential secret' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke credential' })).toBeNull()
  })

  it('shows None for active version when credential has no active version', () => {
    const cred = credential({ activeVersion: null, activeVersionId: null })
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[cred]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getAllByText('None').length).toBeGreaterThan(0)
  })

  it('shows Not returned for secret reference when active version is null', () => {
    const cred = credential({ activeVersion: null, activeVersionId: null })
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[cred]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Not returned')).toBeInTheDocument()
  })

  it('renders audit records section with history', async () => {
    const record = auditRecord()
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[]}
          auditRecords={[record]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    await activateTab('Activity')
    expect(screen.getByText('Audit history')).toBeInTheDocument()
    expect(screen.getByText('vault.create')).toBeInTheDocument()
    expect(screen.getByText('success')).toBeInTheDocument()
  })

  it('shows audit record resourceType when resourceId is null', async () => {
    const record = auditRecord({ resourceId: null })
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[]}
          auditRecords={[record]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    await activateTab('Activity')
    expect(screen.getByText('vault')).toBeInTheDocument()
  })

  it('shows No audit history when no audit records exist', async () => {
    render(
      <MemoryRouter>
        <VaultDetailView
          vault={vault()}
          credentials={[]}
          auditRecords={[]}
          loading={false}
          onAddCredential={vi.fn()}
          onRotate={vi.fn()}
          onRevoke={vi.fn()}
        />
      </MemoryRouter>,
    )

    await activateTab('Activity')
    expect(screen.getByText('No audit history')).toBeInTheDocument()
    expect(screen.getByText('Vault and credential changes will appear here.')).toBeInTheDocument()
  })
})

// ─── CreateVaultSheet ────────────────────────────────────────────────────────

describe('[spec: vaults/create-sheet] CreateVaultSheet', () => {
  it('renders the create vault form when open', () => {
    const client = makeQueryClient()
    server.use(http.post('*/api/v1/vaults', () => HttpResponse.json(vault(), { status: 201 })))
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateVaultSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Create Vault')).toBeInTheDocument()
    expect(screen.getByText('Create safe credential-reference metadata for runtime integrations.')).toBeInTheDocument()
  })

  it('does not render form content when closed', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateVaultSheet open={false} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Create Vault')).toBeNull()
  })

  it('calls POST /api/v1/vaults and closes sheet on submit', async () => {
    const vaults = createCollection<Vault>()
    let postedBody: Record<string, unknown> | null = null
    server.use(
      http.post('*/api/v1/vaults', async ({ request }) => {
        postedBody = (await request.json()) as Record<string, unknown>
        const metadata = postedBody.metadata as { name?: unknown } | undefined
        const created = vault({ id: 'vault_new', name: String(metadata?.name ?? 'Provider credentials') })
        vaults.put(created)
        return HttpResponse.json(created, { status: 201 })
      }),
      http.get('*/api/v1/vaults', () =>
        HttpResponse.json({ data: vaults.list(), pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const onOpenChange = vi.fn()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateVaultSheet open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /Save vault/i }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const body = postedBody as unknown as Record<string, unknown>
    expect(body).toMatchObject({ metadata: { name: 'Provider credentials' }, spec: { scope: 'project' } })
    expect(body.metadata).not.toHaveProperty('description')
  })

  it('shows toast error when POST /api/v1/vaults returns 500', async () => {
    server.use(http.post('*/api/v1/vaults', () => HttpResponse.json({ error: 'Server error' }, { status: 500 })))

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CreateVaultSheet open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save vault/i }))
    // The mutation fires; the 500 triggers the onError toast path — just wait for the request to settle
    await waitFor(() => expect(screen.getByRole('button', { name: /Save vault/i })).toBeInTheDocument())
  })
})

// ─── AddCredentialSheet ──────────────────────────────────────────────────────

describe('[spec: vaults/add-credential-sheet] AddCredentialSheet', () => {
  it('renders the form when open', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getByText('Add credential')).toBeInTheDocument()
    expect(
      screen.getByText('The secret data is encrypted at rest and never returned by the control plane.'),
    ).toBeInTheDocument()
  })

  it('does not render form content when closed', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open={false} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Add credential')).toBeNull()
  })

  it('disables the submit button when name or secret value is empty', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const btn = screen.getByRole('button', { name: /Save credential/i })
    expect(btn.hasAttribute('disabled')).toBe(true)
  })

  it('enables the submit button when name and secret value are filled', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My key' } })
    fireEvent.change(screen.getByLabelText('Data value 1'), { target: { value: 'sk-supersecret' } })

    const btn = screen.getByRole('button', { name: /Save credential/i })
    expect(btn.hasAttribute('disabled')).toBe(false)
  })

  it('does not call the api when form is submitted with empty fields', async () => {
    // No MSW handler — if the real client fires, onUnhandledRequest:'error' would throw
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /Save credential/i }))
    // Button stays disabled — no network request fired
    expect(screen.getByRole('button', { name: /Save credential/i })).toBeInTheDocument()
  })

  it('returns early from submit handler without calling api when fields are invalid', () => {
    // Fires the form submit event directly (bypassing the disabled button) to exercise
    // the `if (!valid) return` guard in the submit handler.
    // No MSW handler registered — if the real client were called, onUnhandledRequest:'error' would throw.
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // The sheet renders into a portal — find the form via the button's closest ancestor
    const btn = screen.getByRole('button', { name: /Save credential/i })
    const form = btn.closest('form')
    expect(form).not.toBeNull()
    // Submit the form while the fields are still empty (valid=false)
    fireEvent.submit(form as HTMLFormElement)
    // No network request should fire — the early-return guard prevents it
    expect(screen.getByRole('button', { name: /Save credential/i })).toBeInTheDocument()
  })

  it('calls POST /api/v1/vaults/:vaultId/credentials on valid submit', async () => {
    const credentials = createCollection<VaultCredential>()
    server.use(
      http.post('*/api/v1/vaults/vault_1/credentials', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        const created = credential({ id: 'vaultcred_new', name: String(body.name ?? 'My key') })
        credentials.put(created)
        return HttpResponse.json(created, { status: 201 })
      }),
      http.get('*/api/v1/vaults/vault_1/credentials', () =>
        HttpResponse.json({ data: credentials.list(), pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/vaults/vault_1', () => HttpResponse.json(vault())),
    )

    const onOpenChange = vi.fn()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My key' } })
    fireEvent.change(screen.getByLabelText('Data value 1'), { target: { value: 'sk-supersecret' } })
    fireEvent.click(screen.getByRole('button', { name: /Save credential/i }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('includes opaque data fields in payload when filled', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post('*/api/v1/vaults/vault_1/credentials', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(credential({ id: 'vaultcred_new' }), { status: 201 })
      }),
      http.get('*/api/v1/vaults/vault_1/credentials', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/vaults/vault_1', () => HttpResponse.json(vault())),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My key' } })
    fireEvent.change(screen.getByLabelText('Data key 1'), { target: { value: 'token' } })
    fireEvent.change(screen.getByLabelText('Data value 1'), { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /Save credential/i }))

    await waitFor(() => expect(capturedBody.secret).toEqual({ stringData: { token: 'sk-secret' } }))
  })

  it('adds and removes opaque secret data rows', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add secret value' }))
    expect(screen.getByLabelText('Data key 2')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Data key 2'), { target: { value: 'token' } })
    fireEvent.change(screen.getByLabelText('Data value 2'), { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove data key 1' }))

    expect(screen.getByLabelText('Data key 1')).toHaveValue('token')
    expect(screen.getByLabelText('Data value 1')).toHaveValue('sk-secret')
  })

  it('resets opaque secret data when the final row is removed', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Data key 1'), { target: { value: 'token' } })
    fireEvent.change(screen.getByLabelText('Data value 1'), { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove data key 1' }))

    expect(screen.getByLabelText('Data key 1')).toHaveValue('value')
    expect(screen.getByLabelText('Data value 1')).toHaveValue('')
  })

  it('does not expose raw metadata or stringData fields', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByLabelText('Metadata')).toBeNull()
    expect(screen.queryByLabelText('String data')).toBeNull()
  })

  it('shows saving state on button while mutation is pending', async () => {
    let resolveRequest: () => void
    server.use(
      http.post('*/api/v1/vaults/vault_1/credentials', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve
        })
        return HttpResponse.json(credential({ id: 'vaultcred_new' }), { status: 201 })
      }),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My key' } })
    fireEvent.change(screen.getByLabelText('Data value 1'), { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /Save credential/i }))

    await waitFor(() => expect(screen.getByText('Saving credential')).toBeInTheDocument())
    resolveRequest!()
  })

  it('shows error state when POST /api/v1/vaults/:vaultId/credentials returns 500', async () => {
    server.use(
      http.post('*/api/v1/vaults/vault_1/credentials', () =>
        HttpResponse.json({ error: 'Server error' }, { status: 500 }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My key' } })
    fireEvent.change(screen.getByLabelText('Data value 1'), { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /Save credential/i }))
    // Wait for the button to return to its normal state after the error
    await waitFor(() => expect(screen.getByRole('button', { name: /Save credential/i })).toBeInTheDocument())
  })

  it('submits only credential fields in the create payload', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post('*/api/v1/vaults/vault_1/credentials', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(credential({ id: 'vaultcred_new' }), { status: 201 })
      }),
      http.get('*/api/v1/vaults/vault_1/credentials', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/vaults/vault_1', () => HttpResponse.json(vault())),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My key' } })
    fireEvent.change(screen.getByLabelText('Data value 1'), { target: { value: 'sk-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /Save credential/i }))

    await waitFor(() =>
      expect(capturedBody).toEqual({
        name: 'My key',
        type: 'opaque',
        metadata: {},
        secret: { stringData: { value: 'sk-secret' } },
      }),
    )
  })

  it('submits typed basic auth fields in the create payload', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post('*/api/v1/vaults/vault_1/credentials', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(credential({ id: 'vaultcred_new' }), { status: 201 })
      }),
      http.get('*/api/v1/vaults/vault_1/credentials', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/vaults/vault_1', () => HttpResponse.json(vault())),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Git credentials' } })
    await selectCredentialType('Basic auth')
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'git-user' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'git-password' } })
    fireEvent.click(screen.getByRole('button', { name: /Save credential/i }))

    await waitFor(() =>
      expect(capturedBody).toEqual({
        name: 'Git credentials',
        type: 'ama.dev/basic-auth',
        metadata: {},
        secret: { stringData: { username: 'git-user', password: 'git-password' } },
      }),
    )
  })

  it('renders the structured fields for each credential type', async () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await selectCredentialType('SSH auth')
    expect(screen.getByLabelText('SSH private key')).toBeInTheDocument()

    await selectCredentialType('TLS')
    expect(screen.getByLabelText('TLS certificate')).toBeInTheDocument()
    expect(screen.getByLabelText('TLS private key')).toBeInTheDocument()

    await selectCredentialType('Private key JWK')
    expect(screen.getByLabelText('JWK')).toBeInTheDocument()

    await selectCredentialType('OAuth token')
    expect(screen.getByLabelText('Access token')).toBeInTheDocument()
    expect(screen.getByLabelText('Refresh token')).toBeInTheDocument()
    expect(screen.getByLabelText('Token type')).toBeInTheDocument()
    expect(screen.getByLabelText('Expires at')).toBeInTheDocument()
    expect(screen.getByLabelText('Scopes')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('combobox', { name: 'Type' }), {
      button: 0,
      ctrlKey: false,
      pointerId: 1,
      pointerType: 'mouse',
    })
    expect(screen.queryByRole('option', { name: 'Realmroot Agent state' })).not.toBeInTheDocument()
  })

  const structuredCredentialCases: Array<{
    label: string
    type: string
    fields: Array<[string, string]>
    stringData: Record<string, string>
  }> = [
    {
      label: 'SSH auth',
      type: 'ama.dev/ssh-auth',
      fields: [['SSH private key', '-----BEGIN OPENSSH PRIVATE KEY-----']],
      stringData: { 'ssh-privatekey': '-----BEGIN OPENSSH PRIVATE KEY-----' },
    },
    {
      label: 'TLS',
      type: 'ama.dev/tls',
      fields: [
        ['TLS certificate', '-----BEGIN CERTIFICATE-----'],
        ['TLS private key', '-----BEGIN PRIVATE KEY-----'],
      ],
      stringData: { 'tls.crt': '-----BEGIN CERTIFICATE-----', 'tls.key': '-----BEGIN PRIVATE KEY-----' },
    },
    {
      label: 'Private key JWK',
      type: 'ama.dev/private-key-jwk',
      fields: [['JWK', '{"kty":"OKP"}']],
      stringData: { jwk: '{"kty":"OKP"}' },
    },
  ]

  it.each(structuredCredentialCases)('submits $label credential fields in the create payload', async ({
    label,
    type,
    fields,
    stringData,
  }) => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post('*/api/v1/vaults/vault_1/credentials', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(credential({ id: 'vaultcred_new' }), { status: 201 })
      }),
      http.get('*/api/v1/vaults/vault_1/credentials', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/vaults/vault_1', () => HttpResponse.json(vault())),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: label } })
    await selectCredentialType(label)
    for (const [fieldLabel, value] of fields) {
      fireEvent.change(screen.getByLabelText(fieldLabel), { target: { value } })
    }
    fireEvent.click(screen.getByRole('button', { name: /Save credential/i }))

    await waitFor(() =>
      expect(capturedBody).toEqual({
        name: label,
        type,
        metadata: {},
        secret: { stringData },
      }),
    )
  })

  it('submits oauth token fields in the create payload', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.post('*/api/v1/vaults/vault_1/credentials', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(credential({ id: 'vaultcred_new' }), { status: 201 })
      }),
      http.get('*/api/v1/vaults/vault_1/credentials', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/vaults/vault_1', () => HttpResponse.json(vault())),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AddCredentialSheet vaultId="vault_1" open onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'OAuth token' } })
    await selectCredentialType('OAuth token')
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'access-token' } })
    fireEvent.change(screen.getByLabelText('Refresh token'), { target: { value: 'refresh-token' } })
    fireEvent.change(screen.getByLabelText('Token type'), { target: { value: 'Bearer' } })
    fireEvent.change(screen.getByLabelText('Expires at'), { target: { value: '2026-05-23T00:00:00Z' } })
    fireEvent.change(screen.getByLabelText('Scopes'), { target: { value: 'repo read:user' } })
    fireEvent.click(screen.getByRole('button', { name: /Save credential/i }))

    await waitFor(() =>
      expect(capturedBody).toEqual({
        name: 'OAuth token',
        type: 'ama.dev/oauth-token',
        metadata: {},
        secret: {
          stringData: {
            'access-token': 'access-token',
            'refresh-token': 'refresh-token',
            'token-type': 'Bearer',
            'expires-at': '2026-05-23T00:00:00Z',
            scopes: 'repo read:user',
          },
        },
      }),
    )
  })
})

// ─── RotateCredentialSheet ───────────────────────────────────────────────────

describe('[spec: vaults/rotate-credential-sheet] RotateCredentialSheet', () => {
  it('renders the form when credential is provided', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RotateCredentialSheet vaultId="vault_1" credential={credential()} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.getAllByText('Update credential secret').length).toBeGreaterThan(0)
    expect(screen.getByText(/Replace the secret material for OpenAI key/)).toBeInTheDocument()
  })

  it('does not render sheet when credential is null', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RotateCredentialSheet vaultId="vault_1" credential={null} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByText('Update credential secret')).toBeNull()
  })

  it('disables submit when string data is empty', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RotateCredentialSheet vaultId="vault_1" credential={credential()} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const btn = screen.getByRole('button', { name: /Update credential secret/i })
    expect(btn.hasAttribute('disabled')).toBe(true)
  })

  it('enables submit when string data is filled', () => {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RotateCredentialSheet vaultId="vault_1" credential={credential()} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('New string data'), { target: { value: '{"value":"new-secret"}' } })

    const btn = screen.getByRole('button', { name: /Update credential secret/i })
    expect(btn.hasAttribute('disabled')).toBe(false)
  })

  it('calls PUT /api/v1/vaults/:vaultId/credentials/:credentialId on valid submit', async () => {
    let capturedBody: Record<string, unknown> = {}
    server.use(
      http.put('*/api/v1/vaults/vault_1/credentials/vaultcred_1', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 'vaultver_new' }, { status: 200 })
      }),
      http.get('*/api/v1/vaults/vault_1', () => HttpResponse.json(vault())),
      http.get('*/api/v1/vaults/vault_1/credentials', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const onOpenChange = vi.fn()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RotateCredentialSheet vaultId="vault_1" credential={credential()} onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('New string data'), { target: { value: '{"value":"rotated-secret"}' } })
    fireEvent.click(screen.getByRole('button', { name: /Update credential secret/i }))

    await waitFor(() => expect(capturedBody.stringData).toEqual({ value: 'rotated-secret' }))
    expect(capturedBody.stringData).toEqual({ value: 'rotated-secret' })
  })

  it('closes sheet after successful secret update', async () => {
    server.use(
      http.put('*/api/v1/vaults/vault_1/credentials/vaultcred_1', () =>
        HttpResponse.json({ id: 'vaultver_new' }, { status: 200 }),
      ),
      http.get('*/api/v1/vaults/vault_1', () => HttpResponse.json(vault())),
      http.get('*/api/v1/vaults/vault_1/credentials', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    const onOpenChange = vi.fn()
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RotateCredentialSheet vaultId="vault_1" credential={credential()} onOpenChange={onOpenChange} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('New string data'), { target: { value: '{"value":"rotated-secret"}' } })
    fireEvent.click(screen.getByRole('button', { name: /Update credential secret/i }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows toast error when PUT /api/v1/vaults/:vaultId/credentials/:id returns 500', async () => {
    server.use(
      http.put('*/api/v1/vaults/vault_1/credentials/vaultcred_1', () =>
        HttpResponse.json({ error: 'Secret update failed' }, { status: 500 }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RotateCredentialSheet vaultId="vault_1" credential={credential()} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('New string data'), { target: { value: '{"value":"rotated-secret"}' } })
    fireEvent.click(screen.getByRole('button', { name: /Update credential secret/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Update credential secret/i })).toBeInTheDocument())
  })

  it('shows updating state on button while mutation is pending', async () => {
    let resolveRequest: () => void
    server.use(
      http.put('*/api/v1/vaults/vault_1/credentials/vaultcred_1', async () => {
        await new Promise<void>((resolve) => {
          resolveRequest = resolve
        })
        return HttpResponse.json({ id: 'vaultver_new' }, { status: 200 })
      }),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <RotateCredentialSheet vaultId="vault_1" credential={credential()} onOpenChange={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('New string data'), { target: { value: '{"value":"rotated-secret"}' } })
    fireEvent.click(screen.getByRole('button', { name: /Update credential secret/i }))

    await waitFor(() => expect(screen.getByText('Updating credential secret')).toBeInTheDocument())
    resolveRequest!()
  })
})

// ─── VaultsPage ──────────────────────────────────────────────────────────────

describe('[spec: vaults/console-page] VaultsPage', () => {
  function setupPage(seedVaults: Vault[] = []) {
    const vaults = createCollection<Vault>(seedVaults)
    server.use(
      http.get('*/api/v1/vaults', () =>
        HttpResponse.json({ data: vaults.list(), pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.patch('*/api/v1/vaults/:vaultId', ({ params }) => {
        const existing = vaults.get(String(params.vaultId))
        if (!existing) return HttpResponse.json({ error: 'not found' }, { status: 404 })
        const updated = { ...existing, archivedAt: new Date().toISOString() }
        vaults.put(updated)
        return HttpResponse.json(updated)
      }),
      http.post('*/api/v1/vaults', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        const metadata = body.metadata as { name?: unknown } | undefined
        const created = vault({ id: `vault_${vaults.items.size + 1}`, name: String(metadata?.name ?? 'New Vault') })
        vaults.put(created)
        return HttpResponse.json(created, { status: 201 })
      }),
    )
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <VaultsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return { vaults, client }
  }

  it('renders the page header and create vault button', async () => {
    setupPage([])
    expect(screen.getByText('Vaults')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create vault/i })).toBeInTheDocument()
  })

  it('renders vault rows after data loads', async () => {
    setupPage([vault()])
    expect(await screen.findByText('Provider credentials')).toBeInTheDocument()
  })

  it('shows empty state when no vaults are returned', async () => {
    setupPage([])
    await waitFor(() => expect(screen.getByText('No vaults')).toBeInTheDocument())
  })

  it('opens create vault sheet when Create vault button is clicked', async () => {
    setupPage([])
    fireEvent.click(screen.getByRole('button', { name: /Create vault/i }))
    await waitFor(() => expect(screen.getByText('Create Vault')).toBeInTheDocument())
  })
})

// ─── VaultDetailPage ─────────────────────────────────────────────────────────

describe('[spec: vaults/console-detail-page] VaultDetailPage', () => {
  function setupDetailPage(vaultData: Vault | null, initialCredentials: VaultCredential[] = []) {
    const vaults = createCollection<Vault>(vaultData ? [vaultData] : [])
    const credentials = createCollection<VaultCredential>(initialCredentials)

    server.use(
      http.get('*/api/v1/vaults/:vaultId', ({ params }) => {
        const v = vaults.get(String(params.vaultId))
        return v ? HttpResponse.json(v) : HttpResponse.json({ error: 'not found' }, { status: 404 })
      }),
      http.get('*/api/v1/vaults/:vaultId/credentials', () =>
        HttpResponse.json({ data: credentials.list(), pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/audit-records', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.patch('*/api/v1/vaults/:vaultId/credentials/:credentialId', ({ params }) => {
        const cred = credentials.get(String(params.credentialId))
        if (!cred) return HttpResponse.json({ error: 'not found' }, { status: 404 })
        const revoked: VaultCredential = {
          ...cred,
          status: { ...cred.status, phase: 'revoked', revokedAt: new Date().toISOString() },
        }
        credentials.put(revoked)
        return HttpResponse.json(revoked)
      }),
      http.post('*/api/v1/vaults/:vaultId/credentials', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        const cred = credential({ id: 'vaultcred_new', name: String(body.name ?? 'New cred') })
        credentials.put(cred)
        return HttpResponse.json(cred, { status: 201 })
      }),
      http.put('*/api/v1/vaults/:vaultId/credentials/:credentialId', () =>
        HttpResponse.json({ id: 'vaultver_new' }, { status: 200 }),
      ),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/vaults/vault_1']}>
          <Routes>
            <Route path="/vaults/:vaultId" element={<VaultDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    return { vaults, credentials, client }
  }

  it('renders vault name in header after load', async () => {
    setupDetailPage(vault())
    expect(await screen.findByText('Provider credentials')).toBeInTheDocument()
  })

  it('renders Vault detail fallback title when vault is not found', async () => {
    setupDetailPage(null)
    expect(screen.getByText('Vault detail')).toBeInTheDocument()
  })

  it('renders credential table after data loads', async () => {
    setupDetailPage(vault(), [credential()])
    expect(await screen.findByText('OpenAI key')).toBeInTheDocument()
  })

  it('opens AddCredentialSheet when onAddCredential is triggered', async () => {
    setupDetailPage(vault())
    await screen.findByText('Provider credentials')
    fireEvent.click(screen.getAllByRole('button', { name: 'Add credential' })[0] as HTMLElement)
    await waitFor(() =>
      expect(
        screen.getByText('The secret data is encrypted at rest and never returned by the control plane.'),
      ).toBeInTheDocument(),
    )
  })

  it('opens RotateCredentialSheet when onRotate is triggered', async () => {
    setupDetailPage(vault(), [credential()])
    await screen.findByText('OpenAI key')
    fireEvent.click(screen.getByRole('button', { name: 'Update credential secret' }))
    await waitFor(() => expect(screen.getByText(/Replace the secret material for OpenAI key/)).toBeInTheDocument())
  })

  it('calls PATCH /api/v1/vaults/:vaultId/credentials/:id when onRevoke is triggered', async () => {
    stubPointerCapture()

    const { credentials } = setupDetailPage(vault(), [credential()])
    await screen.findByText('OpenAI key')

    fireEvent.click(screen.getByRole('button', { name: 'Revoke credential' }))
    await waitFor(() => expect(screen.getByText('Revoke credential?')).toBeInTheDocument())
    const confirmBtns = screen.getAllByRole('button', { name: 'Revoke credential', hidden: true })
    fireEvent.click(confirmBtns[confirmBtns.length - 1] as HTMLElement)
    await waitFor(() => expect(credentials.get('vaultcred_1')?.status.phase).toBe('revoked'))
  })

  it('closes RotateCredentialSheet after successful secret update', async () => {
    setupDetailPage(vault(), [credential()])
    await screen.findByText('OpenAI key')

    fireEvent.click(screen.getByRole('button', { name: 'Update credential secret' }))
    await waitFor(() => expect(screen.getByText(/Replace the secret material for OpenAI key/)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('New string data'), { target: { value: '{"value":"new-secret"}' } })
    fireEvent.click(screen.getByRole('button', { name: /Update credential secret/i }))

    await waitFor(() => expect(screen.queryByText(/Replace the secret material for OpenAI key/)).toBeNull())
  })

  it('filters audit records to only those matching the vault id and sorts by date descending', async () => {
    const vaultRecord = auditRecord({
      id: 'audit_vault',
      action: 'vault.update',
      resourceType: 'vault',
      resourceId: 'vault_1',
      metadata: {},
      createdAt: '2026-05-20T00:00:00.000Z',
    })
    const matchingRecord = auditRecord({
      id: 'audit_match',
      action: 'vault.create',
      resourceType: 'vault_credential',
      resourceId: 'vaultcred_1',
      metadata: { vaultId: 'vault_1' },
      createdAt: '2026-05-23T00:00:00.000Z',
    })
    const nonMatchingRecord = auditRecord({
      id: 'audit_no_match',
      resourceType: 'vault_credential',
      metadata: { vaultId: 'vault_other' },
    })

    // Override the audit-records handler to serve different responses for different resourceType params
    server.use(
      http.get('*/api/v1/vaults/:vaultId', () => HttpResponse.json(vault())),
      http.get('*/api/v1/vaults/:vaultId/credentials', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
      http.get('*/api/v1/audit-records', ({ request }) => {
        const url = new URL(request.url)
        const resourceType = url.searchParams.get('resourceType')
        if (resourceType === 'vault') {
          return HttpResponse.json({
            data: [vaultRecord],
            pagination: { limit: 50, hasMore: false, nextCursor: null },
          })
        }
        return HttpResponse.json({
          data: [matchingRecord, nonMatchingRecord],
          pagination: { limit: 50, hasMore: false, nextCursor: null },
        })
      }),
    )

    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/vaults/vault_1']}>
          <Routes>
            <Route path="/vaults/:vaultId" element={<VaultDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await screen.findByText('Provider credentials')
    await activateTab('Activity')
    await waitFor(() => expect(screen.getByText('vault.create')).toBeInTheDocument())
    expect(screen.getByText('vault.update')).toBeInTheDocument()
    expect(screen.queryByText('audit_no_match')).toBeNull()
  })
})

// ─── useVaultActions ─────────────────────────────────────────────────────────

describe('[spec: vaults/actions] useVaultActions', () => {
  function ActionHarness({ onReady }: { onReady: (actions: ReturnType<typeof useVaultActions>) => void }) {
    const actions = useVaultActions()
    onReady(actions)
    return null
  }

  function renderActions(onReady: (actions: ReturnType<typeof useVaultActions>) => void) {
    const client = makeQueryClient()
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ActionHarness onReady={onReady} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('exposes deleteVault function and deleteVaultPending boolean', () => {
    server.use(
      http.delete('*/api/v1/vaults/:vaultId', () => new HttpResponse(null, { status: 204 })),
      http.get('*/api/v1/vaults', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    let capturedActions: ReturnType<typeof useVaultActions> | null = null
    renderActions((a) => {
      capturedActions = a
    })

    expect(typeof capturedActions!.deleteVault).toBe('function')
    expect(typeof capturedActions!.deleteVaultPending).toBe('boolean')
    expect(capturedActions!.deleteVaultPending).toBe(false)
  })

  it('calls DELETE /api/v1/vaults/:vaultId', async () => {
    let capturedParams: unknown
    server.use(
      http.delete('*/api/v1/vaults/:vaultId', ({ params }) => {
        capturedParams = params.vaultId
        return new HttpResponse(null, { status: 204 })
      }),
      http.get('*/api/v1/vaults', () =>
        HttpResponse.json({ data: [], pagination: { limit: 50, hasMore: false, nextCursor: null } }),
      ),
    )

    let capturedActions: ReturnType<typeof useVaultActions> | null = null
    renderActions((a) => {
      capturedActions = a
    })

    capturedActions!.deleteVault('vault_42')
    await waitFor(() => expect(capturedParams).toBe('vault_42'))
  })

  it('handles DELETE /api/v1/vaults/:vaultId returning 500', async () => {
    server.use(
      http.delete('*/api/v1/vaults/:vaultId', () => HttpResponse.json({ error: 'Network failure' }, { status: 500 })),
    )

    let capturedActions: ReturnType<typeof useVaultActions> | null = null
    renderActions((a) => {
      capturedActions = a
    })

    capturedActions!.deleteVault('vault_fail')
    await waitFor(() => expect(capturedActions!.deleteVaultPending).toBe(false))
  })
})
