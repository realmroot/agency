import { Bot, Server } from 'lucide-react'
import { Link } from 'react-router'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge } from '@/console/components'
import { isArchived } from '@/console/format'
import { AllowedToolsField, TextAreaField, TextField } from '@/console/forms'
import { CoreStep, StartStep } from '@/features/agents/AgentBuilderSteps'
import type { AgentBuilderDraft, AgentTemplate, BuilderFieldErrors } from '@/features/agents/agent-builder-model'
import { JsonBlock } from '@/features/console/json-block'
import type { Environment, Provider } from '@/lib/amarpc'
import {
  type QuickstartEnvironmentForm,
  type QuickstartIntegrationInput,
  quickstartIntegrationExamples,
} from './quickstart-model'

export function OpenPageLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      {label}
    </Link>
  )
}

// ─── Provider step ───

export function QuickstartProviderStep({
  providers,
  onRunDefault,
  runPending,
  onContinue,
}: {
  providers: Provider[]
  onRunDefault: () => void
  runPending: boolean
  onContinue: () => void
}) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Workers AI is the seeded platform default. Sessions can run with no Anthropic or other vendor credential.
        Configure additional providers on the Providers page when you need them.
      </p>
      <ul className="grid gap-2" aria-label="Available providers">
        {providers.map((provider) => (
          <li key={provider.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">{provider.displayName}</span>
            <span className="font-mono text-xs text-muted-foreground">{provider.slug}</span>
            <StatusBadge value={provider.enabled ? 'enabled' : 'disabled'} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={runPending} onClick={onRunDefault}>
          <Bot data-icon="inline-start" />
          {runPending ? 'Starting Workers AI agent' : 'Run the default Workers AI agent'}
        </Button>
        <Button type="button" variant="outline" onClick={onContinue}>
          Continue to next step
        </Button>
        <OpenPageLink to="/settings/providers" label="Open providers" />
      </div>
      <p className="text-xs text-muted-foreground">
        The one-click run creates a starter agent on the default Workers AI model, a reusable environment, and a session
        that sends a safe example prompt.
      </p>
    </div>
  )
}

// ─── Environment step ───

export function QuickstartEnvironmentStep({
  form,
  setForm,
  environments,
  onCreate,
  createPending,
  onSelectExisting,
}: {
  form: QuickstartEnvironmentForm
  setForm: (form: QuickstartEnvironmentForm) => void
  environments: Environment[]
  onCreate: () => void
  createPending: boolean
  onSelectExisting: (environmentId: string) => void
}) {
  const activeEnvironments = environments.filter((environment) => !isArchived(environment))
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Environments are reusable sandbox templates, not running containers. Each session starts from this template, and
        the environment step must be completed before creating a session.
      </p>
      <TextField label="Environment name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
      <Field>
        <FieldLabel>Networking</FieldLabel>
        <Select
          value={form.networkChoice}
          onValueChange={(networkChoice) =>
            setForm({ ...form, networkChoice: networkChoice as QuickstartEnvironmentForm['networkChoice'] })
          }
        >
          <SelectTrigger aria-label="Networking">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="unrestricted">Unrestricted networking</SelectItem>
              <SelectItem value="restricted">Limited networking</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldDescription>
          Limited networking restricts the sandbox to the hosts, MCP access, and package-manager access below. Pick an
          existing environment instead for a fully custom setup.
        </FieldDescription>
      </Field>
      {form.networkChoice === 'restricted' ? (
        <div className="grid gap-4">
          <TextAreaField
            label="Allowed hosts"
            description="One lowercase hostname per line. Do not include protocols, paths, or ports."
            value={form.allowedHosts}
            onChange={(allowedHosts) => setForm({ ...form, allowedHosts })}
          />
          <Field orientation="horizontal">
            <Checkbox
              id="quickstart-mcp-access"
              checked={form.mcpAccess}
              onCheckedChange={(checked) => setForm({ ...form, mcpAccess: checked === true })}
            />
            <FieldLabel htmlFor="quickstart-mcp-access">Allow MCP connector access</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="quickstart-package-manager-access"
              checked={form.packageManagerAccess}
              onCheckedChange={(checked) => setForm({ ...form, packageManagerAccess: checked === true })}
            />
            <FieldLabel htmlFor="quickstart-package-manager-access">Allow package-manager registry access</FieldLabel>
          </Field>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!form.name.trim() || createPending} onClick={onCreate}>
          <Server data-icon="inline-start" />
          {createPending ? 'Creating environment' : 'Create environment'}
        </Button>
        <OpenPageLink to="/environments" label="Open environments" />
      </div>
      {activeEnvironments.length > 0 ? (
        <Field>
          <FieldLabel>Use a custom environment</FieldLabel>
          <Select onValueChange={onSelectExisting}>
            <SelectTrigger aria-label="Custom environment">
              <SelectValue placeholder="Select an existing environment" />
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
          <FieldDescription>Selecting an existing environment completes this step without changes.</FieldDescription>
        </Field>
      ) : null}
    </div>
  )
}

// ─── Agent step ───

export function QuickstartAgentStep({
  draft,
  goal,
  setGoal,
  onDraft,
  onUseTemplate,
  onStartFromScratch,
  onDiscardDraft,
  setField,
  errors,
  onCreate,
  createPending,
}: {
  draft: AgentBuilderDraft | null
  goal: string
  setGoal: (value: string) => void
  onDraft: () => void
  onUseTemplate: (template: AgentTemplate) => void
  onStartFromScratch: () => void
  onDiscardDraft: () => void
  setField: <K extends keyof AgentBuilderDraft>(field: K, value: AgentBuilderDraft[K]) => void
  errors: BuilderFieldErrors
  onCreate: () => void
  createPending: boolean
}) {
  if (draft === null) {
    return (
      <div className="grid gap-4">
        <StartStep
          goal={goal}
          setGoal={setGoal}
          onDraftFromGoal={onDraft}
          onUseTemplate={onUseTemplate}
          onSkip={onStartFromScratch}
        />
        <div>
          <OpenPageLink to="/agents/new" label="Open agent builder" />
        </div>
      </div>
    )
  }
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Review the drafted configuration. Everything stays editable until you create the agent.
      </p>
      <CoreStep draft={draft} errors={errors} setField={setField} />
      <AllowedToolsField
        label="Allowed tools"
        value={draft.allowedTools}
        onChange={(value) => setField('allowedTools', value)}
        error={errors.allowedTools}
      />
      <Field data-invalid={errors.mcpConnectors ? true : undefined}>
        <FieldLabel>MCP connectors</FieldLabel>
        <p className="text-sm">{draft.mcpConnectors.length > 0 ? draft.mcpConnectors.join(', ') : 'None drafted'}</p>
        <FieldDescription>
          Connector wiring, approvals, and schemas are managed in the full agent builder after quickstart.
        </FieldDescription>
        {errors.mcpConnectors ? <FieldError>{errors.mcpConnectors}</FieldError> : null}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={createPending} onClick={onCreate}>
          <Bot data-icon="inline-start" />
          {createPending ? 'Creating agent' : 'Create agent'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDiscardDraft}>
          Back to templates
        </Button>
        <OpenPageLink to="/agents" label="Open agents" />
      </div>
    </div>
  )
}

// ─── Integration step ───

export function QuickstartIntegrationStep({ input }: { input: QuickstartIntegrationInput | null }) {
  if (!input) {
    return (
      <p className="text-sm text-muted-foreground">
        Create a session in the previous step to generate integration examples for it.
      </p>
    )
  }
  const examples = quickstartIntegrationExamples(input)
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Realmroot discovers AMA&apos;s protected Resource and OpenAPI contract, requests the exact scope, and signs
        every call with your stable Agent identity. No token is copied into the command.
      </p>
      <Field>
        <FieldLabel>Realmroot CLI</FieldLabel>
        <JsonBlock value={examples.realmroot} />
        <FieldDescription>
          Realmroot handles controller approval, least-privilege scopes, and DPoP signing.
        </FieldDescription>
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <OpenPageLink to={`/sessions/${input.sessionId}`} label="Open session detail" />
        <OpenPageLink to="/usage" label="Open usage" />
      </div>
    </div>
  )
}
