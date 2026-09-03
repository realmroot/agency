import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfirmAction, DetailSection, EmptyState, Meta, MetaGrid, StatusBadge } from '@/console/components'
import { formatDate } from '@/console/format'
import { RelatedResourcesTable } from '@/features/console/related-resources-table'
import type { Agent, AgentVersion, Session } from '@/lib/enborrpc'

export function AgentDetailView({
  agent,
  versions,
  sessions,
  onDelete,
}: {
  agent: Agent | null
  versions: AgentVersion[]
  sessions: Session[]
  onDelete?: (id: string) => void
}) {
  if (!agent) return <EmptyState title="Agent not found" body="The requested agent is not in the current project." />
  return (
    <AgentDetailContent
      agent={agent}
      versions={versions}
      sessions={sessions}
      {...(onDelete !== undefined ? { onDelete } : {})}
    />
  )
}

function AgentDetailContent({
  agent,
  versions,
  sessions,
  onDelete,
}: {
  agent: Agent
  versions: AgentVersion[]
  sessions: Session[]
  onDelete?: (id: string) => void
}) {
  const [selectedVersionId, setSelectedVersionId] = useState('')

  useEffect(() => {
    setSelectedVersionId((current) => current || versions[0]?.metadata.uid || '')
  }, [versions])

  const agentSessions = sessions.filter((session) => session.spec.agentId === agent.metadata.uid)
  const currentVersion = useMemo(
    () => versions.find((version) => version.metadata.uid === selectedVersionId) ?? versions[0] ?? null,
    [selectedVersionId, versions],
  )
  const currentSpec = currentVersion?.spec ?? agent.spec
  const currentVersionNumber = currentVersion?.status.version ?? agent.status.version
  const currentCreatedAt = currentVersion?.metadata.createdAt ?? agent.metadata.updatedAt
  return (
    <div>
      <Tabs defaultValue="agent">
        <TabsList>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>
        <TabsContent value="agent" className="mt-4">
          <DetailSection
            title="Agent configuration"
            description="Provider, model, instructions, and tool policy captured by the selected immutable version."
            actions={
              <>
                <StatusBadge value={agent.status.phase} />
                {versions.length > 0 ? (
                  <Select value={currentVersion?.metadata.uid ?? ''} onValueChange={setSelectedVersionId}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {versions.map((version) => (
                          <SelectItem key={version.metadata.uid} value={version.metadata.uid}>
                            v{version.status.version}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : null}
                {onDelete ? (
                  <ConfirmAction
                    title="Delete agent?"
                    description={`Delete ${agent.metadata.name}. It cannot be restored; existing session history is retained.`}
                    confirmLabel="Delete agent"
                    destructive
                    onConfirm={() => onDelete(agent.metadata.uid)}
                  >
                    <Button type="button" variant="outline">
                      <Trash2 data-icon="inline-start" />
                      Delete
                    </Button>
                  </ConfirmAction>
                ) : null}
              </>
            }
          >
            <div className="flex flex-col gap-4">
              <MetaGrid columns={4}>
                <Meta label="Version" value={`v${currentVersionNumber}`} />
                <Meta label="Created" value={formatDate(currentCreatedAt)} />
                <Meta label="Provider" value={currentSpec.provider ?? 'None'} />
                <Meta label="Model" value={currentSpec.model ?? 'None'} />
                <Meta label="Identity" value={currentSpec.identity?.username ?? 'None'} />
                <Meta label="Session runtime" value={currentSpec.identity?.runtime ?? 'Selected per session'} />
              </MetaGrid>
              <ReadOnlyTextField label="System prompt" value={currentSpec.systemPrompt || 'None'} />
              <MetaGrid>
                <Meta label="Skills" value={currentSpec.skills.join(', ') || 'None'} />
                <Meta label="Allowed tools" value={currentSpec.allowedTools.join(', ') || 'None'} />
                <Meta label="MCP connectors" value={currentSpec.mcpConnectors.join(', ') || 'None'} />
              </MetaGrid>
            </div>
          </DetailSection>
        </TabsContent>
        <TabsContent value="sessions" className="mt-4">
          <RelatedResourcesTable title="Sessions" empty="No sessions have used this agent yet." items={agentSessions} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ReadOnlyTextField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{value}</p>
    </div>
  )
}
