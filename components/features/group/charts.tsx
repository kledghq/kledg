'use client'

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { formatAmount, formatDisplayDate } from '@/components/shared'
import { compactEuros } from '@/components/features/accounting/chart-format'

/**
 * Charts of the group space. Colours by meaning only, the user's Apparence
 * choice (lib/appearance/palette.ts): produits, charges, trésorerie, solde.
 * Companies are never told apart by colour: a selector shows one company
 * or the group, so the chart reads the same with any palette.
 */

function TooltipRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex w-full items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-medium">{formatAmount(value)}</span>
    </div>
  )
}

const monthLabel = (month: string) => formatDisplayDate(`${month}-01`, 'month')

const treasuryConfig = { total: { label: 'Trésorerie', color: 'var(--chart-treasury)' } } satisfies ChartConfig

/** Cash (512) at the end of each month, in cents. */
export function TreasuryLineChart({ points, label = 'Trésorerie' }: { points: ReadonlyArray<{ month: string; cents: number }>; label?: string }) {
  const data = points.map((p) => ({ month: monthLabel(p.month), total: p.cents / 100 }))
  return (
    <ChartContainer config={treasuryConfig} className="aspect-auto h-64 w-full">
      <LineChart data={data} accessibilityLayer margin={{ left: 0, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} tickFormatter={(v) => compactEuros(Number(v))} />
        <ChartTooltip content={<ChartTooltipContent formatter={(value) => <TooltipRow label={label} value={Number(value)} />} />} />
        <Line dataKey="total" type="linear" stroke="var(--color-total)" strokeWidth={2} dot={{ r: 2 }} />
      </LineChart>
    </ChartContainer>
  )
}

const monthlyConfig = {
  produits: { label: 'Produits', color: 'var(--chart-revenue)' },
  charges: { label: 'Charges', color: 'var(--chart-expenses)' },
} satisfies ChartConfig

/** Produits and charges of each month, in cents. */
export function ProduitsChargesBars({ months }: { months: ReadonlyArray<{ month: string; produitsCents: number; chargesCents: number }> }) {
  const data = months.map((m) => ({ month: monthLabel(m.month), produits: m.produitsCents / 100, charges: m.chargesCents / 100 }))
  return (
    <ChartContainer config={monthlyConfig} className="aspect-auto h-64 w-full">
      <BarChart data={data} barGap={2} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} tickFormatter={(v) => compactEuros(Number(v))} />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
          content={<ChartTooltipContent formatter={(value, name) => <TooltipRow label={monthlyConfig[name as keyof typeof monthlyConfig]?.label ?? String(name)} value={Number(value)} />} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="produits" fill="var(--color-produits)" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="charges" fill="var(--color-charges)" radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  )
}

const compareConfig = {
  current: { label: 'Exercice N', color: 'var(--chart-revenue)' },
  previous: { label: 'Exercice N-1', color: 'var(--chart-expenses)' },
} satisfies ChartConfig

/** One figure per company, N against N-1, in cents (null: no fiscal year). */
export function CompareBars({ rows }: { rows: ReadonlyArray<{ name: string; current: number | null; previous: number | null }> }) {
  const data = rows.map((r) => ({ name: r.name, current: r.current === null ? null : r.current / 100, previous: r.previous === null ? null : r.previous / 100 }))
  return (
    <ChartContainer config={compareConfig} className="aspect-auto h-64 w-full">
      <BarChart data={data} barGap={2} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} interval={0} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} tickFormatter={(v) => compactEuros(Number(v))} />
        <ChartTooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
          content={<ChartTooltipContent formatter={(value, name) => <TooltipRow label={compareConfig[name as keyof typeof compareConfig]?.label ?? String(name)} value={Number(value)} />} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="current" fill="var(--color-current)" radius={[3, 3, 0, 0]} maxBarSize={36} />
        <Bar dataKey="previous" fill="var(--color-previous)" radius={[3, 3, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ChartContainer>
  )
}
