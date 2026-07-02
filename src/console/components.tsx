import { Bot, ChevronLeft, ChevronRight } from 'lucide-react'
import { type ReactNode, type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Link, useMatch } from 'react-router'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge as UiBadge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ColumnResizeProvider, Table } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ClientPagination } from './use-client-pagination'

export function FullscreenMessage({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-muted/40 px-6 text-foreground">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto grid size-12 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bot size={24} />
          </div>
          <CardTitle className="mt-2 text-xl">{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        {action ? <CardFooter className="justify-center bg-transparent pt-0">{action}</CardFooter> : null}
      </Card>
    </main>
  )
}

export function NavButton({ icon, to, label }: NavProps) {
  const active = useNavActive(to)
  return (
    <Link
      to={to}
      className={cn(buttonVariants({ variant: active ? 'default' : 'ghost' }), 'w-full justify-start')}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      {label}
    </Link>
  )
}

export function MobileNavButton({ icon, to, label }: NavProps) {
  const active = useNavActive(to)
  return (
    <Link
      to={to}
      className={cn(buttonVariants({ variant: active ? 'default' : 'outline' }), 'shrink-0')}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span>{label}</span>
    </Link>
  )
}

export function DisabledNav({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm text-muted-foreground/70">
      {icon}
      {label}
    </div>
  )
}

export function StatusBadge({ value, detail }: { value: string; detail?: string | null }) {
  const variant =
    value === 'error' || value === 'missing' || value === 'blocked'
      ? 'destructive'
      : value === 'archived' ||
          value === 'closed' ||
          value === 'disabled' ||
          value === 'deleted' ||
          value === 'disconnected'
        ? 'secondary'
        : 'outline'
  const badge = <UiBadge variant={variant}>{value}</UiBadge>
  if (!detail) {
    return badge
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${value}: ${detail}`}
            className="inline-flex cursor-help border-0 bg-transparent p-0"
          >
            {badge}
          </button>
        </TooltipTrigger>
        <TooltipContent>{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function PageHeader({
  eyebrow,
  title,
  titleAccessory,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  titleAccessory?: ReactNode
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="truncate text-xs font-medium uppercase text-muted-foreground">{eyebrow}</p> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-normal text-foreground">{title}</h1>
          {titleAccessory}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

const WIDTHS_KEY = 'ama:table-widths:'

function loadWidths(tableId: string): number[] | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WIDTHS_KEY + tableId) ?? 'null') as unknown
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'number') ? (parsed as number[]) : null
  } catch {
    return null
  }
}

function saveWidths(tableId: string, widths: number[]) {
  try {
    window.localStorage.setItem(WIDTHS_KEY + tableId, JSON.stringify(widths))
  } catch {
    // storage may be unavailable (private mode / quota); width persistence is best-effort.
  }
}

// Columns render auto-sized once, then their natural widths are fixed so the
// table no longer collapses every column to an equal table-fixed share, and each
// becomes drag-resizable. A tableId persists the user's widths across reloads.
function useColumnWidths(tableId: string | undefined, tableRef: RefObject<HTMLTableElement | null>) {
  const [widths, setWidths] = useState<number[] | null>(null)
  useLayoutEffect(() => {
    if (widths) return
    const ths = tableRef.current?.querySelectorAll<HTMLTableCellElement>(':scope > thead > tr:first-child > th')
    if (!ths?.length) return
    const measured = Array.from(ths, (th) => Math.round(th.getBoundingClientRect().width))
    const persisted = tableId ? loadWidths(tableId) : null
    setWidths(persisted && persisted.length === measured.length ? persisted : measured)
  }, [widths, tableId, tableRef])
  const setWidth = useCallback(
    (columnIndex: number, width: number) => {
      setWidths((prev) => {
        if (!prev) return prev
        const next = [...prev]
        next[columnIndex] = Math.max(80, Math.round(width))
        if (tableId) saveWidths(tableId, next)
        return next
      })
    },
    [tableId],
  )
  return { widths, setWidth }
}

export function TableSurface({
  children,
  footer,
  viewportRef,
  className,
  tableClassName,
  tableId,
}: {
  children: ReactNode
  footer?: ReactNode
  viewportRef?: RefObject<HTMLDivElement | null>
  className?: string
  tableClassName?: string
  // Persists drag-resized column widths under this id (omit for ephemeral widths).
  tableId?: string
}) {
  const tableRef = useRef<HTMLTableElement>(null)
  const { widths, setWidth } = useColumnWidths(tableId, tableRef)
  return (
    <div
      className={cn(
        'flex max-h-[calc(100dvh-17rem)] min-h-0 flex-col overflow-hidden rounded-lg border bg-background',
        className,
      )}
    >
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto">
        <Table ref={tableRef} className={cn('min-w-[760px]', widths ? 'table-fixed' : 'table-auto', tableClassName)}>
          <ColumnResizeProvider value={widths ? { setWidth } : null}>
            {widths ? (
              <colgroup>
                {widths.map((width, columnIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional, index is the stable identity
                  <col key={columnIndex} style={{ width: `${width}px` }} />
                ))}
              </colgroup>
            ) : null}
            {children}
          </ColumnResizeProvider>
        </Table>
      </div>
      {footer ? <div className="shrink-0 border-t bg-background px-3 py-2">{footer}</div> : null}
    </div>
  )
}

export function TablePagination<T>({ pagination }: { pagination: ClientPagination<T> }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="truncate">
        {pagination.start}-{pagination.end} of {pagination.total}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={!pagination.canPrevious}
          onClick={pagination.previous}
        >
          <ChevronLeft data-icon="inline-start" />
        </Button>
        <span className="min-w-16 text-center">
          {pagination.page} / {pagination.pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={!pagination.canNext}
          onClick={pagination.next}
        >
          <ChevronRight data-icon="inline-start" />
        </Button>
      </div>
    </div>
  )
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="h-24 px-4 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  )
}

export function DetailSection({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string | undefined
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <CardAction className="flex flex-wrap gap-2">{actions}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function MetaGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 4 }) {
  return <dl className={cn('grid gap-2 text-xs', columns === 4 ? 'md:grid-cols-4' : 'md:grid-cols-2')}>{children}</dl>
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-mono text-[11px] text-foreground">{value}</dd>
    </div>
  )
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card className="min-h-64 justify-center border-dashed bg-background">
      <CardContent className="mx-auto flex max-w-md flex-col items-center gap-4 py-10 text-center">
        <div className="flex flex-col gap-2">
          <CardTitle className="text-lg">{title}</CardTitle>
          <CardDescription className="text-balance leading-6">{body}</CardDescription>
        </div>
        {action ? <div className="flex flex-wrap justify-center gap-2">{action}</div> : null}
      </CardContent>
    </Card>
  )
}

export function ConfirmAction({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  open,
  onOpenChange,
  destructive = false,
}: {
  children?: ReactNode
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  destructive?: boolean
}) {
  return (
    <AlertDialog {...(open === undefined ? {} : { open })} {...(onOpenChange === undefined ? {} : { onOpenChange })}>
      {children ? <AlertDialogTrigger asChild>{children}</AlertDialogTrigger> : null}
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

interface NavProps {
  icon: ReactNode
  to: string
  label: string
}

function useNavActive(to: string) {
  const exact = useMatch({ path: to, end: true })
  const nested = useMatch(`${to}/*`)
  return Boolean(exact || nested)
}
