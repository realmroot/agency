import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ConfirmAction,
  DetailSection,
  EmptyState,
  Meta,
  MetaGrid,
  ResourceIdentityCell,
  StatusBadge,
  TableEmpty,
  TableSurface,
  TruncatedTooltipText,
} from '@/console/components'
import { formatDate } from '@/console/format'
import { RelatedResourcesTable } from '@/features/console/related-resources-table'
import type { Environment, Runner, Session } from '@/lib/amarpc'

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

export function EnvironmentDetailView({
  environment,
  sessions,
  runners = [],
  onDelete,
}: {
  environment: Environment | null
  sessions: Session[]
  runners?: Runner[]
  onDelete: (id: string) => void
}) {
  if (!environment) {
    return <EmptyState title="Environment not found" body="The requested environment is not in the current project." />
  }
  const boundSessions = sessions.filter((session) => session.spec.environmentId === environment.metadata.uid)
  return (
    <div className="flex flex-col gap-4">
      <DetailSection
        title="Environment profile"
        description={environment.metadata.description ?? 'No description'}
        actions={
          <>
            <StatusBadge value={environment.status.phase} />
            <StatusBadge value={`v${environment.status.version}`} />
            <ConfirmAction
              title="Delete environment?"
              description={`Delete ${environment.metadata.name}. It cannot be restored; existing session snapshots are retained.`}
              confirmLabel="Delete environment"
              destructive
              onConfirm={() => onDelete(environment.metadata.uid)}
            >
              <Button type="button" variant="outline">
                <Trash2 data-icon="inline-start" />
                Delete
              </Button>
            </ConfirmAction>
          </>
        }
      >
        <MetaGrid>
          <Meta label="Packages" value={packageSummary(environment) || 'None'} />
          <Meta label="Variables" value={Object.keys(environment.spec.variables).join(', ') || 'None'} />
          <Meta label="Type" value={environment.spec.type} />
          <Meta label="Networking" value={networkSummary(environment)} />
          <Meta label="MCP servers" value={environment.spec.networking.allowMcpServers ? 'Allowed' : 'Blocked'} />
          <Meta
            label="Package managers"
            value={environment.spec.networking.allowPackageManagers ? 'Allowed' : 'Blocked'}
          />
        </MetaGrid>
      </DetailSection>
      <Tabs defaultValue="runners">
        <TabsList>
          <TabsTrigger value="runners">Runners</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
        </TabsList>
        <TabsContent value="runners" className="mt-4">
          <EnvironmentRunnersTable runners={runners} />
        </TabsContent>
        <TabsContent value="sessions" className="mt-4">
          <RelatedResourcesTable
            title="Sessions using this environment"
            empty="No sessions use this environment."
            items={boundSessions}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function EnvironmentRunnersTable({ runners }: { runners: Runner[] }) {
  return (
    <DetailSection title="Runners" description="Self-hosted runner processes bound to this environment.">
      <TableSurface tableId="environment-runners">
        <colgroup>
          <col className="w-[10rem] md:w-[15rem]" />
          <col className="w-[7rem]" />
          <col className="hidden md:table-column md:w-[7rem]" />
          <col />
          <col className="hidden xl:table-column xl:w-[11rem]" />
          <col className="hidden lg:table-column lg:w-[11rem]" />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Runner</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Load</TableHead>
            <TableHead>Runtimes</TableHead>
            <TableHead className="hidden xl:table-cell">Heartbeat</TableHead>
            <TableHead className="hidden lg:table-cell">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runners.length === 0 ? (
            <TableEmpty colSpan={6}>No runners are registered for this environment.</TableEmpty>
          ) : (
            runners.map((runner) => (
              <TableRow key={runner.id}>
                <TableCell className="min-w-0">
                  <ResourceIdentityCell name={runner.name} id={runner.id} />
                </TableCell>
                <TableCell>
                  <StatusBadge value={runner.state} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {runner.currentLoad}/{runner.maxConcurrent}
                </TableCell>
                <TableCell className="min-w-0">
                  <TruncatedTooltipText value={runtimesSummary(runner)} fallback="None" />
                </TableCell>
                <TableCell className="hidden xl:table-cell">{formatDate(runner.lastHeartbeatAt)}</TableCell>
                <TableCell className="hidden lg:table-cell">{formatDate(runner.updatedAt)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </TableSurface>
    </DetailSection>
  )
}

function runtimesSummary(runner: Runner) {
  return runner.runtimes
    .map((entry) => `${entry.runtime}:${entry.state}${entry.version ? `@${entry.version}` : ''}`)
    .join(', ')
}
