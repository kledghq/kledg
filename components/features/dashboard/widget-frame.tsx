'use client'

import * as React from 'react'
import { AlertCircle, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface WidgetFrameProps {
  /** Heading of the widget (h2: the page title is the only h1). */
  title: string
  description?: React.ReactNode
  /** Aside the heading: a total, a link. */
  action?: React.ReactNode
  /** Help next to the title (HelpTip). */
  help?: React.ReactNode
  busy?: boolean
  className?: string
  contentClassName?: string
  children: React.ReactNode
}

/**
 * Card of a chart or list widget: a region named by its heading, so screen
 * reader users can jump from widget to widget.
 */
export function WidgetFrame({ title, description, action, help, busy, className, contentClassName, children }: WidgetFrameProps) {
  const headingId = React.useId()
  return (
    <Card role="region" aria-labelledby={headingId} aria-busy={busy || undefined} className={cn('h-full', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5">
        <div className="min-w-0 flex-1 basis-48 space-y-1.5">
          <h2 id={headingId} className="flex items-center gap-1.5 leading-tight font-semibold tracking-tight">
            {title}
            {help}
          </h2>
          {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn('flex-1 px-5', contentClassName)}>{children}</div>
    </Card>
  )
}

/** Rows shaped like a list widget while it loads. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton() {
  return <Skeleton aria-hidden className="h-64 w-full" />
}

/** What failed and a retry, inside the widget: the rest of the dashboard keeps working. */
export function WidgetError({ message, onRetry, compact }: { message: string; onRetry: () => void; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-start gap-2', compact ? 'py-1' : 'py-4')} role="alert">
      <p className="text-muted-foreground flex items-start gap-2 text-sm">
        <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{message}</span>
      </p>
      <Button size="xs" variant="outline" onClick={onRetry}>
        <RotateCw aria-hidden />
        Réessayer
      </Button>
    </div>
  )
}
