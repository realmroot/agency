import { Archive, ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ConfirmAction,
  EmptyState,
  ResourceIdentityCell,
  StatusBadge,
  TablePagination,
  TableSurface,
  TruncatedTooltipText,
} from '@/console/components'
import { formatDate, formatDuration, isArchived } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import { AgentIdentityCell } from '@/features/console/agent-identity-cell'
import type { Session } from '@/lib/amarpc'

export function SessionsView({
  sessions,
  pagination,
  agentNameById,
  selectedIds,
  setSelectedIds,
  onArchive,
}: {
  sessions: Session[]
  pagination: ClientPagination<Session>
  agentNameById?: Map<string, string>
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
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <colgroup>
        <col className="w-[2.75rem]" />
        <col className="w-[8rem] md:w-[13rem]" />
        <col className="w-[5.5rem]" />
        <col />
        <col className="hidden lg:table-column lg:w-[12rem]" />
        <col className="hidden 2xl:table-column 2xl:w-[10rem]" />
        <col className="hidden lg:table-column lg:w-[10rem]" />
        <col className="hidden 2xl:table-column 2xl:w-[8rem]" />
        <col className="w-[5.5rem]" />
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
          <TableHead className="hidden lg:table-cell">Hosting / runtime</TableHead>
          <TableHead className="hidden 2xl:table-cell">Started</TableHead>
          <TableHead className="hidden lg:table-cell">Updated</TableHead>
          <TableHead className="hidden 2xl:table-cell">Duration</TableHead>
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
              <ResourceIdentityCell
                name={session.metadata.name}
                id={session.metadata.uid}
                to={`/sessions/${session.metadata.uid}`}
              />
            </TableCell>
            <TableCell className="min-w-0">
              <StatusBadge
                value={session.status.phase}
                detail={session.status.phase === 'error' ? session.status.reason : null}
              />
            </TableCell>
            <TableCell className="min-w-0">
              <AgentIdentityCell
                agentId={session.spec.agentId}
                agentName={agentNameById?.get(session.spec.agentId)}
                provider={session.status.bindings.agent.snapshot.provider}
                model={session.status.bindings.agent.snapshot.model}
              />
            </TableCell>
            <TableCell className="hidden min-w-0 lg:table-cell">
              <TruncatedTooltipText
                value={`${hostingRuntimeLabel(session)} · ${session.spec.environmentId ?? 'None'}`}
              />
            </TableCell>
            <TableCell className="hidden min-w-0 2xl:table-cell">
              <span className="block truncate">{formatDate(session.status.startedAt)}</span>
            </TableCell>
            <TableCell className="hidden min-w-0 lg:table-cell">
              <span className="block truncate">{formatDate(session.metadata.updatedAt)}</span>
            </TableCell>
            <TableCell className="hidden min-w-0 2xl:table-cell">
              <span className="block truncate">
                {formatDuration(session.status.startedAt, session.status.closedAt)}
              </span>
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="icon" aria-label="Open session" asChild>
                  <Link to={`/sessions/${session.metadata.uid}`}>
                    <ExternalLink data-icon="inline-start" />
                  </Link>
                </Button>
                {!isArchived(session) ? (
                  <ConfirmAction
                    title="Archive session?"
                    description="Archive the selected session from active operations while preserving persisted events."
                    confirmLabel="Archive session"
                    destructive
                    onConfirm={() => onArchive(session.metadata.uid)}
                  >
                    <Button type="button" variant="outline" size="icon" aria-label="Archive">
                      <Archive data-icon="inline-start" />
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
