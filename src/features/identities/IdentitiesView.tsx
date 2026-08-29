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
} from '@/console/components'
import { formatDate } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Identity } from '@/lib/amarpc'
import { identityAssignmentLabel, identityStatusLabel } from './identity-display'

export function IdentitiesView({
  identities,
  pagination,
  onArchive,
}: {
  identities: Identity[]
  pagination: ClientPagination<Identity>
  onArchive: (id: string) => void
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
              <StatusBadge
                value={identity.metadata.archivedAt ? 'archived' : identity.status.state}
                label={identityStatusLabel(identity)}
              />
            </TableCell>
            <TableCell className="hidden lg:table-cell">{identityAssignmentLabel(identity)}</TableCell>
            <TableCell className="hidden lg:table-cell">{formatDate(identity.metadata.updatedAt)}</TableCell>
            <TableCell className="text-right">
              {!identity.metadata.archivedAt ? (
                <ConfirmAction
                  title="Archive Identity?"
                  description="Archived identities can no longer be selected. Existing session history is retained."
                  confirmLabel="Archive identity"
                  destructive
                  onConfirm={() => onArchive(identity.metadata.uid)}
                >
                  <Button type="button" variant="outline" size="icon" aria-label="Archive identity">
                    <Archive />
                  </Button>
                </ConfirmAction>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableSurface>
  )
}
