import { Boxes, ChevronDown, CircleStop, Cloud, GitBranch, RotateCcw, Timer, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ConfirmAction, Meta, MetaGrid, StatusBadge } from '@/console/components'
import { formatDuration, formatRelativeTime, stringifyJson } from '@/console/format'
import { JsonBlock } from '@/features/console/json-block'
import { SessionRuntimePanel } from '@/features/sessions/SessionRuntimePanel'
import type { SessionRuntimeState } from '@/features/sessions/session-runtime'
import type { Session } from '@/lib/enborrpc'

export function SessionDetailView({
  session,
  agentName: agentDisplayName,
  environmentName: environmentDisplayName,
  runtime,
  onClose,
  onReopen,
  onDelete,
  closePending = false,
  reopenPending = false,
  deletePending = false,
  onReconnectRuntime,
  chatMessage,
  setChatMessage,
  onSendMessage,
  onAbortRuntime,
}: {
  session: Session
  agentName: string | undefined
  environmentName: string | undefined
  runtime: SessionRuntimeState
  onClose: (id: string) => void
  onReopen: (id: string) => void
  onDelete: (id: string) => void
  closePending?: boolean
  reopenPending?: boolean
  deletePending?: boolean
  onReconnectRuntime: () => void
  chatMessage: string
  setChatMessage: (value: string) => void
  onSendMessage: (message: string) => void
  onAbortRuntime: () => void
}) {
  const [pendingAction, setPendingAction] = useState<'close' | 'reopen' | 'delete' | null>(null)
  const [activeSheet, setActiveSheet] = useState<'agent' | 'environment' | 'volumes' | null>(null)
  const sessionId = session.metadata.uid
  const phase = session.status.phase
  const agentSnapshot = session.status.bindings.agent.snapshot
  const environmentSnapshot = session.status.bindings.environment.snapshot
  const volumes = session.spec.volumes
  const shortSessionId = `${sessionId.slice(0, 5)}...${sessionId.slice(-7)}`
  const duration = formatDuration(session.status.startedAt, session.status.closedAt)
  const isClosed = phase === 'closed'
  const actionPending = closePending || reopenPending || deletePending
  const agentName = agentDisplayName || agentSnapshot.systemPrompt || session.spec.agentId
  const environmentName = String(environmentDisplayName ?? session.spec.environmentId ?? 'Environment')
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b px-4 py-4 lg:px-6">
        <div className="flex flex-col gap-5">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <nav className="flex min-w-0 items-center gap-3 text-sm text-muted-foreground" aria-label="Breadcrumb">
              <Link to="/sessions" className="hover:text-foreground">
                Sessions
              </Link>
              <span className="text-border">/</span>
              <span className="truncate font-mono font-medium text-foreground">{shortSessionId}</span>
            </nav>
            <div className="flex shrink-0 items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" disabled={actionPending}>
                    Actions
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {isClosed ? (
                    <DropdownMenuItem onSelect={() => setPendingAction('reopen')}>
                      <RotateCcw />
                      Reopen session
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => setPendingAction('close')} variant="destructive">
                      <CircleStop />
                      Close session
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setPendingAction('delete')} variant="destructive">
                    <Trash2 />
                    Delete session
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2 overflow-hidden">
              <h1 className="min-w-24 flex-1 truncate text-3xl font-semibold tracking-normal text-foreground">
                {session.metadata.name}
              </h1>
              <div className="shrink-0">
                <StatusBadge value={phase} detail={phase === 'error' ? session.status.reason : null} />
              </div>
              <div className="hidden min-w-0 shrink items-center gap-2 text-sm text-muted-foreground md:flex">
                <SessionMeta
                  icon={<GitBranch className="size-4" />}
                  value={agentName}
                  label="Open agent details"
                  onClick={() => setActiveSheet('agent')}
                />
                <SessionMeta
                  icon={<Cloud className="size-4" />}
                  value={environmentName}
                  label="Open environment details"
                  onClick={() => setActiveSheet('environment')}
                  disabled={!environmentSnapshot}
                />
                <SessionMeta icon={<Timer className="size-4" />} value={duration} />
                <SessionMeta
                  icon={<Boxes className="size-4" />}
                  value={`${volumes.length} volumes`}
                  label="Open session volumes"
                  onClick={() => setActiveSheet('volumes')}
                />
                <Separator orientation="vertical" className="h-4" />
                <span className="shrink-0">{formatRelativeTime(session.metadata.updatedAt)}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 text-sm text-muted-foreground md:hidden">
              <SessionMeta
                icon={<GitBranch className="size-4" />}
                value={agentName}
                label="Open agent details"
                onClick={() => setActiveSheet('agent')}
              />
              <SessionMeta
                icon={<Cloud className="size-4" />}
                value={environmentName}
                label="Open environment details"
                onClick={() => setActiveSheet('environment')}
                disabled={!environmentSnapshot}
              />
              <SessionMeta icon={<Timer className="size-4" />} value={duration} />
              <SessionMeta
                icon={<Boxes className="size-4" />}
                value={`${volumes.length} volumes`}
                label="Open session volumes"
                onClick={() => setActiveSheet('volumes')}
              />
              <span className="shrink-0">{formatRelativeTime(session.metadata.updatedAt)}</span>
            </div>
          </div>
        </div>
      </header>

      <SessionRuntimePanel
        runtime={runtime}
        message={chatMessage}
        setMessage={setChatMessage}
        onSend={onSendMessage}
        onAbort={onAbortRuntime}
        onReconnect={onReconnectRuntime}
        canSend={phase === 'idle'}
      />
      <Sheet
        open={activeSheet !== null}
        onOpenChange={(open) => {
          /* v8 ignore start -- Radix never calls onOpenChange(true) in controlled mode (jsdom) */
          if (!open) setActiveSheet(null)
          /* v8 ignore stop */
        }}
      >
        <SheetContent className="overflow-y-auto">
          {activeSheet === 'agent' ? (
            <SnapshotSheet
              title={agentName}
              description={`Agent snapshot captured for ${sessionId}`}
              meta={
                <MetaGrid>
                  <Meta label="Agent id" value={session.spec.agentId} />
                  <Meta label="Version" value={`v${agentSnapshot.version}`} />
                  <Meta label="Provider" value={agentSnapshot.provider ?? 'Not pinned'} />
                  <Meta label="Model" value={agentSnapshot.model ?? 'None'} />
                  <Meta label="Skills" value={agentSnapshot.skills.join(', ') || 'None'} />
                  <Meta label="Allowed tools" value={agentSnapshot.allowedTools.join(', ') || 'None'} />
                  <Meta label="MCP connectors" value={agentSnapshot.mcpConnectors.join(', ') || 'None'} />
                </MetaGrid>
              }
              json={{
                systemPrompt: agentSnapshot.systemPrompt,
                subagents: agentSnapshot.subagents,
              }}
            />
          ) : null}
          {activeSheet === 'environment' && environmentSnapshot ? (
            <SnapshotSheet
              title={environmentName}
              description={`Environment snapshot captured for ${sessionId}`}
              meta={
                <MetaGrid>
                  <Meta label="Environment id" value={session.spec.environmentId ?? 'None'} />
                  <Meta label="Version" value={`v${environmentSnapshot.version}`} />
                  <Meta label="Type" value={environmentSnapshot.type} />
                  <Meta label="Runtime" value={session.status.bindings.runtime} />
                  <Meta label="Packages" value={environmentPackageSummary(environmentSnapshot.packages) || 'None'} />
                  <Meta label="Variables" value={Object.keys(environmentSnapshot.variables).join(', ') || 'None'} />
                </MetaGrid>
              }
              json={{
                networking: environmentSnapshot.networking,
              }}
            />
          ) : null}
          {activeSheet === 'volumes' ? (
            <SnapshotSheet
              title="Session volumes"
              description={`Mountable session inputs captured for ${sessionId}`}
              meta={
                <MetaGrid>
                  <Meta label="Count" value={String(volumes.length)} />
                  <Meta label="Git repositories" value={String(gitVolumes(session).length)} />
                  <Meta
                    label="Memory stores"
                    value={
                      memoryStoreVolumes(session).length === 0 ? 'None' : String(memoryStoreVolumes(session).length)
                    }
                  />
                  <Meta label="Workspace manifest" value="/workspace/.enbor/resources.json" />
                  <Meta label="Setup status" value="Declared for runtime executor setup" />
                </MetaGrid>
              }
              json={{
                volumes: volumes.map(safeVolumeView),
                volumeMounts: session.spec.volumeMounts,
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <ConfirmAction
        title="Close session?"
        description="Close the selected runtime session. In-flight work may be interrupted."
        confirmLabel="Close session"
        destructive
        pending={closePending}
        open={pendingAction === 'close'}
        onOpenChange={(open) => !open && setPendingAction(null)}
        onConfirm={() => onClose(sessionId)}
      />
      <ConfirmAction
        title="Reopen session?"
        description="Restart the selected runtime session so it can accept new messages."
        confirmLabel="Reopen session"
        pending={reopenPending}
        open={pendingAction === 'reopen'}
        onOpenChange={(open) => !open && setPendingAction(null)}
        onConfirm={() => onReopen(sessionId)}
      />
      <ConfirmAction
        title="Delete session?"
        description="Delete this session from the product while preserving persisted events. It cannot be restored."
        confirmLabel="Delete session"
        destructive
        pending={deletePending}
        open={pendingAction === 'delete'}
        onOpenChange={(open) => !open && setPendingAction(null)}
        onConfirm={() => onDelete(sessionId)}
      />
    </div>
  )
}

function environmentPackageSummary(packages: {
  type: 'packages'
  apt: string[]
  cargo: string[]
  gem: string[]
  go: string[]
  npm: string[]
  pip: string[]
}) {
  return Object.entries(packages)
    .filter(([key]) => key !== 'type')
    .flatMap(([manager, values]) => (values as string[]).map((value) => `${manager}:${value}`))
    .join(', ')
}

function gitVolumes(session: Session) {
  return session.spec.volumes.filter((volume) => volume.type === 'git_repository')
}

function memoryStoreVolumes(session: Session) {
  return session.spec.volumes.filter((volume) => volume.type === 'memory')
}

function safeVolumeView(volume: Record<string, unknown>) {
  if (volume.type === 'memory') {
    return {
      name: volume.name,
      type: volume.type,
      memoryRef: volume.memoryRef,
    }
  }
  if (volume.type !== 'git_repository') {
    return volume
  }
  return {
    name: volume.name,
    type: volume.type,
    url: volume.url,
    ref: volume.ref,
    ...(typeof volume.secretRef === 'string' ? { secretRef: volume.secretRef } : {}),
  }
}

function SessionMeta({
  icon,
  value,
  label,
  onClick,
  disabled = false,
}: {
  icon: ReactNode
  value: string
  label?: string
  onClick?: () => void
  disabled?: boolean
}) {
  const content = (
    <>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="truncate">{value}</span>
    </>
  )
  const className =
    'inline-flex h-8 max-w-full items-center gap-2 rounded-md border bg-muted/30 px-2.5 text-foreground/80 sm:max-w-[260px]'
  if (!onClick) {
    return <span className={className}>{content}</span>
  }
  return (
    <button
      type="button"
      className={`${className} cursor-pointer hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60`}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  )
}

function SnapshotSheet({
  title,
  description,
  meta,
  json,
}: {
  title: string
  description: string
  meta: ReactNode
  json: Record<string, unknown>
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        {meta}
        <JsonBlock value={stringifyJson(json)} compact />
      </div>
    </>
  )
}
