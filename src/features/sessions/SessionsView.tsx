import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmAction, EmptyState, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { formatDate, formatDuration, isArchived } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Session } from '@/lib/amarpc'

export function SessionsView({
  sessions,
  pagination,
  selectedIds,
  setSelectedIds,
  onArchive,
}: {
  sessions: Session[]
  pagination: ClientPagination<Session>
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  onArchive: (id: string) => void
}) {
  const selectableIds = sessions.filter((session) => !isArchived(session)).map((session) => session.metadata.uid)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id))
  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? selectableIds : [])
  }
  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds(checked ? [...selectedIds, id] : selectedIds.filter((selectedId) => selectedId !== id))
  }

  if (sessions.length === 0) {
    return <EmptyState title="No sessions" body="Create a session from an active agent and environment." />
  }
  return (
    <TableSurface
      tableId="sessions"
      tableClassName="min-w-[1120px] table-fixed"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <colgroup>
        <col className="w-10" />
        <col className="w-[260px]" />
        <col className="w-[120px]" />
        <col className="w-[220px]" />
        <col className="w-[170px]" />
        <col className="w-[145px]" />
        <col className="w-[145px]" />
        <col className="w-[110px]" />
        <col className="w-[110px]" />
        <col className="w-[140px]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Checkbox
              checked={allSelected}
              disabled={selectableIds.length === 0}
              aria-label="Select all sessions"
              onCheckedChange={(checked) => toggleAll(checked === true)}
            />
          </TableHead>
          <TableHead>Session</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Agent provider/model</TableHead>
          <TableHead>Hosting / runtime</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.metadata.uid}>
            <TableCell>
              <Checkbox
                checked={selectedIds.includes(session.metadata.uid)}
                disabled={isArchived(session)}
                aria-label={`Select ${session.metadata.name}`}
                onCheckedChange={(checked) => toggleOne(session.metadata.uid, checked === true)}
              />
            </TableCell>
            <TableCell className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link className="truncate font-medium hover:underline" to={`/sessions/${session.metadata.uid}`}>
                  {session.metadata.name}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {`${session.metadata.uid} · ${session.status.bindings.agent.snapshot.provider} / ${session.status.bindings.agent.snapshot.model ?? 'None'}`}
                </span>
              </div>
            </TableCell>
            <TableCell className="min-w-0">
              <StatusBadge
                value={session.status.phase}
                detail={session.status.phase === 'error' ? session.status.reason : null}
              />
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">{`${session.status.bindings.agent.snapshot.systemPrompt ?? session.spec.agentId} · ${session.spec.agentId}`}</span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">{`${session.status.bindings.agent.snapshot.provider} / ${session.status.bindings.agent.snapshot.model ?? 'None'}`}</span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">
                {`${hostingRuntimeLabel(session)} · ${session.spec.environmentId ?? 'None'}`}
              </span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">{formatDate(session.status.startedAt)}</span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">{formatDate(session.metadata.updatedAt)}</span>
            </TableCell>
            <TableCell className="min-w-0">
              <span className="block truncate">
                {formatDuration(session.status.startedAt, session.status.closedAt)}
              </span>
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" asChild>
                  <Link to={`/sessions/${session.metadata.uid}`}>Open</Link>
                </Button>
                {!isArchived(session) ? (
                  <ConfirmAction
                    title="Archive session?"
                    description="Archive the selected session from active operations while preserving persisted events."
                    confirmLabel="Archive session"
                    destructive
                    onConfirm={() => onArchive(session.metadata.uid)}
                  >
                    <Button type="button" variant="ghost" size="sm">
                      Archive
                    </Button>
                  </ConfirmAction>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableSurface>
  )
}

function hostingRuntimeLabel(session: Session) {
  const environmentSnapshot = session.status.bindings.environment.snapshot
  if (!environmentSnapshot) {
    return 'None'
  }
  const hostingMode = environmentSnapshot.type === 'self_hosted' ? 'Self-hosted' : 'Cloud'
  return `${hostingMode} / ${session.status.bindings.runtime}`
}
