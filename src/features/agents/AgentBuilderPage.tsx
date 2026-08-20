import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Play, Rocket } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { DetailSection, PageHeader, StatusBadge } from '@/console/components'
import { archivedLabel } from '@/console/format'
import { JsonBlock } from '@/features/console/json-block'
import { useSessionRuntimeSession } from '@/features/sessions/use-session-runtime'
import { type Agent, api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { BuilderStepper, CoreStep, SandboxStep, StartStep, TestEnvironmentField, ToolsStep } from './AgentBuilderSteps'
import {
  type AgentBuilderDraft,
  agentApiExamples,
  apiErrorToBuilder,
  BUILDER_STEP_TITLES,
  BUILDER_STEPS,
  type BuilderFieldErrors,
  type BuilderStep,
  builderClientErrors,
  draftFromGoal,
  emptyBuilderDraft,
  stepErrors,
  toAgentInput,
} from './agent-builder-model'

const EMPTY_LIST: never[] = []
const STEP_DESCRIPTIONS: Record<BuilderStep, string> = {
  start: 'Describe the agent goal or pick a template. The builder drafts a configuration you can edit.',
  core: 'Name the agent and set the system prompt, provider, and model it runs with.',
  tools: 'Decide which runtime tools and MCP connectors the agent may use.',
  sandbox: 'Decide whether sessions may execute inside Cloudflare Sandbox and which skills they carry.',
  test: 'Run the draft in an isolated session, then publish the versioned agent definition.',
  done: 'Call the same control-plane API from your own automation.',
}

export function AgentBuilderPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const requestedStep = searchParams.get('step')
  const step: BuilderStep = BUILDER_STEPS.includes(requestedStep as BuilderStep)
    ? (requestedStep as BuilderStep)
    : 'start'
  const [draft, setDraft] = useState<AgentBuilderDraft>(emptyBuilderDraft)
  const [fieldErrors, setFieldErrors] = useState<BuilderFieldErrors>({})
  const [goal, setGoal] = useState('')
  const [draftAgent, setDraftAgent] = useState<Agent | null>(null)
  const [publishedAgent, setPublishedAgent] = useState<Agent | null>(null)
  const [environmentId, setEnvironmentId] = useState('')
  const [testPrompt, setTestPrompt] = useState('Summarize your purpose and confirm you are ready to work.')
  const [testSessionId, setTestSessionId] = useState<string | null>(null)

  const connectorsQuery = useQuery({
    queryKey: queryKeys.connectors.list(),
    queryFn: () => api.listConnectors(),
  })
  const environmentsQuery = useQuery({
    queryKey: queryKeys.environments.list(false),
    queryFn: () => api.listEnvironments(),
  })
  const testSessionQuery = useQuery({
    queryKey: queryKeys.sessions.detail(testSessionId ?? ''),
    queryFn: () => api.readSession(testSessionId as string),
    enabled: Boolean(testSessionId),
    refetchInterval: (query) =>
      query.state.data && ['pending', 'running'].includes(query.state.data.status.phase) ? 750 : false,
  })
  const refreshTestSession = useCallback(() => {
    if (!testSessionId) return
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(testSessionId) })
  }, [queryClient, testSessionId])
  const testRuntime = useSessionRuntimeSession({
    session: testSessionQuery.data ?? null,
    onEventsChanged: refreshTestSession,
  })
  const transcript = testRuntime.state.messages

  const goToStep = (next: BuilderStep) => setSearchParams({ step: next })
  const setField = <K extends keyof AgentBuilderDraft>(field: K, value: AgentBuilderDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => {
      if (!(field in current)) return current
      const { [field]: _removed, ...rest } = current
      return rest
    })
  }
  const applyDraft = (next: AgentBuilderDraft) => {
    setDraft(next)
    setFieldErrors({})
    goToStep('core')
  }
  const applyApiError = (error: unknown) => {
    const mapped = apiErrorToBuilder(error)
    if (Object.keys(mapped.errors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...mapped.errors }))
      if (mapped.step) goToStep(mapped.step)
      return
    }
    toast.error(errorMessage(error))
  }

  const startTest = useMutation({
    mutationFn: async () => {
      const input = toAgentInput(draft)
      const agent = draftAgent ? await api.updateAgent(draftAgent.metadata.uid, input) : await api.createAgent(input)
      const session = await api.createSession({
        metadata: { name: `${agent.metadata.name} draft test` },
        spec: {
          agentId: agent.metadata.uid,
          environmentId,
          runtime: 'ama',
        },
        prompt: testPrompt.trim(),
      })
      return { agent, session }
    },
    onSuccess: ({ agent, session }) => {
      setDraftAgent(agent)
      setTestSessionId(session.metadata.uid)
      toast.success('Draft test session started')
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: applyApiError,
  })
  const publish = useMutation({
    mutationFn: () => {
      if (draftAgent) {
        return api.updateAgent(draftAgent.metadata.uid, toAgentInput(draft))
      }
      return api.createAgent(toAgentInput(draft))
    },
    onSuccess: (agent) => {
      setPublishedAgent(agent)
      toast.success('Agent published')
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
      goToStep('done')
    },
    onError: applyApiError,
  })

  const validateAndGo = (next: BuilderStep) => {
    const errors = stepErrors(step, draft)
    if (Object.keys(errors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...errors }))
      return
    }
    goToStep(next)
  }
  const submitPublish = () => {
    const errors = builderClientErrors(draft)
    if (Object.keys(errors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...errors }))
      const failingStep = BUILDER_STEPS.find((candidate) => Object.keys(stepErrors(candidate, draft)).length > 0)
      if (failingStep) goToStep(failingStep)
      return
    }
    publish.mutate()
  }
  const submitTest = () => {
    const errors = builderClientErrors(draft)
    if (Object.keys(errors).length > 0) {
      setFieldErrors((current) => ({ ...current, ...errors }))
      return
    }
    startTest.mutate()
  }

  const stepIndex = BUILDER_STEPS.indexOf(step)
  const previousStep = stepIndex > 0 ? BUILDER_STEPS[stepIndex - 1] : undefined
  const nextStep = step !== 'test' && step !== 'done' ? BUILDER_STEPS[stepIndex + 1] : undefined
  const examples = publishedAgent ? agentApiExamples(publishedAgent) : null
  const testSession = testSessionQuery.data ?? null

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Agents"
        title="Agent builder"
        description="Configure, test, and publish a managed agent one decision at a time."
        actions={
          <Button asChild variant="outline">
            <Link to="/agents">
              <ArrowLeft data-icon="inline-start" />
              Back to agents
            </Link>
          </Button>
        }
      />
      <BuilderStepper current={step} published={publishedAgent !== null} />
      <DetailSection title={BUILDER_STEP_TITLES[step]} description={STEP_DESCRIPTIONS[step]}>
        <div className="grid gap-4">
          {step === 'start' ? (
            <StartStep
              goal={goal}
              setGoal={setGoal}
              onDraftFromGoal={() => applyDraft(draftFromGoal(goal))}
              onUseTemplate={(template) => applyDraft(template.draft)}
              onSkip={() => goToStep('core')}
            />
          ) : null}
          {step === 'core' ? <CoreStep draft={draft} errors={fieldErrors} setField={setField} /> : null}
          {step === 'tools' ? (
            <ToolsStep
              draft={draft}
              errors={fieldErrors}
              setField={setField}
              connectors={connectorsQuery.data?.data ?? EMPTY_LIST}
            />
          ) : null}
          {step === 'sandbox' ? <SandboxStep draft={draft} errors={fieldErrors} setField={setField} /> : null}
          {step === 'test' ? (
            <div className="grid gap-4">
              <TestEnvironmentField
                environments={environmentsQuery.data?.data ?? EMPTY_LIST}
                environmentId={environmentId}
                setEnvironmentId={setEnvironmentId}
              />
              <Field>
                <FieldLabel htmlFor="builder-test-prompt">Test prompt</FieldLabel>
                <Textarea
                  id="builder-test-prompt"
                  value={testPrompt}
                  onChange={(event) => setTestPrompt(event.target.value)}
                />
                <FieldDescription>
                  The prompt runs in an isolated draft session. Publishing afterwards activates the agent version.
                </FieldDescription>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!environmentId || !testPrompt.trim() || startTest.isPending}
                  onClick={submitTest}
                >
                  <Play data-icon="inline-start" />
                  {startTest.isPending ? 'Starting test session' : 'Start test session'}
                </Button>
                <Button type="button" disabled={publish.isPending} onClick={submitPublish}>
                  <Rocket data-icon="inline-start" />
                  {publish.isPending ? 'Publishing agent' : 'Publish agent'}
                </Button>
              </div>
              {testSession ? (
                <div className="grid gap-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">Draft test transcript</span>
                    <StatusBadge value={testSession.status.phase} detail={testSession.status.reason} />
                    <Link
                      className="text-xs text-muted-foreground underline"
                      to={`/sessions/${testSession.metadata.uid}`}
                    >
                      Open session {testSession.metadata.uid}
                    </Link>
                  </div>
                  {/* v8 ignore start */}
                  {transcript.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Waiting for the draft session transcript.</p>
                  ) : (
                    <ul className="grid gap-2" aria-label="Draft test transcript">
                      {transcript.map((message) => (
                        <li key={message.id} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                          <p className="text-xs font-medium uppercase text-muted-foreground">{message.role}</p>
                          <p className="mt-0.5 whitespace-pre-wrap break-words">{message.content}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* v8 ignore stop */}
                </div>
              ) : null}
            </div>
          ) : null}
          {step === 'done' && publishedAgent && examples ? (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{publishedAgent.metadata.name}</span>
                <StatusBadge value={archivedLabel(publishedAgent)} />
                <StatusBadge value={`v${publishedAgent.status.version}`} />
                <span className="font-mono text-xs text-muted-foreground">{publishedAgent.metadata.uid}</span>
              </div>
              <Field>
                <FieldLabel>Realmroot CLI</FieldLabel>
                <JsonBlock value={examples.realmroot} />
                <FieldDescription>
                  Realmroot requests the exact scope and signs the call with the current Agent identity.
                </FieldDescription>
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link to={`/agents/${publishedAgent.metadata.uid}`}>Open agent</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/agents">Back to agents</Link>
                </Button>
              </div>
            </div>
          ) : null}
          {step === 'done' && !publishedAgent ? (
            <p className="text-sm text-muted-foreground">
              Publish an agent from the test step to see its API examples.
            </p>
          ) : null}
          {step !== 'start' && step !== 'done' ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
              {/* v8 ignore start */}
              {previousStep ? (
                <Button type="button" variant="ghost" onClick={() => goToStep(previousStep)}>
                  <ArrowLeft data-icon="inline-start" />
                  Back
                </Button>
              ) : (
                <span />
              )}
              {/* v8 ignore stop */}
              {nextStep ? (
                <Button type="button" onClick={() => validateAndGo(nextStep)}>
                  Next
                  <ArrowRight data-icon="inline-end" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </DetailSection>
    </div>
  )
}
