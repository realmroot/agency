'use client'

import type * as React from 'react'
import { createContext, useContext } from 'react'

import { cn } from '@/lib/utils'

// When a table renders inside a resize-aware surface it provides this so each
// header can drag its own column width. Null outside a resizable table.
const ColumnResizeContext = createContext<{ setWidth: (columnIndex: number, width: number) => void } | null>(null)

export function ColumnResizeProvider({
  value,
  children,
}: {
  value: { setWidth: (columnIndex: number, width: number) => void } | null
  children: React.ReactNode
}) {
  return <ColumnResizeContext.Provider value={value}>{children}</ColumnResizeContext.Provider>
}

// A 6px grab strip on the header's right edge. Reads the column from the parent
// th's cellIndex (no fragile counter) and reports new widths during the drag.
function ColumnResizeHandle({ onResize }: { onResize: (columnIndex: number, width: number) => void }) {
  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    const th = event.currentTarget.parentElement as HTMLTableCellElement | null
    if (!th) return
    const columnIndex = th.cellIndex
    const startX = event.clientX
    const startWidth = th.offsetWidth
    const move = (moveEvent: PointerEvent) => onResize(columnIndex, startWidth + (moveEvent.clientX - startX))
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      aria-label="Resize column"
      tabIndex={-1}
      className="absolute top-0 right-0 z-10 h-full w-1.5 cursor-col-resize touch-none select-none border-0 bg-transparent p-0 hover:bg-primary/40"
    />
  )
}

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-hidden">
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, children, ...props }: React.ComponentProps<'th'>) {
  const resize = useContext(ColumnResizeContext)
  return (
    <th
      data-slot="table-head"
      className={cn(
        'relative h-10 overflow-hidden px-2 text-left align-middle font-medium text-ellipsis whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    >
      {children}
      {resize ? <ColumnResizeHandle onResize={resize.setWidth} /> : null}
    </th>
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'overflow-hidden p-2 align-middle text-ellipsis whitespace-nowrap [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return (
    <caption data-slot="table-caption" className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
  )
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow }
