import { isRuntimeName } from '@enbor/runtime-contracts/runtime-names'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { emptySession } from '@/console/defaults'
import { SessionForm } from '@/console/forms'
import type { SessionFormState } from '@/console/types'
import { ApiError, api, type Session } from '@/lib/enborrpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { sessionResourcesInput } from './session-resource-input'

const EMPTY_RESOURCES: never[] = []

export function CreateSessionSheet({
  open,
  onOpenChange,
  agentId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId?: string | undefined
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SessionFormState>(emptySession)
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
  const memoryStoresQuery = useQuery({
    queryKey: queryKeys.memoryStores.list(),
    queryFn: () => api.listMemoryStores(),
    enabled: open,
  })
  const vaultsQuery = useQuery({
    queryKey: queryKeys.vaults.list(),
    queryFn: () => api.listVaults(),
    enabled: open,
  })
  const agents = agentsQuery.data?.data ?? EMPTY_RESOURCES
  const allEnvironments = environmentsQuery.data?.data ?? EMPTY_RESOURCES
  const runners = runnersQuery.data?.data ?? EMPTY_RESOURCES
  const identityRuntime = agents.find((agent) => agent.metadata.uid === form.agentId)?.spec.identity?.runtime
  const environments = identityRuntime
    ? allEnvironments.filter((environment) =>
        environment.spec.type === 'cloud'
          ? identityRuntime === 'ama'
          : runners.some(
              (runner) =>
                runner.environmentId === environment.metadata.uid &&
                runner.state === 'active' &&
                runner.runtimes.some((runtime) => runtime.runtime === identityRuntime && runtime.state === 'ready'),
            ),
      )
    : allEnvironments
  const memoryStores = memoryStoresQuery.data?.data ?? EMPTY_RESOURCES
  const vaults = vaultsQuery.data?.data ?? EMPTY_RESOURCES
  const createSession = useMutation({
    mutationFn: () => {
      const resources = sessionResourcesInput(form)
      return api.createSession({
        spec: {
          agentId: form.agentId,
          environmentId: form.environmentId,
          runtime: form.runtime,
          volumes: resources.volumes,
          volumeMounts: resources.volumeMounts,
        },
        prompt: form.prompt.trim(),
      })
    },
    onSuccess: (session: Session) => {
      onOpenChange(false)
      setForm(emptySession)
      toast.success('Session created')
      queryClient.setQueryData(queryKeys.sessions.detail(session.metadata.uid), session)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
      void navigate(`/sessions/${session.metadata.uid}`)
    },
    onError: (error) => toast.error(formatCreateSessionError(error)),
  })

  useEffect(() => {
    if (!open) return
    const activeAgent = agents[0]
    const activeEnvironment = environments[0]
    setForm((current) => {
      const nextAgentId = agentId || current.agentId || activeAgent?.metadata.uid || ''
      const nextEnvironmentId = environments.some((environment) => environment.metadata.uid === current.environmentId)
        ? current.environmentId
        : activeEnvironment?.metadata.uid || ''
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
  }, [agentId, agents, environments, open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    createSession.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Create Session</SheetTitle>
          <SheetDescription>Select the agent, environment, and runtime for this session.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          <SessionForm
            value={form}
            setValue={setForm}
            agents={agents}
            environments={environments}
            memoryStores={memoryStores}
            vaults={vaults}
            onSubmit={submit}
          />
          {createSession.error ? (
            <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formatCreateSessionError(createSession.error)}
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function formatCreateSessionError(error: unknown) {
  if (error instanceof ApiError) {
    const details = apiErrorDetails(error)
    if (
      details?.resourceType === 'runtime_catalog' &&
      typeof details.hostingMode === 'string' &&
      typeof details.runtime === 'string' &&
      typeof details.provider === 'string' &&
      typeof details.model === 'string'
    ) {
      return `Unsupported capability: ${hostingModeLabel(details.hostingMode)} session runtime ${details.runtime} cannot run Agent provider ${details.provider} with model ${details.model}.`
    }
  }
  return errorMessage(error)
}

function apiErrorDetails(error: ApiError) {
  if (!error.details || typeof error.details !== 'object') {
    return null
  }
  const body = error.details as { error?: { details?: unknown } }
  const details = body.error?.details
  return details && typeof details === 'object' && !Array.isArray(details) ? (details as Record<string, unknown>) : null
}

function hostingModeLabel(value: string) {
  return value === 'self_hosted' ? 'Self-hosted' : 'Cloud'
}
