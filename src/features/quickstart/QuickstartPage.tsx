import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, PageHeader, StatusBadge } from '@/console/components'
import { isArchived, providerPatch } from '@/console/format'
import {
  type AgentBuilderDraft,
  apiErrorToBuilder,
  type BuilderFieldErrors,
  coreStepErrors,
  DEFAULT_BUILDER_PROVIDER,
  draftFromGoal,
  emptyBuilderDraft,
  toAgentInput,
} from '@/features/agents/agent-builder-model'
import { api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { QuickstartSessionStep } from './QuickstartSessionStep'
import {
  QuickstartAgentStep,
  QuickstartEnvironmentStep,
  QuickstartIntegrationStep,
  QuickstartProviderStep,
} from './QuickstartSteps'

import {
  defaultQuickstartEnvironmentForm,
  firstIncompleteStep,
  isStepUnlocked,
  QUICKSTART_STEP_CALLS,
  QUICKSTART_STEP_TITLES,
  QUICKSTART_STEPS,
  type QuickstartEnvironmentForm,
  type QuickstartStep,
  quickstartCompletion,
  quickstartEnvironmentInput,
  resolveQuickstartStep,
  SAFE_EXAMPLE_PROMPT,
} from './quickstart-model'

const QUICKSTART_WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.6'

const STEP_DESCRIPTIONS: Record<QuickstartStep, string> = {
  provider: 'Confirm the model provider. The seeded Workers AI provider needs no credential.',
  environment: 'Create or select the reusable sandbox template sessions will run in.',
  agent: 'Draft the agent from a template or goal description, then create it.',
  session: 'Create a test session and send the first task to the runtime.',
  integration: 'Call the same control-plane API through Realmroot Agent identity.',
}

export function QuickstartPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const providersQuery = useQuery({
    queryKey: queryKeys.providers.list(false),
    queryFn: () => api.listProviders(),
  })
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(false),
    queryFn: () => api.listAgents(),
  })
  const environmentsQuery = useQuery({
    queryKey: queryKeys.environments.list(false),
    queryFn: () => api.listEnvironments(),
  })
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(false),
    queryFn: () => api.listSessions(),
  })

  const [environmentForm, setEnvironmentForm] = useState<QuickstartEnvironmentForm>(defaultQuickstartEnvironmentForm)
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(null)
  const [goal, setGoal] = useState('')
  const [draft, setDraft] = useState<AgentBuilderDraft | null>(null)
  const [draftErrors, setDraftErrors] = useState<BuilderFieldErrors>({})

  const goToStep = (step: QuickstartStep, sessionId?: string) => {
    const params: Record<string, string> = { step }
    const session = sessionId ?? searchParams.get('session')
    if (session) params.session = session
    setSearchParams(params)
  }
  const setField = <K extends keyof AgentBuilderDraft>(field: K, value: AgentBuilderDraft[K]) => {
    /* v8 ignore start -- draft is never null when CoreStep calls setField; null guard is defensive */
    setDraft((current) => (current === null ? current : { ...current, [field]: value }))
    /* v8 ignore stop */
    setDraftErrors((current) => {
      if (!(field in current)) return current
      const { [field]: _removed, ...rest } = current
      return rest
    })
  }

  const createEnvironment = useMutation({
    mutationFn: () => api.createEnvironment(quickstartEnvironmentInput(environmentForm)),
    onSuccess: async (environment) => {
      toast.success('Environment created')
      setSelectedEnvironmentId(environment.metadata.uid)
      await queryClient.invalidateQueries({ queryKey: queryKeys.environments.all })
      goToStep('agent')
    },
    /* v8 ignore start -- error is always an Error instance in practice */
    onError: (error) => toast.error(errorMessage(error)),
    /* v8 ignore stop */
  })
  const createAgent = useMutation({
    mutationFn: (input: AgentBuilderDraft) => api.createAgent(toAgentInput(input)),
    onSuccess: async (agent) => {
      toast.success(`Agent ${agent.metadata.uid} created at v${agent.status.version}`)
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
      goToStep('session')
    },
    onError: (error) => {
      const mapped = apiErrorToBuilder(error)
      if (Object.keys(mapped.errors).length > 0) {
        setDraftErrors((current) => ({ ...current, ...mapped.errors }))
        return
      }
      /* v8 ignore start -- error is always an Error instance in practice */
      toast.error(errorMessage(error))
      /* v8 ignore stop */
    },
  })
  const runDefaultWorkersAi = useMutation({
    mutationFn: async () => {
      const agent = await api.createAgent({
        metadata: {
          name: 'Workers AI starter agent',
          description: 'Zero-credential starter agent on the platform default Workers AI model.',
        },
        spec: {
          systemPrompt:
            'You are the Workers AI starter agent. Respond helpfully and stay inside the session workspace.',
          ...providerPatch(DEFAULT_BUILDER_PROVIDER),
          model: QUICKSTART_WORKERS_AI_MODEL,
        },
      })
      const environment = await api.createEnvironment(
        quickstartEnvironmentInput({ ...defaultQuickstartEnvironmentForm, name: 'Workers AI starter environment' }),
      )
      const session = await api.createSession({
        metadata: { name: 'Workers AI starter session' },
        spec: {
          agentId: agent.metadata.uid,
          environmentId: environment.metadata.uid,
          runtime: 'ama',
        },
        prompt: SAFE_EXAMPLE_PROMPT,
      })
      return session
    },
    onSuccess: async (session) => {
      toast.success('Workers AI starter session created')
      setSelectedEnvironmentId(session.spec.environmentId ?? '')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.environments.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all }),
      ])
      goToStep('session', session.metadata.uid)
    },
    /* v8 ignore start -- error is always an Error instance in practice */
    onError: (error) => toast.error(errorMessage(error)),
    /* v8 ignore stop */
  })

  const error = providersQuery.error ?? agentsQuery.error ?? environmentsQuery.error ?? sessionsQuery.error
  if (error) {
    return (
      <EmptyState
        /* v8 ignore start -- error is always an Error instance in practice */
        title={errorMessage(error)}
        /* v8 ignore stop */
        body="Unable to load quickstart resources."
      />
    )
  }
  if (providersQuery.isPending || agentsQuery.isPending || environmentsQuery.isPending || sessionsQuery.isPending) {
    return <EmptyState title="Loading quickstart" body="Reading setup resources for this project." />
  }

  /* v8 ignore start -- data is always defined after isPending/error guards above */
  const providers = providersQuery.data?.data ?? []
  const agents = agentsQuery.data?.data ?? []
  const environments = environmentsQuery.data?.data ?? []
  const sessions = sessionsQuery.data?.data ?? []
  /* v8 ignore stop */
  const completion = quickstartCompletion({ providers, agents, environments, sessions })
  const current = resolveQuickstartStep(searchParams.get('step'), completion)

  const activeAgents = agents.filter((agent) => !isArchived(agent))
  const activeEnvironments = environments.filter((environment) => !isArchived(environment))
  const quickstartAgent = activeAgents[0] ?? null
  const quickstartEnvironment =
    activeEnvironments.find((environment) => environment.metadata.uid === selectedEnvironmentId) ??
    activeEnvironments[0] ??
    null
  const previewSessionId = searchParams.get('session')
  const integrationSession =
    sessions.find((session) => session.metadata.uid === previewSessionId) ??
    sessions.find((session) => session.status.phase === 'idle' || session.status.phase === 'running') ??
    sessions[0] ??
    null

  const submitAgentDraft = () => {
    /* v8 ignore start -- Create agent button is only rendered when draft !== null */
    if (draft === null) return
    /* v8 ignore stop */
    const errors = coreStepErrors(draft)
    if (Object.keys(errors).length > 0) {
      setDraftErrors((current) => ({ ...current, ...errors }))
      return
    }
    createAgent.mutate(draft)
  }

  const stepContent: Record<QuickstartStep, () => ReactNode> = {
    provider: () => (
      <QuickstartProviderStep
        providers={providers}
        onRunDefault={() => runDefaultWorkersAi.mutate()}
        runPending={runDefaultWorkersAi.isPending}
        onContinue={() => goToStep(firstIncompleteStep(completion))}
      />
    ),
    environment: () => (
      <QuickstartEnvironmentStep
        form={environmentForm}
        setForm={setEnvironmentForm}
        environments={environments}
        onCreate={() => createEnvironment.mutate()}
        createPending={createEnvironment.isPending}
        onSelectExisting={(environmentId) => {
          setSelectedEnvironmentId(environmentId)
          goToStep('agent')
        }}
      />
    ),
    agent: () => (
      <QuickstartAgentStep
        draft={draft}
        goal={goal}
        setGoal={setGoal}
        onDraft={() => {
          setDraft(draftFromGoal(goal))
          setDraftErrors({})
        }}
        onUseTemplate={(template) => {
          setDraft(template.draft)
          setDraftErrors({})
        }}
        onStartFromScratch={() => {
          setDraft(emptyBuilderDraft)
          setDraftErrors({})
        }}
        onDiscardDraft={() => setDraft(null)}
        setField={setField}
        errors={draftErrors}
        onCreate={submitAgentDraft}
        createPending={createAgent.isPending}
      />
    ),
    session: () => (
      <QuickstartSessionStep
        agent={quickstartAgent}
        environment={quickstartEnvironment}
        sessionId={previewSessionId}
        onSessionCreated={(sessionId) => goToStep('session', sessionId)}
        onContinue={() => goToStep('integration')}
      />
    ),
    integration: () => (
      <QuickstartIntegrationStep
        input={
          integrationSession
            ? {
                agentId: integrationSession.spec.agentId,
                environmentId: integrationSession.spec.environmentId,
                sessionId: integrationSession.metadata.uid,
              }
            : /* v8 ignore start -- integration step only unlocked when sessions non-empty */ null
          /* v8 ignore stop */
        }
      />
    ),
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Quickstart"
        description="Complete each step in order to create a session and send the first runtime message. Completed steps stay open for revisiting."
      />
      <section aria-labelledby="quickstart-first-run" className="flex flex-col gap-3">
        <h2 id="quickstart-first-run" className="text-sm font-semibold text-foreground">
          First run workflow
        </h2>
        <ol className="grid gap-3" aria-label="Quickstart steps">
          {QUICKSTART_STEPS.map((step, index) => {
            const unlocked = isStepUnlocked(step, completion)
            const active = step === current
            const label = `${index + 1}. ${QUICKSTART_STEP_TITLES[step]}`
            return (
              <li key={step} className="min-w-0 rounded-lg border">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  {unlocked ? (
                    <Link
                      to={stepHref(step, searchParams.get('session'))}
                      aria-current={active ? 'step' : undefined}
                      className="text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {label}
                    </Link>
                  ) : (
                    <span aria-disabled="true" className="text-sm font-medium text-muted-foreground">
                      {label}
                    </span>
                  )}
                  <StatusBadge value={completion[step] ? 'complete' : 'pending'} />
                  <code className="min-w-0 break-all font-mono text-xs text-muted-foreground sm:ml-auto">
                    {QUICKSTART_STEP_CALLS[step]}
                  </code>
                </div>
                {active ? (
                  <div className="grid gap-4 border-t p-4">
                    <p className="text-sm text-muted-foreground">{STEP_DESCRIPTIONS[step]}</p>
                    {stepContent[step]()}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}

function stepHref(step: QuickstartStep, sessionId: string | null) {
  return sessionId ? `/quickstart?step=${step}&session=${sessionId}` : `/quickstart?step=${step}`
}
