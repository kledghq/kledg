'use client'

import { Amount, formatAmount } from '@/components/shared'

/** From ten million euros, a tile shows "12,3 M€": the full amount stays in the title and for screen readers. */
const COMPACT_FROM = 10_000_000

const compact = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** KPI amount in euros: the full amount, or a compact one for very large values, never cut off. */
export function KpiAmount({ value }: { value: number }) {
  if (Math.abs(value) < COMPACT_FROM) return <Amount value={value} />
  const full = formatAmount(value)
  return (
    <span className="num whitespace-nowrap" title={full}>
      <span aria-hidden>{compact.format(value)}</span>
      <span className="sr-only">{full}</span>
    </span>
  )
}

/** Same, from integer cents (what the dashboard API returns). */
export function KpiCents({ cents }: { cents: number }) {
  return <KpiAmount value={cents / 100} />
}
