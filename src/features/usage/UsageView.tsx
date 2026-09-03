import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, Meta, MetaGrid, TableEmpty, TableSurface } from '@/console/components'
import { formatCostMicros, stringifyJson } from '@/console/format'
import type { UsageSummary } from '@/lib/enborrpc'

export function UsageView({ summary }: { summary: UsageSummary | null }) {
  if (!summary)
    return <EmptyState title="No usage summary" body="Usage appears after sessions record token or runtime events." />
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Usage summary</CardTitle>
          <CardDescription>Totals across the current project filters.</CardDescription>
        </CardHeader>
        <CardContent>
          <MetaGrid columns={4}>
            <Meta label="Records" value={String(summary.totals.records)} />
            <Meta label="Prompt tokens" value={String(summary.totals.promptTokens)} />
            <Meta label="Completion tokens" value={String(summary.totals.completionTokens)} />
            <Meta label="Cost" value={formatCostMicros(summary.totals.costMicros, summary.totals.currency)} />
          </MetaGrid>
        </CardContent>
      </Card>
      <TableSurface tableId="usage">
        <TableHeader>
          <TableRow>
            <TableHead>Group</TableHead>
            <TableHead>Prompt</TableHead>
            <TableHead>Completion</TableHead>
            <TableHead>Total tokens</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.groups.length === 0 ? (
            <TableEmpty colSpan={6}>Grouped usage appears after sessions record provider events.</TableEmpty>
          ) : (
            summary.groups.map((group) => (
              <TableRow key={JSON.stringify(group.key)}>
                <TableCell className="max-w-96 truncate font-mono text-xs">{stringifyJson(group.key)}</TableCell>
                <TableCell>{group.promptTokens}</TableCell>
                <TableCell>{group.completionTokens}</TableCell>
                <TableCell>{group.totalTokens}</TableCell>
                <TableCell>{group.durationMs}ms</TableCell>
                <TableCell>{formatCostMicros(group.costMicros, group.currency)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </TableSurface>
    </div>
  )
}
