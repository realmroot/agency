import { isRuntimeName } from '@ama/runtime-contracts/runtime-names'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock } from 'lucide-react'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TextAreaField, TextField } from '@/console/forms'
import { api, type RuntimeName } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'

const EMPTY_RESOURCES: never[] = []

const INTERVAL_UNITS = {
  minutes: 60,
  hours: 3600,
  days: 86400,
} as const

type IntervalUnit = keyof typeof INTERVAL_UNITS

interface TriggerFormState {
  type: 'scheduled' | 'http' | 'inbox'
  name: string
  agentId: string
  environmentId: string
  runtime: RuntimeName
  promptTemplate: string
  intervalValue: string
  intervalUnit: IntervalUnit
  suspend: boolean
}

const emptyTrigger: TriggerFormState = {
  type: 'scheduled',
  name: '',
  agentId: '',
  environmentId: '',
  runtime: 'ama',
  promptTemplate: '',
  intervalValue: '1',
  intervalUnit: 'days',
  suspend: false,
}

const MIN_INTERVAL_SECONDS = 60

function intervalSeconds(form: TriggerFormState) {
  const value = Number.parseInt(form.intervalValue, 10)
  if (!Number.isFinite(value) || value < 1) {
    return MIN_INTERVAL_SECONDS
  }
  return Math.max(MIN_INTERVAL_SECONDS, value * INTERVAL_UNITS[form.intervalUnit])
}

