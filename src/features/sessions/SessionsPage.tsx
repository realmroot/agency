import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, MessageSquare } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmAction, EmptyState, PageHeader } from '@/console/components'
import { isArchived } from '@/console/format'
import { useClientPagination } from '@/console/use-client-pagination'
import { matchesSearch, useUrlFilter } from '@/console/use-list-filters'
import { api } from '@/lib/amarpc'
import { errorMessage } from '@/lib/errors'
import { queryKeys } from '@/lib/query-keys'
import { CreateSessionSheet } from './CreateSessionSheet'
import { SessionsView } from './SessionsView'
import { useSessionActions } from './use-session-actions'

// Batch destructive operations process sequentially and stop at the first
// failure: the outcome names what succeeded and what failed, and the failed
// plus unprocessed items stay selected so a retry needs no guessing.
export interface BatchArchiveOutcome {
  archived: string[]
  failed: { id: string; name: string; message: string } | null
  unprocessed: string[]
}

export function SessionsPage() {
  const actions = useSessionActions()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useUrlFilter('search')
  const [status, setStatus] = useUrlFilter('status', 'all')
  const [sort, setSort] = useUrlFilter('sort', 'updated-desc')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchOutcome, setBatchOutcome] = useState<BatchArchiveOutcome | null>(null)
  const archived = status === 'archived'
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(archived),
    queryFn: () => api.listSessions({ archived }),
    /* v8 ignore start -- refetchInterval is a React Query internal callback, unreachable in unit tests */
    refetchInterval: (query) =>
      query.state.data?.data.some((session) => session.status.phase === 'pending') ? 2000 : false,
    /* v8 ignore stop */
  })
  const sessions = useMemo(() => {
    const filtered = (sessionsQuery.data?.data ?? []).filter(
      (session) =>
        (status === 'all' || (status === 'archived' ? isArchived(session) : session.status.phase === status)) &&
        matchesSearch(search, session.metadata.name, session.spec.agentId),
    )
    return [...filtered].sort((a, b) => {
      const startedA = Date.parse(a.status.startedAt ?? a.metadata.createdAt)
      const startedB = Date.parse(b.status.startedAt ?? b.metadata.createdAt)
      const updatedA = Date.parse(a.metadata.updatedAt)
      const updatedB = Date.parse(b.metadata.updatedAt)
      if (sort === 'started-asc') return startedA - startedB
      if (sort === 'started-desc') return startedB - startedA
      if (sort === 'updated-asc') return updatedA - updatedB
      return updatedB - updatedA
    })
  }, [sessionsQuery.data?.data, sort, status, search])
  const pagination = useClientPagination(sessions)
  const archiveSelected = async () => {
    const queue = [...selectedIds]
    const archived: string[] = []
    setBatchOutcome(null)
    for (const [index, id] of queue.entries()) {
      try {
        await api.archiveSession(id)
        archived.push(id)
      } catch (error) {
        const failedSession = sessions.find((session) => session.metadata.uid === id)
        const failed = {
          id,
          name: failedSession?.metadata.name ?? id,
          message: errorMessage(error),
        }
        const unprocessed = queue.slice(index + 1)
        setBatchOutcome({ archived, failed, unprocessed })
        // The failed and unprocessed items stay selected for a precise retry.
        setSelectedIds([id, ...unprocessed])
        toast.error(`Batch archive halted: ${failed.name} failed`)
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
        return
      }
    }
    setBatchOutcome({ archived, failed: null, unprocessed: [] })
    setSelectedIds([])
    toast.success(`Archived ${archived.length} session${archived.length === 1 ? '' : 's'}`)
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all })
  }
  if (sessionsQuery.error) {
    return (
      <EmptyState
        title="Sessions unavailable"
        body={sessionsQuery.error instanceof Error ? sessionsQuery.error.message : String(sessionsQuery.error)}
      />
    )
  }
  if (sessionsQuery.isPending) {
    return <EmptyState title="Loading sessions" body="Reading runtime sessions for this project." />
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Sessions"
        description="Inspect runtime sessions and open a session to send messages, review events, or close active work."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <MessageSquare data-icon="inline-start" />
            Create session
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search sessions"
          aria-label="Search sessions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full sm:w-64"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All statuses</SelectItem>
              {['pending', 'running', 'idle', 'closed', 'error', 'archived'].map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="updated-desc">Recently updated</SelectItem>
              <SelectItem value="updated-asc">Oldest updated</SelectItem>
              <SelectItem value="started-desc">Recently started</SelectItem>
              <SelectItem value="started-asc">Oldest started</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <ConfirmAction
          title="Archive selected sessions?"
          description="Archive selected sessions from active operations while preserving persisted events."
          confirmLabel="Archive sessions"
          destructive
          onConfirm={archiveSelected}
        >
          <Button type="button" variant="outline" disabled={selectedIds.length === 0}>
            <Archive data-icon="inline-start" />
            Archive selected
          </Button>
        </ConfirmAction>
      </div>
      {batchOutcome ? (
        <output
          className={`rounded-md border px-3 py-2 text-sm ${batchOutcome.failed ? 'border-destructive/50 text-destructive' : 'border-border text-muted-foreground'}`}
          data-testid="batch-archive-outcome"
        >
          {batchOutcome.archived.length > 0
            ? `Archived ${batchOutcome.archived.length} session${batchOutcome.archived.length === 1 ? '' : 's'}. `
            : ''}
          {batchOutcome.failed
            ? `Failed on "${batchOutcome.failed.name}": ${batchOutcome.failed.message}. ${batchOutcome.unprocessed.length} not processed — failed and remaining sessions stay selected for retry.`
            : 'All selected sessions archived.'}
        </output>
      ) : null}
      <SessionsView
        sessions={pagination.items}
        pagination={pagination}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        onArchive={actions.archiveSession}
      />
      <CreateSessionSheet open={creating} onOpenChange={setCreating} />
    </div>
  )
}
