import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DescriptionCell,
  ResourceIdentityCell,
  StatusBadge,
  TableEmpty,
  TablePagination,
  TableSurface,
  TruncatedTooltipText,
} from '@/console/components'
import type { ClientPagination } from '@/console/use-client-pagination'
import type { Connector } from '@/lib/enborrpc'

export function connectorDisabledReason(connector: Connector) {
  if (connector.availability === 'unavailable') {
    return 'Connector is unavailable on this platform.'
  }
  return null
}

export function McpView({
  connectors,
  connectorPagination,
}: {
  connectors: Connector[]
  connectorPagination: ClientPagination<Connector>
}) {
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>MCP connectors</CardTitle>
          <CardDescription>
            Platform MCP server catalog entries with capabilities, auth mode, and setup metadata.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TableSurface
            tableId="mcp-connectors"
            viewportRef={connectorPagination.viewportRef}
            footer={<TablePagination pagination={connectorPagination} />}
          >
            <colgroup>
              <col className="w-[9rem] md:w-[14rem]" />
              <col />
              <col className="hidden md:table-column md:w-[9rem]" />
              <col className="w-[7rem]" />
              <col className="hidden lg:table-column lg:w-[13rem]" />
              <col className="hidden 2xl:table-column 2xl:w-[15rem]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Connector</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead>Trust level</TableHead>
                <TableHead className="hidden lg:table-cell">Capabilities</TableHead>
                <TableHead className="hidden 2xl:table-cell">Auth and setup</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.length === 0 ? (
                <TableEmpty colSpan={6}>No MCP connectors match the current catalog filters.</TableEmpty>
              ) : (
                connectors.map((connector) => {
                  const disabledReason = connectorDisabledReason(connector)
                  const description = disabledReason ?? connector.description
                  return (
                    <TableRow
                      key={connector.id}
                      aria-disabled={disabledReason ? true : undefined}
                      data-connector-id={connector.id}
                      className={disabledReason ? 'opacity-60' : undefined}
                    >
                      <TableCell className="min-w-0">
                        <ResourceIdentityCell
                          name={connector.name}
                          id={connector.id}
                          to={disabledReason ? undefined : `/settings/mcp/${connector.id}`}
                        />
                      </TableCell>
                      <TableCell className="min-w-0">
                        <DescriptionCell value={description} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{connector.category}</TableCell>
                      <TableCell>
                        <StatusBadge value={connector.trustLevel} />
                      </TableCell>
                      <TableCell className="hidden min-w-0 lg:table-cell">
                        <TruncatedTooltipText value={connector.capabilities.join(', ') || 'None'} />
                      </TableCell>
                      <TableCell className="hidden min-w-0 2xl:table-cell">
                        <TruncatedTooltipText
                          value={`${connector.supportedAuthModes.join(', ') || 'None'} · Setup: ${
                            connector.setupRequirements.join(', ') || 'None'
                          }`}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </TableSurface>
        </CardContent>
      </Card>
    </div>
  )
}
