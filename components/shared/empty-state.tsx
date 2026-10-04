import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight } from 'lucide-react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** Optional icon, shown small in a hairline square. */
  icon?: LucideIcon
  /** "success" for "all done" states (e.g. nothing left to reconcile). */
  tone?: 'default' | 'success'
  /** What is missing, as a statement: "Aucun journal". */
  title: string
  /** What to do next, in one or two sentences. */
  description?: React.ReactNode
  /** Main next step, usually a `<Button>` (size "sm"). */
  action?: React.ReactNode
  /** Optional second step (e.g. an outline button). */
  secondaryAction?: React.ReactNode
  /** Link to the documentation page that explains the concept. */
  docsHref?: string
  /** Label of the documentation link. Defaults to "Comprendre". */
  docsLabel?: string
  /** Dashed outline, for an empty state that stands alone on a page. */
  bordered?: boolean
  className?: string
}

/**
 * Empty state: says what is missing and what to do next, left aligned and
 * compact (no hero, no illustration). Use inside a Card, or `bordered` when
 * it stands alone on a page. Inside tables, prefer `TableEmpty`.
 */
export function EmptyState({
  icon: Icon,
  tone = 'default',
  title,
  description,
  action,
  secondaryAction,
  docsHref,
  docsLabel = 'Comprendre',
  bordered = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-start gap-3 py-8',
        bordered && 'rounded-lg border border-dashed px-6',
        className,
      )}
    >
      {Icon ? (
        <div
          aria-hidden
          className={cn(
            'bg-background flex size-8 items-center justify-center rounded-md border',
            tone === 'success' ? 'text-success' : 'text-muted-foreground',
          )}
        >
          <Icon className="size-4" />
        </div>
      ) : null}
      <div className="max-w-prose space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {action || secondaryAction || docsHref ? (
        <div className="flex flex-wrap items-center gap-2">
          {action}
          {secondaryAction}
          {docsHref ? (
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              className="text-link pointer-coarse:min-h-11 inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
            >
              {docsLabel}
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
