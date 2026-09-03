import { Link } from 'react-router'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, StatusBadge, TablePagination, TableSurface } from '@/console/components'
import { formatDate } from '@/console/format'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { AuditRecord } from '@/lib/enborrpc'

export function AuditView({
  records,
  pagination,
}: {
  records: AuditRecord[]
  pagination: ClientPagination<AuditRecord>
}) {
  if (records.length === 0) {
    return <EmptyState title="No audit records" body="Security-relevant control-plane activity will appear here." />
  }
  return (
    <TableSurface
      tableId="audit"
      viewportRef={pagination.viewportRef}
      footer={<TablePagination pagination={pagination} />}
    >
      <TableHeader>
        <TableRow>
          <TableHead>Action</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Resource</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Policy</TableHead>
          <TableHead>Request</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record) => (
          <TableRow key={record.id}>
            <TableCell className="min-w-56 font-medium">
              <Link to={`/audit/${record.id}`} className="hover:underline">
                {record.action}
              </Link>
            </TableCell>
            <TableCell>
              <StatusBadge value={record.outcome} />
            </TableCell>
            <TableCell className="max-w-72 truncate">{`${record.resourceType} / ${record.resourceId ?? 'None'}`}</TableCell>
            <TableCell className="max-w-56 truncate">{record.actorUserId ?? record.actorType}</TableCell>
            <TableCell>{record.policyCategory ?? 'None'}</TableCell>
            <TableCell className="max-w-56 truncate">{record.requestId ?? 'None'}</TableCell>
            <TableCell>{formatDate(record.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableSurface>
  )
}
