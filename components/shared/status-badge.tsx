import { cn } from '@/lib/utils'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const DOT: Record<StatusTone, string> = {
  neutral: 'bg-muted-foreground/60',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
}

interface StatusBadgeProps {
  tone?: StatusTone
  children: React.ReactNode
  className?: string
  /** Extra explanation shown on hover. */
  title?: string
}

/**
 * Status of a record (exercice ouvert, clôturé, brouillon, validée...): a
 * hairline pill with a colored dot. The label carries the meaning, the dot
 * only reinforces it, so the status stays readable without color.
 */
export function StatusBadge({ tone = 'neutral', children, className, title }: StatusBadgeProps) {
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      title={title}
      className={cn(
        'bg-background inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap',
        className,
      )}
    >
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  )
}
