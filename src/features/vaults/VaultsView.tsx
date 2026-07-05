import { Archive } from 'lucide-react'
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
import { archivedLabel, formatDate } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Vault } from '@/lib/amarpc'

export function VaultsView({
  vaults,
  pagination,
  onArchive,
}: {
  vaults: Vault[]
  pagination: ClientPagination<Vault>
  onArchive: (id: string) => void
}) {
  if (vaults.length === 0) {
    return <EmptyState title="No vaults" body="Create a vault to track safe secret references for providers and MCP." />
  }
  return (
    <TableSurface
      tableId="vaults"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <colgroup>
        <col className="w-[9rem] md:w-[14rem]" />
        <col />
        <col className="w-[6.5rem]" />
        <col className="hidden md:table-column md:w-[8rem]" />
        <col className="hidden lg:table-column lg:w-[11rem]" />
        <col className="hidden 2xl:table-column 2xl:w-[10rem]" />
        <col className="hidden lg:table-column lg:w-[10rem]" />
        <col className="w-[4.5rem]" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Vault</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden md:table-cell">Scope</TableHead>
          <TableHead className="hidden lg:table-cell">Project</TableHead>
          <TableHead className="hidden 2xl:table-cell">Created</TableHead>
          <TableHead className="hidden lg:table-cell">Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vaults.map((vault) => (
          <TableRow key={vault.metadata.uid}>
            <TableCell className="min-w-0">
              <ResourceIdentityCell
                name={vault.metadata.name}
                id={vault.metadata.uid}
                to={`/vaults/${vault.metadata.uid}`}
              />
            </TableCell>
            <TableCell className="min-w-0">
              <DescriptionCell value={vault.metadata.description} />
            </TableCell>
            <TableCell>
              <StatusBadge value={archivedLabel(vault)} />
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <StatusBadge value={vault.spec.scope} />
            </TableCell>
            <TableCell className="hidden min-w-0 lg:table-cell">
              <TruncatedTooltipText value={vault.metadata.projectId ?? 'Organization'} />
            </TableCell>
            <TableCell className="hidden 2xl:table-cell">{formatDate(vault.metadata.createdAt)}</TableCell>
            <TableCell className="hidden lg:table-cell">{formatDate(vault.metadata.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex justify-end">
                <ConfirmAction
                  title="Archive vault?"
                  description={`Archive ${vault.metadata.name}. Existing secret references remain auditable.`}
                  confirmLabel="Archive vault"
                  destructive
                  onConfirm={() => onArchive(vault.metadata.uid)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Archive vault">
                    <Archive data-icon="inline-start" />
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
