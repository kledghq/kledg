'use client'

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { BarChart3, LineChart as LineChartIcon } from 'lucide-react'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Amount, EmptyState, HelpTip, formatAmount, formatDisplayDate, formatPercent } from '@/components/shared'
import { compactEuros } from '@/components/features/accounting/chart-format'
import { docsUrl } from '@/lib/docs-links'
import { useWidgetSource } from '../dashboard-data'
import { ChartSkeleton, ListSkeleton, WidgetError, WidgetFrame } from '../widget-frame'
import type { WidgetProps } from './types'

function TooltipRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex w-full items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-medium">{formatAmount(value)}</span>
    </div>
  )
}

const fiscalYearLabel = (fy: { year: number } | null | undefined) => (fy ? `Exercice ${fy.year}, mois par mois` : undefined)

// Colours by meaning, chosen by the user (Apparence settings, lib/appearance).
// By default one accent (produits) against a neutral gray (charges): no red/green pair.
const monthlyConfig = {
  revenue: { label: 'Produits', color: 'var(--chart-revenue)' },
  expenses: { label: 'Charges', color: 'var(--chart-expenses)' },
} satisfies ChartConfig

export function ProduitsChargesChart({ widget }: WidgetProps) {
  const { state, retry } = useWidgetSource('monthly')
  const data = state.status === 'ready' ? state.data : null
  const months = data?.months ?? []
  const empty = months.every((m) => !m.revenue && !m.expenses)
  return (
    <WidgetFrame title={widget.title} description={fiscalYearLabel(data?.fiscalYear)} busy={state.status === 'loading'} contentClassName="px-2 sm:px-5">
      {state.status === 'loading' ? (
        <ChartSkeleton />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !data?.fiscalYear ? (
        <EmptyState icon={BarChart3} title="Aucun exercice" className="px-3 sm:px-0" />
      ) : empty ? (
        <EmptyState
          icon={BarChart3}
          title="Aucun produit ni charge sur l'exercice"
          description="Le graphique se remplit à mesure que vous validez des écritures de ventes et d'achats."
          className="px-3 sm:px-0"
        />
      ) : (
        <ChartContainer config={monthlyConfig} className="aspect-auto h-64 w-full">
          <BarChart data={months} barGap={2} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} tickFormatter={(v) => compactEuros(Number(v))} />
            <ChartTooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <TooltipRow label={monthlyConfig[name as keyof typeof monthlyConfig]?.label ?? String(name)} value={Number(value)} />
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[3, 3, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ChartContainer>
      )}
    </WidgetFrame>
  )
}

const treasuryConfig = { balance: { label: 'Solde 512', color: 'var(--chart-treasury)' } } satisfies ChartConfig

export function TresorerieChart({ widget }: WidgetProps) {
  const { state, retry } = useWidgetSource('treasury')
  const data = state.status === 'ready' ? state.data : null
  const points = (data?.points ?? []).map((p) => ({
    month: formatDisplayDate(`${p.month}-01`, 'month'),
    balance: p.balanceCents / 100,
  }))
  const last = data?.points?.at(-1)
  const empty = !data?.points?.length || (data.openingCents === 0 && data.points.every((p) => p.balanceCents === 0))
  return (
    <WidgetFrame
      title={widget.title}
      description={data?.fiscalYear ? `Solde des comptes 512 en fin de mois, exercice ${data.fiscalYear.year}` : undefined}
      help={
        <HelpTip term="Trésorerie dans le temps" docsHref={docsUrl('bankReconciliation')}>
          Solde en comptabilité des comptes bancaires (512) à la fin de chaque mois, à-nouveaux compris. Il suit
          votre banque une fois les transactions rapprochées.
        </HelpTip>
      }
      action={
        last && !empty ? (
          <div className="text-right">
            <div className="text-muted-foreground text-xs">Fin {formatDisplayDate(`${last.month}-01`, 'month')}</div>
            <Amount value={last.balanceCents / 100} className="text-lg font-semibold" />
          </div>
        ) : null
      }
      busy={state.status === 'loading'}
      contentClassName="px-2 sm:px-5"
    >
      {state.status === 'loading' ? (
        <ChartSkeleton />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !data?.fiscalYear ? (
        <EmptyState icon={LineChartIcon} title="Aucun exercice" className="px-3 sm:px-0" />
      ) : empty ? (
        <EmptyState
          icon={LineChartIcon}
          title="Aucune écriture sur les comptes bancaires"
          description="Rapprochez vos transactions ou saisissez vos à-nouveaux pour suivre votre trésorerie."
          className="px-3 sm:px-0"
        />
      ) : (
        <ChartContainer config={treasuryConfig} className="aspect-auto h-64 w-full">
          <LineChart data={points} accessibilityLayer margin={{ left: 0, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} width={56} tickFormatter={(v) => compactEuros(Number(v))} />
            <ChartTooltip
              content={<ChartTooltipContent formatter={(value) => <TooltipRow label="Solde 512" value={Number(value)} />} />}
            />
            <Line dataKey="balance" type="linear" stroke="var(--color-balance)" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ChartContainer>
      )}
    </WidgetFrame>
  )
}

/** Charges by post (60 to 65) as horizontal bars, each with its amount and share; readable without the bars. */
export function RepartitionChargesChart({ widget }: WidgetProps) {
  const { state, retry } = useWidgetSource('ledger')
  const data = state.status === 'ready' ? state.data : null
  const summary = data?.summary
  const total = summary?.chargesCents ?? 0
  const max = Math.max(1, ...(summary?.chargesParPoste.map((p) => p.cents) ?? [0]))
  return (
    <WidgetFrame
      title={widget.title}
      description={data?.fiscalYear ? `Charges de l'exercice ${data.fiscalYear.year} par poste` : undefined}
      action={summary && total ? <Amount value={total / 100} className="text-lg font-semibold" /> : null}
      busy={state.status === 'loading'}
    >
      {state.status === 'loading' ? (
        <ListSkeleton rows={6} />
      ) : state.status === 'error' ? (
        <WidgetError message={state.message} onRetry={retry} />
      ) : !summary ? (
        <EmptyState icon={BarChart3} title="Aucun exercice" />
      ) : total === 0 ? (
        <EmptyState icon={BarChart3} title="Aucune charge sur l'exercice" description="Les postes apparaissent dès la première écriture d'achat validée." />
      ) : (
        <ul className="space-y-3">
          {summary.chargesParPoste.map((post) => (
            <li key={post.code} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="text-muted-foreground mr-1.5 font-mono text-xs">{post.code}</span>
                  {post.label}
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-muted-foreground num text-xs">{formatPercent(Math.round((post.cents / total) * 1000) / 10)}</span>
                  <Amount value={post.cents / 100} />
                </span>
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                <div className="bg-chart-breakdown h-full rounded-full" style={{ width: `${Math.max(0, (post.cents / max) * 100)}%` }} />
              </div>
            </li>
          ))}
          {summary.autresChargesCents !== 0 ? (
            <li className="text-muted-foreground flex items-baseline justify-between gap-3 border-t pt-3 text-sm">
              <span>Autres charges (66 à 69)</span>
              <Amount value={summary.autresChargesCents / 100} />
            </li>
          ) : null}
        </ul>
      )}
    </WidgetFrame>
  )
}
