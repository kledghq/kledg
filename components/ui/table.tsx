"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Tables scroll horizontally inside their own container, never the page
 * (see docs/design-system.md, "Tables"). Amount columns use `numeric` on both
 * TableHead and TableCell: right aligned, tabular figures.
 */
function Table({
  className,
  containerClassName,
  stickyHeader = false,
  ...props
}: React.ComponentProps<"table"> & {
  /** Classes for the scroll container (e.g. a max height with `stickyHeader`). */
  containerClassName?: string
  /** Keeps the header row visible while the container scrolls vertically. */
  stickyHeader?: boolean
}) {
  return (
    <div
      data-slot="table-container"
      className={cn(
        "relative w-full max-w-full overflow-x-auto",
        stickyHeader && "overflow-y-auto",
        containerClassName
      )}
    >
      <table
        data-slot="table"
        data-sticky-header={stickyHeader || undefined}
        className={cn(
          "w-full caption-bottom text-sm",
          stickyHeader &&
            "[&_thead_th]:bg-card [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:shadow-[inset_0_-1px_0_var(--border)]",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  )
}

function TableHead({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"th"> & {
  /** Amount or count column: right aligned. */
  numeric?: boolean
}) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-9 px-3 text-left align-middle text-xs font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        numeric && "text-right",
        className
      )}
      {...props}
    />
  )
}

function TableCell({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"td"> & {
  /** Amount or count cell: right aligned, tabular figures. */
  numeric?: boolean
}) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        numeric && "num text-right",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

/** A full-width row for "nothing to show": what is missing and what to do next. */
function TableEmpty({
  colSpan,
  children,
  className,
}: {
  colSpan: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <tr data-slot="table-empty" className="hover:bg-transparent">
      <td
        colSpan={colSpan}
        className={cn("text-muted-foreground px-3 py-10 text-center text-sm whitespace-normal", className)}
      >
        {children}
      </td>
    </tr>
  )
}

/** Placeholder rows shown while the table data loads (keeps the layout stable). */
function TableSkeleton({
  columns,
  rows = 5,
}: {
  columns: number
  rows?: number
}) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} data-slot="table-skeleton" className="border-b last:border-0" aria-hidden>
          {Array.from({ length: columns }, (_, col) => (
            <td key={col} className="px-3 py-2.5">
              <Skeleton className={cn("h-4", col === 0 ? "w-24" : "w-full max-w-40")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableEmpty,
  TableSkeleton,
}
