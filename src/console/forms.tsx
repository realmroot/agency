import { ENBOR_SANDBOX_TOOL_NAMES } from '@enbor/runtime-contracts/agent-tools'
import { isRuntimeName } from '@enbor/runtime-contracts/runtime-names'
import { useQuery } from '@tanstack/react-query'
import { Bot, Boxes, ChevronDown, MessageSquare, Plus, Server, Trash2 } from 'lucide-react'
import type { FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { type Agent, api, type Environment, type Identity, type MemoryStore, type Vault } from '@/lib/enborrpc'
import { queryKeys } from '@/lib/query-keys'
import { parseTools } from './format'
import {
  type AgentFormState,
  ENVIRONMENT_PACKAGE_MANAGERS,
  type EnvironmentFormState,
  type EnvironmentPackageManager,
  type SessionFormState,
  type VaultFormState,
} from './types'

const PACKAGE_MANAGER_LABELS: Record<(typeof ENVIRONMENT_PACKAGE_MANAGERS)[number], string> = {
  apt: 'APT',
  cargo: 'Cargo',
  gem: 'Gem',
  go: 'Go',
  npm: 'NPM',
  pip: 'Pip',
  webi: 'Webi',
}

export function EnvironmentForm({
  value,
  setValue,
  onSubmit,
  errors,
}: {
  value: EnvironmentFormState
  setValue: (value: EnvironmentFormState) => void
  onSubmit: (event: FormEvent) => void
  errors?: { name?: string }
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <TextField
          label="Name"
          value={value.name}
          onChange={(name) => setValue({ ...value, name })}
          {...(errors?.name ? { error: errors.name } : {})}
        />
        <TextField
          label="Description"
          value={value.description}
          onChange={(description) => setValue({ ...value, description })}
        />
        <Field>
          <FieldLabel>Environment type</FieldLabel>
          <Select
            value={value.type}
            onValueChange={(type) => setValue({ ...value, type: type as EnvironmentFormState['type'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="cloud">Cloud</SelectItem>
                <SelectItem value="self_hosted">Self-hosted</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Cloud sessions start in Cloudflare Sandbox. Self-hosted sessions wait for a runner.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Network mode</FieldLabel>
          <Select
            value={value.networkingType}
            onValueChange={(networkingType) =>
              setValue({ ...value, networkingType: networkingType as EnvironmentFormState['networkingType'] })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="limited">Limited</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Limited networking allows only the hosts listed below. Closed networking blocks outbound requests.
          </FieldDescription>
        </Field>
        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor="field-allow-mcp">Allow MCP servers</FieldLabel>
          <Switch
            id="field-allow-mcp"
            checked={value.allowMcpServers}
            onCheckedChange={(checked) => setValue({ ...value, allowMcpServers: checked === true })}
          />
        </Field>
        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor="field-allow-package-managers">Allow package managers</FieldLabel>
          <Switch
            id="field-allow-package-managers"
            checked={value.allowPackageManagers}
            onCheckedChange={(checked) => setValue({ ...value, allowPackageManagers: checked === true })}
          />
        </Field>
        {value.networkingType === 'limited' ? (
          <TextAreaField
            label="Allowed hosts"
            description="One lowercase hostname per line. Do not include protocols, paths, or ports."
            value={value.allowedHosts}
            onChange={(allowedHosts) => setValue({ ...value, allowedHosts })}
          />
        ) : null}
        <PackageManagerFields value={value} setValue={setValue} />
        <TextAreaField
          label="Variables"
          description="One variable per line using KEY=description. Secret values are stored separately."
          value={value.variables}
          onChange={(variables) => setValue({ ...value, variables })}
        />
      </FieldGroup>
      <Button type="submit">
        <Server data-icon="inline-start" />
        Save environment
      </Button>
    </form>
  )
}

function PackageManagerFields({
  value,
  setValue,
}: {
  value: EnvironmentFormState
  setValue: (value: EnvironmentFormState) => void
}) {
  const packages = value.packages
  const updatePackage = (index: number, patch: Partial<{ manager: EnvironmentPackageManager; name: string }>) => {
    setValue({
      ...value,
      packages: packages.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    })
  }
  const addPackage = () => {
    setValue({
      ...value,
      packages: [
        ...packages,
        { id: `pkg-${Date.now()}-${Math.random().toString(16).slice(2)}`, manager: 'npm', name: '' },
      ],
    })
  }
  const removePackage = (index: number) => {
    setValue({ ...value, packages: packages.filter((_, itemIndex) => itemIndex !== index) })
  }

  return (
    <FieldSet>
      <FieldLegend>Packages</FieldLegend>
      <FieldDescription>
        Add one package per row. Select the package manager, then enter the package name.
      </FieldDescription>
      <div className="flex flex-col gap-3">
        {packages.map((item, index) => (
          <div key={item.id} className="grid grid-cols-[7rem_minmax(0,1fr)_2rem] items-start gap-2">
            <Select
              value={item.manager}
              onValueChange={(manager) => updatePackage(index, { manager: manager as EnvironmentPackageManager })}
            >
              <SelectTrigger className="w-28" aria-label={`Package ${index + 1} manager`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ENVIRONMENT_PACKAGE_MANAGERS.map((manager) => (
                    <SelectItem key={manager} value={manager}>
                      {PACKAGE_MANAGER_LABELS[manager]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input
              aria-label={`Package ${index + 1} name`}
              value={item.name}
              placeholder="name@version"
              onChange={(event) => updatePackage(index, { name: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove package ${index + 1}`}
              onClick={() => removePackage(index)}
            >
              <Trash2 data-icon="inline-start" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" className="w-fit" onClick={addPackage}>
          <Plus data-icon="inline-start" />
          Add package
        </Button>
      </div>
    </FieldSet>
  )
}

export function AgentForm({
  value,
  setValue,
  onSubmit,
  identities = [],
  agentId,
  submitLabel = 'Save agent',
}: {
  value: AgentFormState
  setValue: (value: AgentFormState) => void
  onSubmit: (event: FormEvent) => void
  identities?: Identity[]
  agentId?: string
  submitLabel?: string
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <TextField label="Name" value={value.name} onChange={(name) => setValue({ ...value, name })} />
        <TextField
          label="Description"
          value={value.description}
          onChange={(description) => setValue({ ...value, description })}
        />
        <TextAreaField
          label="System prompt"
          description="System prompt the agent follows for every session."
          value={value.systemPrompt}
          onChange={(systemPrompt) => setValue({ ...value, systemPrompt })}
        />
        <AgentProviderModelFields value={value} setValue={setValue} />
        <Field>
          <FieldLabel>Identity</FieldLabel>
          <Select
            value={value.identityRef || '__none__'}
            onValueChange={(identityRef) =>
              setValue({ ...value, identityRef: identityRef === '__none__' ? '' : identityRef })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="No Identity" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__none__">No Identity</SelectItem>
                {identities
                  .filter(
                    (identity) =>
                      identity.status.state === 'active' &&
                      (!identity.status.boundAgentId || identity.status.boundAgentId === agentId),
                  )
                  .map((identity) => (
                    <SelectItem key={identity.metadata.uid} value={identity.metadata.uid}>
                      {identity.metadata.name} · {identity.spec.runtime}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            The selected identity sets the runtime for this agent's sessions and triggers.
          </FieldDescription>
        </Field>
        <AllowedToolsField
          label="Allowed tools"
          value={value.allowedTools}
          onChange={(allowedTools) => setValue({ ...value, allowedTools })}
        />
        <TextAreaField
          label="Skills"
          description="One stable skill reference per line, such as source@skill."
          value={value.skills}
          onChange={(skills) => setValue({ ...value, skills })}
        />
        <TextAreaField
          label="MCP connectors"
          description="One connector id per line. Connectors must already be approved for the project."
          value={value.mcpConnectors}
          onChange={(mcpConnectors) => setValue({ ...value, mcpConnectors })}
        />
      </FieldGroup>
      <Button type="submit">
        <Bot data-icon="inline-start" />
        {submitLabel}
      </Button>
    </form>
  )
}

export function AllowedToolsField({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string | undefined
}) {
  const selectId = `field-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`
  const selected = parseTools(value)
  const selectedLabel =
    selected.length === 0
      ? 'Select allowed tools'
      : selected.length === 1
        ? selected[0]
        : `${selected.length} tools selected`
  const updateTool = (tool: string, checked: boolean | 'indeterminate') => {
    const nextTools =
      checked === true ? [...selected.filter((name) => name !== tool), tool] : selected.filter((name) => name !== tool)
    onChange(nextTools.join('\n'))
  }

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={selectId} type="button" variant="outline" className="w-full justify-between">
            <span className="truncate">{selectedLabel}</span>
            <ChevronDown data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          {ENBOR_SANDBOX_TOOL_NAMES.map((tool) => (
            <DropdownMenuCheckboxItem
              key={tool}
              checked={selected.includes(tool)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => updateTool(tool, checked)}
            >
              {tool}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

// The model catalog is global. Selecting a model pins both its vendor and id;
// leaving it empty lets the runtime choose without inventing a model value.
function AgentProviderModelFields({
  value,
  setValue,
}: {
  value: AgentFormState
  setValue: (value: AgentFormState) => void
}) {
  const modelsQuery = useQuery({
    queryKey: queryKeys.providers.models,
    queryFn: () => api.listModels(),
  })
  const models = (modelsQuery.data?.data ?? []).filter((model) => model.availability === 'available')
  const selectedModelKey = value.model ? `${value.provider}::${value.model}` : ''
  const hasSelected = models.some((model) => model.providerId === value.provider && model.modelId === value.model)
  return (
    <Field>
      <FieldLabel htmlFor="field-model">Model</FieldLabel>
      <Select
        value={selectedModelKey || '__none__'}
        onValueChange={(key) => {
          if (key === '__none__') {
            setValue({ ...value, provider: '', model: '' })
            return
          }
          const [provider, ...rest] = key.split('::')
          setValue({ ...value, provider: provider ?? '', model: rest.join('::') })
        }}
      >
        <SelectTrigger id="field-model">
          <SelectValue placeholder="Select a model" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="__none__">No model selected</SelectItem>
            {models.map((model) => (
              <SelectItem key={`${model.providerId}::${model.modelId}`} value={`${model.providerId}::${model.modelId}`}>
                {model.displayName || model.modelId} ({model.providerId})
              </SelectItem>
            ))}
            {value.model && !hasSelected ? (
              <SelectItem value={selectedModelKey}>
                {value.model} ({value.provider})
              </SelectItem>
            ) : null}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldDescription>
        Leave this empty to let the runtime choose. Picking a model pins its vendor and model id.
      </FieldDescription>
    </Field>
  )
}

export function SessionForm({
  value,
  setValue,
  agents,
  environments,
  memoryStores = [],
  vaults = [],
  onSubmit,
}: {
  value: SessionFormState
  setValue: (value: SessionFormState) => void
  agents: Agent[]
  environments: Environment[]
  memoryStores?: MemoryStore[]
  vaults?: Vault[]
  onSubmit: (event: FormEvent) => void
}) {
  const activeAgents = agents
  const activeEnvironments = environments
  const selectedAgent = activeAgents.find((agent) => agent.metadata.uid === value.agentId)
  const selectedEnvironment = activeEnvironments.find((environment) => environment.metadata.uid === value.environmentId)
  const canSubmit = Boolean(value.agentId && value.environmentId && value.prompt.trim())

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <Field>
          <FieldLabel>Agent</FieldLabel>
          <Select
            value={value.agentId}
            onValueChange={(agentId) => {
              const identityRuntime = activeAgents.find((agent) => agent.metadata.uid === agentId)?.spec.identity
                ?.runtime
              setValue({ ...value, agentId, ...(isRuntimeName(identityRuntime) ? { runtime: identityRuntime } : {}) })
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select an agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {activeAgents.map((agent) => (
                  <SelectItem key={agent.metadata.uid} value={agent.metadata.uid}>
                    {agent.metadata.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {selectedAgent
              ? `Agent provider/model: ${selectedAgent.spec.provider ?? 'None'} / ${selectedAgent.spec.model ?? 'None'}`
              : 'The session will run the current version of this agent.'}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Environment</FieldLabel>
          <Select value={value.environmentId} onValueChange={(environmentId) => setValue({ ...value, environmentId })}>
            <SelectTrigger>
              <SelectValue placeholder="Select an environment" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {activeEnvironments.map((environment) => (
                  <SelectItem key={environment.metadata.uid} value={environment.metadata.uid}>
                    {environment.metadata.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {selectedEnvironment
              ? `Environment type: ${hostingModeLabel(selectedEnvironment.spec.type)}`
              : 'Select the hosting and policy environment for this session.'}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Runtime</FieldLabel>
          <Select
            value={value.runtime}
            disabled={Boolean(selectedAgent?.spec.identity)}
            onValueChange={(runtime) => setValue({ ...value, runtime: runtime as SessionFormState['runtime'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="ama">Enbor</SelectItem>
                <SelectItem value="claude-code">Claude Code</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="copilot">Copilot</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            {selectedAgent?.spec.identity ? 'Set by the selected identity.' : 'Runtime is selected per session.'}
          </FieldDescription>
        </Field>
        <TextAreaField
          label="Prompt"
          description="Task to run when the session starts. The session name is generated from this prompt."
          value={value.prompt}
          onChange={(prompt) => setValue({ ...value, prompt })}
        />
        <CredentialVaultsField vaults={vaults} value={value} setValue={setValue} />
        <SessionResourcesField memoryStores={memoryStores} value={value} setValue={setValue} />
      </FieldGroup>
      <Button type="submit" disabled={!canSubmit}>
        <MessageSquare data-icon="inline-start" />
        Create session
      </Button>
    </form>
  )
}

function CredentialVaultsField({
  vaults,
  value,
  setValue,
}: {
  vaults: Vault[]
  value: SessionFormState
  setValue: (value: SessionFormState) => void
}) {
  const activeVaults = vaults
  const selectedVaults = activeVaults.filter((vault) => value.credentialVaultIds.includes(vault.metadata.uid))
  const triggerLabel =
    selectedVaults.length === 0
      ? 'Select credential vaults'
      : selectedVaults.length === 1
        ? selectedVaults[0]!.metadata.name
        : `${selectedVaults.length} vaults selected`
  function updateVault(vaultId: string, checked: boolean | 'indeterminate') {
    const nextIds = value.credentialVaultIds.filter((id) => id !== vaultId)
    if (checked === true) {
      nextIds.push(vaultId)
    }
    setValue({ ...value, credentialVaultIds: nextIds })
  }
  return (
    <Field>
      <FieldLabel>Credential vaults</FieldLabel>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between">
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-72">
          {activeVaults.length > 0 ? (
            activeVaults.map((vault) => (
              <DropdownMenuCheckboxItem
                key={vault.metadata.uid}
                checked={value.credentialVaultIds.includes(vault.metadata.uid)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => updateVault(vault.metadata.uid, checked)}
              >
                <span className="min-w-0">
                  <span className="block truncate">{vault.metadata.name}</span>
                  {vault.metadata.description ? (
                    <span className="block truncate text-xs text-muted-foreground">{vault.metadata.description}</span>
                  ) : null}
                </span>
              </DropdownMenuCheckboxItem>
            ))
          ) : (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No credential vaults available.</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <FieldDescription>
        Selected vaults are mounted into the session workspace as read-only secret resources.
      </FieldDescription>
    </Field>
  )
}

function SessionResourcesField({
  memoryStores,
  value,
  setValue,
}: {
  memoryStores: MemoryStore[]
  value: SessionFormState
  setValue: (value: SessionFormState) => void
}) {
  function addResource() {
    setValue({
      ...value,
      resources: [
        ...value.resources,
        {
          id: `resource-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          type: 'git_repository',
          url: '',
          ref: '',
        },
      ],
    })
  }
  function removeResource(resourceId: string) {
    setValue({ ...value, resources: value.resources.filter((resource) => resource.id !== resourceId) })
  }
  function updateGitResource(resourceId: string, patch: { url?: string; ref?: string }) {
    setValue({
      ...value,
      resources: value.resources.map((resource) =>
        resource.id === resourceId && resource.type === 'git_repository' ? { ...resource, ...patch } : resource,
      ),
    })
  }
  function updateMemoryResource(resourceId: string, patch: { memoryStoreId?: string; readOnly?: boolean }) {
    setValue({
      ...value,
      resources: value.resources.map((resource) =>
        resource.id === resourceId && resource.type === 'memory' ? { ...resource, ...patch } : resource,
      ),
    })
  }
  function updateResourceType(resourceId: string, type: SessionFormState['resources'][number]['type']) {
    if (type === 'memory') {
      setValue({
        ...value,
        resources: value.resources.map((resource) =>
          resource.id === resourceId
            ? {
                id: resource.id,
                type: 'memory',
                memoryStoreId: memoryStores[0]?.metadata.uid ?? '',
                readOnly: true,
              }
            : resource,
        ),
      })
      return
    }
    setValue({
      ...value,
      resources: value.resources.map((resource) =>
        resource.id === resourceId ? { id: resource.id, type: 'git_repository', url: '', ref: '' } : resource,
      ),
    })
  }
  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>Resources</FieldLabel>
        <Button type="button" variant="outline" size="sm" onClick={addResource}>
          <Plus data-icon="inline-start" />
          Add resource
        </Button>
      </div>
      <div className="space-y-3 rounded-md border p-3">
        {value.resources.length > 0 ? (
          value.resources.map((resource, index) => {
            const readOnlySwitchId = domId('session-resource-read-only', `${resource.id}-${index}`)
            return (
              <div key={resource.id} className="grid gap-3 rounded-md border bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <Select
                    value={resource.type}
                    onValueChange={(type) =>
                      updateResourceType(resource.id, type as SessionFormState['resources'][number]['type'])
                    }
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="git_repository">Git repository</SelectItem>
                        <SelectItem value="memory">Memory</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => removeResource(resource.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {resource.type === 'git_repository' ? (
                  <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                    <Input
                      aria-label="Git repository URL"
                      placeholder="https://github.com/org/repo.git"
                      value={resource.url}
                      onChange={(event) => updateGitResource(resource.id, { url: event.target.value })}
                    />
                    <Input
                      aria-label="Git repository ref"
                      placeholder="main"
                      value={resource.ref}
                      onChange={(event) => updateGitResource(resource.id, { ref: event.target.value })}
                    />
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <Select
                      value={resource.memoryStoreId}
                      onValueChange={(memoryStoreId) => updateMemoryResource(resource.id, { memoryStoreId })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select memory" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {memoryStores.map((store) => (
                            <SelectItem key={store.metadata.uid} value={store.metadata.uid}>
                              {store.metadata.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <label
                      htmlFor={readOnlySwitchId}
                      className="flex min-h-10 items-center gap-2 rounded-md border px-3"
                    >
                      <Switch
                        id={readOnlySwitchId}
                        checked={resource.readOnly}
                        onCheckedChange={(readOnly) => updateMemoryResource(resource.id, { readOnly })}
                      />
                      <span className="text-sm">Read only</span>
                    </label>
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <p className="text-sm text-muted-foreground">No resources attached.</p>
        )}
      </div>
      <FieldDescription>Enbor manages mount paths for attached repositories and memory stores.</FieldDescription>
    </Field>
  )
}

function domId(prefix: string, value: string) {
  const safe = value.replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '')
  return `${prefix}-${safe || 'field'}`
}

function hostingModeLabel(value: Environment['spec']['type']) {
  return value === 'self_hosted' ? 'Self-hosted' : 'Cloud'
}

export function VaultForm({
  value,
  setValue,
  onSubmit,
}: {
  value: VaultFormState
  setValue: (value: VaultFormState) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <FieldGroup>
        <TextField label="Name" value={value.name} onChange={(name) => setValue({ ...value, name })} />
        <TextField
          label="Description"
          value={value.description}
          onChange={(description) => setValue({ ...value, description })}
        />
        <Field>
          <FieldLabel>Scope</FieldLabel>
          <Select
            value={value.scope}
            onValueChange={(scope) => setValue({ ...value, scope: scope as VaultFormState['scope'] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="project">project</SelectItem>
                <SelectItem value="organization">organization</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>Project vaults are the default for runtime secret references.</FieldDescription>
        </Field>
      </FieldGroup>
      <Button type="submit">
        <Boxes data-icon="inline-start" />
        Save vault
      </Button>
    </form>
  )
}

export function TextField({
  label,
  description,
  value,
  onChange,
  error,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  error?: string | undefined
}) {
  const id = `field-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}

export function TextAreaField({
  label,
  description,
  value,
  onChange,
  error,
}: {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  error?: string | undefined
}) {
  const id = `field-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}
