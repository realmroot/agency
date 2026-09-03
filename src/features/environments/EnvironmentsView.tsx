import { Trash2 } from 'lucide-react'
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
import type { Environment } from '@/lib/amarpc'

function networkSummary(environment: Environment) {
  if (environment.spec.networking.type === 'limited') {
    return `Limited: ${(environment.spec.networking.allowedHosts ?? []).join(', ')}`
  }
  return environment.spec.networking.type
}

function packageSummary(environment: Environment) {
  return Object.entries(environment.spec.packages)
    .filter(([key]) => key !== 'type')
    .flatMap(([manager, packages]) => (packages as string[]).map((pkg) => `${manager}:${pkg}`))
    .join(', ')
}

export function EnvironmentsView({
  environments,
  pagination,
  onDelete,
}: {
  environments: Environment[]
  pagination: ClientPagination<Environment>
  onDelete: (id: string) => void
}) {
  if (environments.length === 0) {
    return <EmptyState title="No environments" body="Create an execution environment before creating an agent." />
  }
  return (
    <TableSurface
      tableId="environments"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <colgroup>
        <col className="w-[9rem] md:w-[14rem]" />
        <col />
        <col className="w-[6.5rem]" />
        <col className="hidden md:table-column md:w-[8rem]" />
        <col className="hidden lg:table-column lg:w-[12rem]" />
        <col className="hidden 2xl:table-column 2xl:w-[13rem]" />
        <col className="hidden lg:table-column lg:w-[10rem]" />
        <col className="w-[4.5rem]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Environment</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Type</TableHead>
          <TableHead className="hidden lg:table-cell">Networking</TableHead>
          <TableHead className="hidden 2xl:table-cell">Packages</TableHead>
          <TableHead className="hidden lg:table-cell">Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {environments.map((environment) => (
          <TableRow key={environment.metadata.uid}>
            <TableCell className="min-w-0">
              <ResourceIdentityCell
                name={environment.metadata.name}
                id={environment.metadata.uid}
                to={`/environments/${environment.metadata.uid}`}
              />
            </TableCell>
            <TableCell className="min-w-0">
              <DescriptionCell value={environment.metadata.description} />
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                <StatusBadge value={environment.status.phase} />
                <StatusBadge value={`v${environment.status.version}`} />
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell">{environment.spec.type}</TableCell>
            <TableCell className="hidden min-w-0 lg:table-cell">
              <TruncatedTooltipText value={networkSummary(environment)} />
            </TableCell>
            <TableCell className="hidden min-w-0 2xl:table-cell">
              <TruncatedTooltipText value={packageSummary(environment) || 'None'} />
            </TableCell>
            <TableCell className="hidden lg:table-cell">{formatDate(environment.metadata.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end">
                <ConfirmAction
                  title="Delete environment?"
                  description={`Delete ${environment.metadata.name}. It will disappear from the product and cannot be restored.`}
                  confirmLabel="Delete environment"
                  destructive
                  onConfirm={() => onDelete(environment.metadata.uid)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Delete environment">
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
