import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DescriptionCell,
  DetailSection,
  ResourceIdentityCell,
  StatusBadge,
  TableEmpty,
  TableSurface,
} from '@/console/components'
import { formatDate } from '@/console/format'
import type { Agent, Session } from '@/lib/enborrpc'

function isAgent(item: Agent | Session): item is Agent {
  return 'systemPrompt' in item.spec
}

export function RelatedResourcesTable({
  title,
  empty,
  items,
}: {
  title: string
  empty: string
  items: Array<Agent | Session>
}) {
  return (
    <DetailSection title={title}>
      <TableSurface tableId="related-resources">
        <colgroup>
          <col className="w-[9rem] md:w-[14rem]" />
          <col />
          <col className="w-[6rem]" />
          <col className="hidden md:table-column md:w-[10rem]" />
          <col className="hidden md:table-column md:w-[5rem]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Resource</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Updated</TableHead>
            <TableHead className="hidden text-right md:table-cell">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableEmpty colSpan={5}>{empty}</TableEmpty>
          ) : (
            items.map((item) => {
              const agent = isAgent(item)
              const id = item.metadata.uid
              const name = item.metadata.name
              const updated = agent
                ? formatDate(item.metadata.updatedAt)
                : item.status.startedAt
                  ? formatDate(item.status.startedAt)
                  : 'None'
              return (
                <TableRow key={id}>
                  <TableCell className="min-w-0">
                    <ResourceIdentityCell name={name} id={id} to={agent ? `/agents/${id}` : `/sessions/${id}`} />
                  </TableCell>
                  <TableCell className="min-w-0">
                    <DescriptionCell value={agent ? item.metadata.description : null} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={item.status.phase} />
                  </TableCell>
                  <TableCell className="hidden min-w-0 md:table-cell">
                    <span className="block truncate">{updated}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex justify-end">
                      <Button asChild variant="outline" size="sm">
                        <Link to={agent ? `/agents/${id}` : `/sessions/${id}`}>Open</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })
          )}
        </TableBody>
      </TableSurface>
    </DetailSection>
  )
}
