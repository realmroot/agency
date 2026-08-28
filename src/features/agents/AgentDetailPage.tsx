import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PageHeader, StatusBadge } from '@/console/components'
import { archivedLabel, formatDate, isArchived, parseTools, providerPatch } from '@/console/format'
import { AgentForm } from '@/console/forms'
import type { AgentFormState } from '@/console/types'
import { CreateSessionSheet } from '@/features/sessions/CreateSessionSheet'
import { type Agent, api } from '@/lib/amarpc'
import { queryKeys } from '@/lib/query-keys'
import { AgentDetailView } from './AgentDetailView'
import { useAgentActions } from './use-agent-actions'

export function AgentDetailPage() {
  const { agentId } = useParams()
  const queryClient = useQueryClient()
  const agentActions = useAgentActions()
  const [editing, setEditing] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [form, setForm] = useState<AgentFormState | null>(null)
  const agentQuery = useQuery({
    queryKey: queryKeys.agents.detail(agentId ?? ''),
    queryFn: () => api.readAgent(agentId as string),
    enabled: Boolean(agentId),
  })
  const versionsQuery = useQuery({
    queryKey: queryKeys.agents.versions(agentId ?? ''),
    queryFn: () => api.listAgentVersions(agentId as string),
    enabled: Boolean(agentId),
  })
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(false),
    queryFn: () => api.listSessions(),
  })
  const agent = agentQuery.data ?? null
  const updateAgent = useMutation({
    mutationFn: (input: AgentFormState) =>
      api.updateAgent(agentId as string, {
        metadata: {
          name: input.name,
          ...(input.description ? { description: input.description } : { description: null }),
        },
        spec: {
          systemPrompt: input.systemPrompt,
          ...providerPatch(input.provider),
          model: input.model || null,
          skills: parseTools(input.skills),
          allowedTools: parseTools(input.allowedTools),
          mcpConnectors: parseTools(input.mcpConnectors),
          subagents: agent?.spec.subagents ?? [],
        },
      }),
    onSuccess: () => {
      setEditing(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId ?? '') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents.versions(agentId ?? '') })
    },
  })
  const openEdit = () => {
    if (!agent) return
    setForm(agentToForm(agent))
    setEditing(true)
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Agent"
        title={agent?.metadata.name ?? 'Agent detail'}
        titleAccessory={agent ? <StatusBadge value={archivedLabel(agent)} /> : null}
        description={
          agent
            ? `${agent.metadata.description ?? 'No description'} · Created ${formatDate(agent.metadata.createdAt)} · Updated ${formatDate(agent.metadata.updatedAt)}`
            : 'Inspect agent model configuration, version snapshot, and related sessions.'
        }
        actions={
          agent ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={openEdit}>
                <Pencil data-icon="inline-start" />
                Edit agent
              </Button>
              {!isArchived(agent) ? (
                <Button type="button" onClick={() => setCreatingSession(true)}>
                  Create session
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      <AgentDetailView
        agent={agent}
        versions={versionsQuery.data?.data ?? []}
        sessions={sessionsQuery.data?.data ?? []}
        onArchive={agentActions.archiveAgent}
      />
      <CreateSessionSheet
        open={creatingSession}
        agentId={agent?.metadata.uid}
        onOpenChange={(open) => setCreatingSession(open)}
      />
      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Agent</SheetTitle>
            <SheetDescription>
              Saving provider, model, or policy fields creates a new immutable agent version.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            {form ? (
              <AgentForm
                value={form}
                setValue={setForm}
                submitLabel={updateAgent.isPending ? 'Saving agent' : 'Save changes'}
                onSubmit={(event) => {
                  event.preventDefault()
                  updateAgent.mutate(form)
                }}
              />
            ) : null}
            {updateAgent.error instanceof Error ? (
              <p className="mt-3 text-sm text-destructive">{updateAgent.error.message}</p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function agentToForm(agent: Agent): AgentFormState {
  return {
    name: agent.metadata.name,
    description: agent.metadata.description ?? '',
    systemPrompt: agent.spec.systemPrompt,
    provider: agent.spec.provider ?? '',
    model: agent.spec.model ?? '',
    skills: agent.spec.skills.join('\n'),
    allowedTools: agent.spec.allowedTools.join('\n'),
    mcpConnectors: agent.spec.mcpConnectors.join('\n'),
  }
}
