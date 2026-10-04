import { cn } from '@/lib/utils'

type DateValue = Date | string | null | undefined

export type DateDisplayFormat = 'short' | 'long' | 'month' | 'datetime'

const OPTIONS: Record<DateDisplayFormat, Intl.DateTimeFormatOptions> = {
  // 03/10/2026: tables, lists, forms
  short: { day: '2-digit', month: '2-digit', year: 'numeric' },
  // 3 octobre 2026: sentences, headers, dialogs
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  // oct. 2026: chart axes, periods
  month: { month: 'short', year: 'numeric' },
  // 03/10/2026 14:05: audit trails, imports, syncs
  datetime: { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
}

function toDate(value: DateValue): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * French date formatting used everywhere in the UI. Accounting dates are
 * stored as calendar days at midnight UTC, so date-only formats are rendered
 * in UTC (no off-by-one day in other time zones); "datetime" uses local time.
 */
export function formatDisplayDate(value: DateValue, format: DateDisplayFormat = 'short'): string {
  const d = toDate(value)
  if (!d) return ''
  return d.toLocaleString('fr-FR', {
    ...OPTIONS[format],
    ...(format === 'datetime' ? {} : { timeZone: 'UTC' }),
  })
}

interface DateDisplayProps {
  value: DateValue
  format?: DateDisplayFormat
  /** Rendered when the value is missing. Defaults to a muted "Non renseignée". */
  empty?: React.ReactNode
  className?: string
}

/** A date in a `<time>` element with the ISO value for machines and a French label for people. */
export function DateDisplay({ value, format = 'short', empty, className }: DateDisplayProps) {
  const d = toDate(value)
  if (!d) {
    return <span className={cn('text-muted-foreground', className)}>{empty ?? 'Non renseignée'}</span>
  }
  return (
    <time
      dateTime={format === 'datetime' ? d.toISOString() : d.toISOString().slice(0, 10)}
      className={cn('num whitespace-nowrap', className)}
    >
      {formatDisplayDate(d, format)}
    </time>
  )
}