export function CreateTriggerSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<TriggerFormState>(emptyTrigger)
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(),
    queryFn: () => api.listAgents(),
    enabled: open,
  })
  const environmentsQuery = useQuery({
    queryKey: queryKeys.environments.list(),
    queryFn: () => api.listEnvironments(),
    enabled: open,
  })
  const runnersQuery = useQuery({
    queryKey: queryKeys.runners.list({ state: 'active' }),
    queryFn: () => api.listRunners({ state: 'active' }),
    enabled: open,
  })
  const agents = agentsQuery.data?.data ?? EMPTY_RESOURCES
  const allEnvironments = environmentsQuery.data?.data ?? EMPTY_RESOURCES
  const runners = runnersQuery.data?.data ?? EMPTY_RESOURCES
  const boundRuntime = agents.find((agent) => agent.metadata.uid === form.agentId)?.spec.identity?.runtime
  const environments = boundRuntime
    ? allEnvironments.filter((environment) =>
        environment.spec.type === 'cloud'
          ? boundRuntime === 'ama'
          : runners.some(
              (runner) =>
                runner.environmentId === environment.metadata.uid &&
                runner.state === 'active' &&
                runner.runtimes.some((runtime) => runtime.runtime === boundRuntime && runtime.state === 'ready'),
            ),
      )
    : allEnvironments
  const selectedAgent = agents.find((agent) => agent.metadata.uid === form.agentId)
  const agentDescription = agentsQuery.isPending
    ? 'Loading agents.'
    : agents.length === 0
      ? 'No active agents exist in the current project.'
      : form.type === 'inbox' && selectedAgent && !selectedAgent.spec.identity
        ? 'Inbox triggers require a Realmroot-bound Agent. Select an Agent with an Identity.'
        : 'The trigger dispatches the current version of this agent.'
  const environmentDescription = environmentsQuery.isPending
    ? 'Loading environments.'
    : environments.length === 0
      ? 'No active environments exist in the current project.'
      : 'Select the hosting and policy environment for dispatched sessions.'
  const createTrigger = useMutation({
    mutationFn: () =>
      api.createTrigger({
        metadata: { name: form.name },
        spec: {
          source:
            form.type === 'scheduled'
              ? { type: 'schedule', schedule: { type: 'interval', intervalSeconds: intervalSeconds(form) } }
              : form.type === 'http'
                ? { type: 'http' }
                : { type: 'inbox' },
          suspend: form.suspend,
          template: {
            metadata: { labels: {}, annotations: {} },
            spec: {
              agentId: form.agentId,
              environmentId: form.environmentId,
              runtime: form.runtime,
              promptTemplate: form.promptTemplate,
              env: {},
              envFrom: [],
              volumes: [],
              volumeMounts: [],
            },
          },
        },
      }),
    onSuccess: () => {
      onOpenChange(false)
      setForm(emptyTrigger)
      toast.success('Trigger created')
      void queryClient.invalidateQueries({ queryKey: queryKeys.triggers.all })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  useEffect(() => {
    if (!open) return
    setForm((current) => {
      const nextAgentId = current.agentId || agents[0]?.metadata.uid || ''
      const nextEnvironmentId = environments.some((environment) => environment.metadata.uid === current.environmentId)
        ? current.environmentId
        : environments[0]?.metadata.uid || ''
      const identityRuntime = agents.find((agent) => agent.metadata.uid === nextAgentId)?.spec.identity?.runtime
      const supportedIdentityRuntime = isRuntimeName(identityRuntime) ? identityRuntime : undefined
      if (
        current.agentId === nextAgentId &&
        current.environmentId === nextEnvironmentId &&
        (!supportedIdentityRuntime || current.runtime === supportedIdentityRuntime)
      ) {
        return current
      }
      return {
        ...current,
        agentId: nextAgentId,
        environmentId: nextEnvironmentId,
        ...(supportedIdentityRuntime ? { runtime: supportedIdentityRuntime } : {}),
      }
    })
  }, [agents, environments, open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    createTrigger.mutate()
  }

  const canSubmit = Boolean(
    form.name.trim() &&
      form.agentId &&
      form.environmentId &&
      form.promptTemplate.trim() &&
      (form.type !== 'scheduled' || form.intervalValue.trim()) &&
      (form.type !== 'inbox' || selectedAgent?.spec.identity),
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Trigger</SheetTitle>
          <SheetDescription>Wake an agent from a schedule, an authenticated HTTP request, or Inbox.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <FieldGroup>
              <TextField label="Name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
              <Field>
                <FieldLabel>Type</FieldLabel>
                <Select
                  value={form.type}
                  onValueChange={(type) => setForm({ ...form, type: type as TriggerFormState['type'] })}
                >
                  <SelectTrigger aria-label="Trigger type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="scheduled">scheduled</SelectItem>
                      <SelectItem value="http">HTTP POST</SelectItem>
                      <SelectItem value="inbox">Inbox</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Scheduled triggers run on an interval. HTTP triggers accept a POST. Inbox triggers subscribe to
                  message notifications.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="trigger-agent">Agent</FieldLabel>
                <Select
                  value={form.agentId}
                  onValueChange={(agentId) => {
                    const identityRuntime = agents.find((agent) => agent.metadata.uid === agentId)?.spec.identity
                      ?.runtime
                    setForm({
                      ...form,
                      agentId,
                      ...(isRuntimeName(identityRuntime) ? { runtime: identityRuntime } : {}),
                    })
                  }}
                >
                  <SelectTrigger id="trigger-agent" className="w-full">
                    <SelectValue placeholder="Select an agent" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {agents.map((agent) => (
                        <SelectItem key={agent.metadata.uid} value={agent.metadata.uid}>
                          {agent.metadata.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{agentDescription}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="trigger-environment">Environment</FieldLabel>
                <Select
                  value={form.environmentId}
                  onValueChange={(environmentId) => setForm({ ...form, environmentId })}
                >
                  <SelectTrigger id="trigger-environment" className="w-full">
                    <SelectValue placeholder="Select an environment" />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {environments.map((environment) => (
                        <SelectItem key={environment.metadata.uid} value={environment.metadata.uid}>
                          {environment.metadata.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>{environmentDescription}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Runtime</FieldLabel>
                <Select
                  value={form.runtime}
                  disabled={Boolean(selectedAgent?.spec.identity)}
                  onValueChange={(runtime) => setForm({ ...form, runtime: runtime as RuntimeName })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="ama">AMA</SelectItem>
                      <SelectItem value="claude-code">Claude Code</SelectItem>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="copilot">Copilot</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  {selectedAgent?.spec.identity
                    ? `Locked by ${selectedAgent.spec.identity.username}'s Identity.`
                    : 'Runtime used for every dispatched session.'}
                </FieldDescription>
              </Field>
              <TextAreaField
                label="Prompt template"
                description={
                  form.type === 'http'
                    ? 'Use variables like {{ body.ticket.id }}, {{ query.source }}, or {{ headers.x-source }}.'
                    : form.type === 'inbox'
                      ? 'Instructions prepended to the message reference. The Agent reads the complete Message with its own Realmroot identity.'
                      : 'The prompt the agent runs on each scheduled dispatch.'
                }
                value={form.promptTemplate}
                onChange={(promptTemplate) => setForm({ ...form, promptTemplate })}
              />
              {form.type === 'scheduled' ? (
                <Field>
                  <FieldLabel htmlFor="field-interval">Interval</FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="field-interval"
                      type="number"
                      min={1}
                      aria-label="Interval value"
                      value={form.intervalValue}
                      onChange={(event) => setForm({ ...form, intervalValue: event.target.value })}
                      className="w-28"
                    />
                    <Select
                      value={form.intervalUnit}
                      onValueChange={(intervalUnit) => setForm({ ...form, intervalUnit: intervalUnit as IntervalUnit })}
                    >
                      <SelectTrigger className="w-40" aria-label="Interval unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="minutes">minutes</SelectItem>
                          <SelectItem value="hours">hours</SelectItem>
                          <SelectItem value="days">days</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </div>
                  <FieldDescription>The minimum effective granularity is 1 minute.</FieldDescription>
                </Field>
              ) : form.type === 'http' ? (
                <Field>
                  <FieldLabel>HTTP entry</FieldLabel>
                  <FieldDescription>
                    Send a POST request with JSON to /api/v1/triggers/&lt;triggerId&gt;/runs using an authorized access
                    token.
                  </FieldDescription>
                </Field>
              ) : (
                <Field>
                  <FieldLabel>Inbox Subscription</FieldLabel>
                  <FieldDescription>
                    Requires a Realmroot-bound Agent. Agency provisions and maintains one Inbox Subscription for this
                    Trigger.
                  </FieldDescription>
                </Field>
              )}
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select
                  value={form.suspend ? 'paused' : 'active'}
                  onValueChange={(status) => setForm({ ...form, suspend: status === 'paused' })}
                >
                  <SelectTrigger aria-label="Status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="active">active</SelectItem>
                      <SelectItem value="paused">paused</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>Paused triggers are created but do not dispatch until resumed.</FieldDescription>
              </Field>
            </FieldGroup>
            <Button type="submit" disabled={!canSubmit || createTrigger.isPending}>
              <AlarmClock data-icon="inline-start" />
              {createTrigger.isPending ? 'Creating…' : 'Create trigger'}
            </Button>
          </form>
          {createTrigger.error ? (
            <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage(createTrigger.error)}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
