import type { LucideIcon } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  /** Main statistic. Pass an `<Amount>` or a pre-formatted value. */
  value: React.ReactNode
  /** Optional supporting text rendered under the value (period, comparison). */
  hint?: React.ReactNode
  /** Optional icon rendered next to the label. */
  icon?: LucideIcon
  /** Classes appended to the icon. Prefer semantic tokens (text-success). */
  iconClassName?: string
  /** Classes appended to the value. Prefer semantic tokens (text-destructive). */
  valueClassName?: string
  /** Optional element aligned right of the label (badge, info tip). */
  aside?: React.ReactNode
  /** Renders the label as a heading (dashboard widgets: one h2 per widget). Defaults to a plain span. */
  labelAs?: 'span' | 'h2' | 'h3'
  /** Marks the tile as loading (aria-busy). */
  busy?: boolean
  /** Optional content rendered after the hint (e.g. a secondary line). */
  children?: React.ReactNode
  className?: string
}

/**
 * Small KPI tile: muted label, large tabular value, one line of context.
 * Monochrome by default; color only carries meaning (negative result, overdue).
 * The value is never truncated: its size follows the width of the card.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  iconClassName,
  valueClassName,
  aside,
  labelAs: Label = 'span',
  busy,
  children,
  className,
}: StatCardProps) {
  return (
    // A size container: the value shrinks with the card instead of being cut off
    <Card data-slot="stat-card" aria-busy={busy || undefined} className={cn('@container min-w-0 gap-2 px-5', className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-sm">
          {Icon ? <Icon aria-hidden className={cn('size-4 shrink-0', iconClassName)} /> : null}
          <Label className="truncate text-sm font-normal">{label}</Label>
        </span>
        {aside}
      </div>
      <div className={cn('num text-xl font-semibold tracking-tight @[15rem]:text-2xl', valueClassName)}>
        {value}
      </div>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      {children}
    </Card>
  )
}
