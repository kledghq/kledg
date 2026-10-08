'use client'

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts'

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { formatAmount } from '@/components/shared'
import { compactEuros } from '@/components/features/accounting/chart-format'
import type { Projection } from '@/lib/cash-forecast/projection'
import { dateInWords } from '@/lib/simple/vocabulary'
import { periodLabel, periodShortLabel, type ForecastMode } from '@/lib/cash-forecast/wording'
import { formatCents } from './cash-forecast-alert'

// Colours by meaning (app/globals.css, light and .dark): money in, money out, the balance, the threshold.
const LABELS: Record<ForecastMode, { inflows: string; outflows: string; closing: string; lowest: string }> = {
  expert: { inflows: 'Encaissements', outflows: 'Décaissements', closing: 'Solde de fin', lowest: 'Solde le plus bas' },
  simple: { inflows: 'Argent qui arrive', outflows: 'Argent qui part', closing: 'Sur le compte en fin de période', lowest: 'Au plus bas' },
}

function configOf(mode: ForecastMode) {
  const labels = LABELS[mode]
  return {
    inflows: { label: labels.inflows, color: 'var(--chart-revenue)' },
    outflows: { label: labels.outflows, color: 'var(--chart-expenses)' },
    closing: { label: labels.closing, color: 'var(--chart-treasury)' },
    lowest: { label: labels.lowest, color: 'var(--chart-balance)' },
  } satisfies ChartConfig
}

/** The curve in words, for screen readers (the table below gives every figure). */
function chartSummary(projection: Projection, mode: ForecastMode): string {
  const last = projection.periods.at(-1)
  const parts = [
    mode === 'simple'
      ? `Aujourd’hui ${formatCents(projection.openingCents)} sur le compte, ${formatCents(projection.closingCents)} prévus à la fin`
      : `Solde de départ ${formatCents(projection.openingCents)}, solde projeté ${formatCents(projection.closingCents)} à la fin`,
    last ? `de ${periodLabel(last, projection.granularity).toLowerCase()}` : '',
  ]
  const lowest = `${mode === 'simple' ? 'au plus bas' : 'point le plus bas'} ${formatCents(projection.lowest.cents)}`
  const threshold =
    projection.thresholdCents === null
      ? ''
      : `, ${mode === 'simple' ? 'minimum voulu' : 'seuil'} ${formatCents(projection.thresholdCents)}${projection.firstBelow ? `, franchi le ${dateInWords(projection.firstBelow.day)}` : ', jamais franchi'}`
  return `${parts.filter(Boolean).join(' ')}, ${lowest}${threshold}.`
}

/**
 * Bars of what comes in and goes out per period, the closing and lowest
 * balance as lines, and the threshold as a horizontal line. Euros on the
 * chart, cents everywhere else.
 */
export function CashForecastChart({ projection, mode }: { projection: Projection; mode: ForecastMode }) {
  const config = configOf(mode)
  const data = projection.periods.map((p) => ({
    period: periodShortLabel(p, projection.granularity),
    full: periodLabel(p, projection.granularity),
    inflows: p.inflowsCents / 100,
    outflows: p.outflowsCents / 100,
    closing: p.closingCents / 100,
    lowest: p.lowestCents / 100,
  }))
  const crossing = projection.firstBelow?.period ? projection.periods.find((p) => p.period === projection.firstBelow?.period) : undefined
  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full" role="img" aria-label={chartSummary(projection, mode)}>
      <ComposedChart data={data} barGap={2} margin={{ left: 0, right: 8, top: 8 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={60} tickFormatter={(v) => compactEuros(Number(v))} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? ''}
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-4">
                  <span className="text-muted-foreground">{config[name as keyof typeof config]?.label ?? String(name)}</span>
                  <span className="num font-medium">{formatAmount(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {projection.thresholdCents !== null ? (
          <ReferenceLine
            y={projection.thresholdCents / 100}
            stroke="var(--destructive)"
            strokeDasharray="6 4"
            ifOverflow="extendDomain"
            label={{ value: mode === 'simple' ? 'Minimum voulu' : 'Seuil', position: 'insideTopLeft', fill: 'var(--destructive)', fontSize: 12 }}
          />
        ) : null}
        {crossing ? <ReferenceLine x={periodShortLabel(crossing, projection.granularity)} stroke="var(--destructive)" strokeOpacity={0.5} /> : null}
        <ReferenceLine y={0} stroke="var(--border)" />
        <Bar dataKey="inflows" fill="var(--color-inflows)" radius={[3, 3, 0, 0]} maxBarSize={24} />
        <Bar dataKey="outflows" fill="var(--color-outflows)" radius={[0, 0, 3, 3]} maxBarSize={24} />
        <Line dataKey="closing" type="linear" stroke="var(--color-closing)" strokeWidth={2} dot={{ r: 2 }} />
        <Line dataKey="lowest" type="linear" stroke="var(--color-lowest)" strokeWidth={1} strokeDasharray="3 3" dot={false} />
      </ComposedChart>
    </ChartContainer>
  )
}
