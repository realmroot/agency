import { useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/console/components'
import { archivedLabel } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { matchesSearch, useUrlFilter } from '@/console/use-list-filters'
import { CreateSessionSheet } from '@/features/sessions/CreateSessionSheet'
import { api } from '@/lib/amarpc'
import { queryKeys } from '@/lib/query-keys'
import { AgentsView } from './AgentsView'
import { CreateAgentSheet } from './CreateAgentSheet'
import { useAgentActions } from './use-agent-actions'

export function AgentsPage() {
  const [creatingAgent, setCreatingAgent] = useState(false)
  const [sessionAgentId, setSessionAgentId] = useState<string | undefined>()
  const actions = useAgentActions()
  const [search, setSearch] = useUrlFilter('search')
  const [status, setStatus] = useUrlFilter('status', 'all')
  const [provider, setProvider] = useUrlFilter('provider', 'all')
  const archived = status === 'archived'
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(archived),
    queryFn: () => api.listAgents({ archived }),
  })
  const allAgents = useMemo(() => agentsQuery.data?.data ?? [], [agentsQuery.data?.data])
  const providers = useMemo(
    () => [...new Set(allAgents.map((agent) => agent.spec.provider).filter((id): id is string => Boolean(id)))].sort(),
    [allAgents],
  )
  const agents = useMemo(
    () =>
      allAgents.filter(
        (agent) =>
          matchesSearch(search, agent.metadata.name, agent.metadata.description) &&
          (status === 'all' || archivedLabel(agent) === status) &&
          (provider === 'all' || agent.spec.provider === provider),
      ),
    [allAgents, search, status, provider],
  )
  const pagination = useClientPagination(agents)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Agents"
        description="Create and operate reusable agent profiles. Create sessions from active agents."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => setCreatingAgent(true)}>
              <Bot data-icon="inline-start" />
              Create agent
            </Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search agents"
          aria-label="Search agents"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full sm:w-64"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">active</SelectItem>
              <SelectItem value="archived">archived</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All providers</SelectItem>
              {providers.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <AgentsView
        agents={pagination.items}
        pagination={pagination}
        onCreateSession={setSessionAgentId}
        onArchive={actions.archiveAgent}
      />
      <CreateAgentSheet open={creatingAgent} onOpenChange={setCreatingAgent} />
      <CreateSessionSheet
        open={sessionAgentId !== undefined}
        agentId={sessionAgentId}
        onOpenChange={
          /* v8 ignore start */ (open) => {
            if (!open) setSessionAgentId(undefined)
          } /* v8 ignore stop */
        }
      />
    </div>
  )
}
