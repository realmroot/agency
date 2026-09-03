import { Play, Trash2 } from 'lucide-react'
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
import { formatDate } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Agent } from '@/lib/enborrpc'

export function AgentsView({
  agents,
  pagination,
  onCreateSession,
  onDelete,
}: {
  agents: Agent[]
  pagination: ClientPagination<Agent>
  onCreateSession: (id: string) => void
  onDelete: (id: string) => void
}) {
  if (agents.length === 0) {
    return <EmptyState title="No agents" body="Create an agent, then create a session from this list." />
  }
  return (
    <TableSurface
      tableId="agents"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <colgroup>
        <col className="w-[9rem] md:w-[14rem]" />
        <col />
        <col className="w-[6.5rem]" />
        <col className="hidden lg:table-column lg:w-[13rem]" />
        <col className="hidden 2xl:table-column 2xl:w-[11rem]" />
        <col className="hidden 2xl:table-column 2xl:w-[11rem]" />
        <col className="hidden lg:table-column lg:w-[10rem]" />
        <col className="w-[5.5rem]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Agent</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden lg:table-cell">Model</TableHead>
          <TableHead className="hidden 2xl:table-cell">Skills</TableHead>
          <TableHead className="hidden 2xl:table-cell">Tools</TableHead>
          <TableHead className="hidden lg:table-cell">Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((agent) => (
          <TableRow key={agent.metadata.uid}>
            <TableCell className="min-w-0">
              <ResourceIdentityCell
                name={agent.metadata.name}
                id={agent.metadata.uid}
                to={`/agents/${agent.metadata.uid}`}
              />
            </TableCell>
            <TableCell className="min-w-0">
              <DescriptionCell value={agent.metadata.description} />
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <StatusBadge value={agent.status.phase} />
                <StatusBadge value={`v${agent.status.version}`} />
              </div>
            </TableCell>
            <TableCell className="hidden min-w-0 lg:table-cell">
              <TruncatedTooltipText value={`${agent.spec.provider ?? 'None'} / ${agent.spec.model ?? 'None'}`} />
            </TableCell>
            <TableCell className="hidden min-w-0 2xl:table-cell">
              <TruncatedTooltipText value={agent.spec.skills.join(', ') || 'None'} />
            </TableCell>
            <TableCell className="hidden min-w-0 2xl:table-cell">
              <TruncatedTooltipText value={agent.spec.allowedTools.join(', ') || 'None'} />
            </TableCell>
            <TableCell className="hidden lg:table-cell">{formatDate(agent.metadata.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => onCreateSession(agent.metadata.uid)}
                  aria-label="Create session"
                >
                  <Play data-icon="inline-start" />
                </Button>
                <ConfirmAction
                  title="Delete agent?"
                  description={`Delete ${agent.metadata.name}. It will disappear from the product and cannot be restored; existing session history is retained.`}
                  confirmLabel="Delete agent"
                  destructive
                  onConfirm={() => onDelete(agent.metadata.uid)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Delete agent">
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
