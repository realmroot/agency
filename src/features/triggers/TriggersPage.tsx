import { useQuery } from '@tanstack/react-query'
import { AlarmClock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/console/components'
import { useClientPagination } from '@/console/use-client-pagination'
import { matchesSearch, useUrlFilter } from '@/console/use-list-filters'
import { api } from '@/lib/amarpc'
import { queryKeys } from '@/lib/query-keys'
import { CreateTriggerSheet } from './CreateTriggerSheet'
import { TriggersView } from './TriggersView'
import { useTriggerActions } from './use-trigger-actions'

function triggerStatus(suspend: boolean) {
  return suspend ? 'paused' : 'active'
}

export function TriggersPage() {
  const [creating, setCreating] = useState(false)
  const actions = useTriggerActions()
  const [search, setSearch] = useUrlFilter('search')
  const [status, setStatus] = useUrlFilter('status', 'all')
  const triggersQuery = useQuery({
    queryKey: queryKeys.triggers.list(),
    queryFn: () => api.listTriggers(),
  })
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(),
    queryFn: () => api.listAgents(),
  })
  const allTriggers = useMemo(() => triggersQuery.data?.data ?? [], [triggersQuery.data?.data])
  const agentById = useMemo(
    () => new Map((agentsQuery.data?.data ?? []).map((agent) => [agent.metadata.uid, agent])),
    [agentsQuery.data?.data],
  )
  const triggers = useMemo(
    () =>
      allTriggers.filter((trigger) => {
        const agent = agentById.get(trigger.spec.template.spec.agentId)
        return (
          matchesSearch(search, trigger.metadata.name, trigger.spec.template.spec.agentId, agent?.metadata.name) &&
          (status === 'all' || triggerStatus(trigger.spec.suspend) === status)
        )
      }),
    [agentById, allTriggers, search, status],
  )
  const pagination = useClientPagination(triggers)
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Triggers"
        description="Scheduled triggers that dispatch an agent on a recurring interval."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <AlarmClock data-icon="inline-start" />
            Create trigger
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search triggers"
          aria-label="Search triggers"
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
              <SelectItem value="paused">paused</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <TriggersView
        triggers={pagination.items}
        pagination={pagination}
        onPause={actions.pauseTrigger}
        onResume={actions.resumeTrigger}
        onDelete={actions.deleteTrigger}
        agentById={agentById}
      />
      <CreateTriggerSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
