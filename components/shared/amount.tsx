import { cn } from '@/lib/utils'

type AmountValue = number | string | null | undefined

export interface FormatAmountOptions {
  /** Appends the euro sign ("1 234,56 €"). Defaults to true. */
  currency?: boolean
  /** "always" prefixes positive amounts with "+". Defaults to "auto" (minus only). */
  sign?: 'auto' | 'always'
  /** Fraction digits. Defaults to 2. */
  decimals?: number
}

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: boolean, decimals: number): Intl.NumberFormat {
  const key = `${currency}:${decimals}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', {
      ...(currency ? { style: 'currency', currency: 'EUR' } : {}),
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    formatters.set(key, f)
  }
  return f
}

function toNumber(value: AmountValue): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * French amount formatting used everywhere in the UI: "1 234,56 €",
 * narrow no-break space as thousands separator, comma decimals.
 * Returns an empty string for missing values.
 */
export function formatAmount(value: AmountValue, options: FormatAmountOptions = {}): string {
  const n = toNumber(value)
  if (n === null) return ''
  const { currency = true, sign = 'auto', decimals = 2 } = options
  // Avoid "-0,00 €" for values that round to zero.
  const rounded = Math.abs(n) < 0.5 / 10 ** decimals ? 0 : n
  const text = formatter(currency, decimals).format(rounded)
  return sign === 'always' && rounded > 0 ? `+${text}` : text
}

const percentFormatter = new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 2 })

/**
 * French percentage of a value given in percent (33.33 for 33,33 %):
 * comma decimals, no trailing zeros, no-break space before "%" ("100 %",
 * "33,33 %"). Returns an empty string for missing values.
 */
export function formatPercent(value: AmountValue): string {
  const n = toNumber(value)
  if (n === null) return ''
  return percentFormatter.format(n / 100)
}

interface AmountProps extends FormatAmountOptions {
  value: AmountValue
  /**
   * "signed" colors positive amounts with the success token and negative ones
   * with the destructive token (results, variations). Defaults to "none":
   * plain amounts in tables stay neutral.
   */
  tone?: 'none' | 'signed'
  /** Rendered when the value is missing. Defaults to a muted "Non renseigné". */
  empty?: React.ReactNode
  className?: string
}

/**
 * Displays an amount with tabular figures, never wrapping. Use it for every
 * amount in tables, cards and dialogs so they align and read the same.
 */
export function Amount({ value, tone = 'none', empty, className, ...options }: AmountProps) {
  const n = toNumber(value)
  if (n === null) {
    return (
      <span className={cn('text-muted-foreground', className)}>
        {empty ?? 'Non renseigné'}
      </span>
    )
  }
  return (
    <span
      data-slot="amount"
      className={cn(
        'num whitespace-nowrap',
        tone === 'signed' && n > 0 && 'text-success',
        tone === 'signed' && n < 0 && 'text-destructive',
        className,
      )}
    >
      {formatAmount(n, options)}
    </span>
  )
}
