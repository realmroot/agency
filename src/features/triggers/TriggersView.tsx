import { Pause, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ConfirmAction,
  DescriptionCell,
  EmptyState,
  ResourceIdentityCell,
  StatusBadge,
  TablePagination,
  TableSurface,
  TruncatedTooltipText,
} from '@/console/components'
import { formatRelativeTime } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Trigger } from '@/lib/amarpc'

export function formatInterval(intervalSeconds: number) {
  if (intervalSeconds % 86400 === 0) {
    return `every ${intervalSeconds / 86400}d`
  }
  if (intervalSeconds % 3600 === 0) {
    return `every ${intervalSeconds / 3600}h`
  }
  if (intervalSeconds % 60 === 0) {
    return `every ${intervalSeconds / 60}m`
  }
  return `every ${intervalSeconds}s`
}

function triggerTiming(trigger: Trigger) {
  if (trigger.spec.source.type === 'http') {
    return 'HTTP POST'
  }
  return formatInterval(trigger.spec.source.schedule.intervalSeconds)
}

export function TriggersView({
  triggers,
  pagination,
  onPause,
  onResume,
  onDelete,
}: {
  triggers: Trigger[]
  pagination: ClientPagination<Trigger>
  onPause: (id: string) => void
  onResume: (id: string) => void
  onDelete: (id: string) => void
}) {
  if (triggers.length === 0) {
    return <EmptyState title="No triggers" body="Schedule a trigger to dispatch an agent on a recurring interval." />
  }
  return (
    <TableSurface
      tableId="triggers"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <colgroup>
        <col className="w-[9rem] md:w-[14rem]" />
        <col />
        <col className="hidden lg:table-column lg:w-[12rem]" />
        <col className="hidden md:table-column md:w-[8rem]" />
        <col className="w-[6rem]" />
        <col className="hidden 2xl:table-column 2xl:w-[9rem]" />
        <col className="hidden lg:table-column lg:w-[9rem]" />
        <col className="w-[5.5rem]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Trigger</TableHead>
          <TableHead>Description</TableHead>
          <TableHead className="hidden lg:table-cell">Agent</TableHead>
          <TableHead className="hidden md:table-cell">Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden 2xl:table-cell">Next due</TableHead>
          <TableHead className="hidden lg:table-cell">Last run</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {triggers.map((trigger) => (
          <TableRow key={trigger.metadata.uid}>
            <TableCell className="min-w-0">
              <ResourceIdentityCell
                name={trigger.metadata.name}
                id={trigger.metadata.uid}
                to={`/triggers/${trigger.metadata.uid}`}
              />
            </TableCell>
            <TableCell className="min-w-0">
              <DescriptionCell value={trigger.metadata.description} />
            </TableCell>
            <TableCell className="hidden min-w-0 lg:table-cell">
              <TruncatedTooltipText value={trigger.spec.template.spec.agentId} />
            </TableCell>
            <TableCell className="hidden md:table-cell">{triggerTiming(trigger)}</TableCell>
            <TableCell>
              <StatusBadge value={trigger.spec.suspend ? 'paused' : 'active'} />
            </TableCell>
            <TableCell className="hidden 2xl:table-cell">
              {trigger.status.nextDueAt ? formatRelativeTime(trigger.status.nextDueAt) : '—'}
            </TableCell>
            <TableCell className="hidden lg:table-cell">
              {trigger.status.lastDispatchedAt ? formatRelativeTime(trigger.status.lastDispatchedAt) : '—'}
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                {!trigger.spec.suspend ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Pause trigger"
                    onClick={() => onPause(trigger.metadata.uid)}
                  >
                    <Pause data-icon="inline-start" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Resume trigger"
                    onClick={() => onResume(trigger.metadata.uid)}
                  >
                    <Play data-icon="inline-start" />
                  </Button>
                )}
                <ConfirmAction
                  title="Delete trigger?"
                  description={`Permanently delete ${trigger.metadata.name} and its run history. This cannot be undone.`}
                  confirmLabel="Delete trigger"
                  destructive
                  onConfirm={() => onDelete(trigger.metadata.uid)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Delete trigger">
                    <Trash2 data-icon="inline-start" />
                  </Button>
                </ConfirmAction>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableSurface>
  )
}
