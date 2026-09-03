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
} from '@/console/components'
import { formatDate } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Identity } from '@/lib/enborrpc'
import { identityAssignmentLabel, identityStatusLabel } from './identity-display'

export function IdentitiesView({
  identities,
  pagination,
  onDelete,
}: {
  identities: Identity[]
  pagination: ClientPagination<Identity>
  onDelete: (id: string) => void
}) {
  if (identities.length === 0)
    return (
      <EmptyState title="No identities" body="Create an identity to give an agent a stable identity and runtime." />
    )
  return (
    <TableSurface
      tableId="identities"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <TableHeader>
        <TableRow>
          <TableHead>Identity</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Runtime</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden lg:table-cell">Assigned agent</TableHead>
          <TableHead className="hidden lg:table-cell">Updated</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {identities.map((identity) => (
          <TableRow key={identity.metadata.uid}>
            <TableCell>
              <ResourceIdentityCell
                name={identity.metadata.name}
                id={identity.spec.username}
                to={`/identities/${identity.metadata.uid}`}
              />
            </TableCell>
            <TableCell>
              <DescriptionCell value={identity.metadata.description} />
            </TableCell>
            <TableCell>
              <StatusBadge value={identity.spec.runtime} />
            </TableCell>
            <TableCell>
              <StatusBadge value={identity.status.state} label={identityStatusLabel(identity)} />
            </TableCell>
            <TableCell className="hidden lg:table-cell">{identityAssignmentLabel(identity)}</TableCell>
            <TableCell className="hidden lg:table-cell">{formatDate(identity.metadata.updatedAt)}</TableCell>
            <TableCell className="text-right">
              <ConfirmAction
                title="Delete identity?"
                description="This identity will disappear from the product and cannot be restored. Database history is retained."
                confirmLabel="Delete identity"
                destructive
                onConfirm={() => onDelete(identity.metadata.uid)}
              >
                <Button type="button" variant="outline" size="icon" aria-label="Delete identity">
                  <Trash2 />
                </Button>
              </ConfirmAction>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableSurface>
  )
}
