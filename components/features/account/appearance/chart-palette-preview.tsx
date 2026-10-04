'use client'

import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, XAxis } from 'recharts'

import { ChartContainer, ChartLegend, ChartLegendContent, type ChartConfig } from '@/components/ui/chart'
import { CHART_SERIES, CHART_SERIES_INFO, chartSeriesVariable, type ChartColors } from '@/lib/appearance/palette'

// Sample figures: the shapes of the real charts, not the user's books.
const MONTHS = [
  { month: 'janv.', revenue: 42, expenses: 31, treasury: 18, balance: 6 },
  { month: 'févr.', revenue: 38, expenses: 35, treasury: 21, balance: 9 },
  { month: 'mars', revenue: 51, expenses: 33, treasury: 26, balance: 7 },
  { month: 'avr.', revenue: 47, expenses: 40, treasury: 24, balance: 12 },
  { month: 'mai', revenue: 56, expenses: 37, treasury: 31, balance: 10 },
  { month: 'juin', revenue: 60, expenses: 42, treasury: 35, balance: 14 },
]
const SIDES = [
  { side: 'debit', amount: 58, fill: 'var(--color-debit)' },
  { side: 'credit', amount: 42, fill: 'var(--color-credit)' },
]
const POSTS = [
  { code: '60', label: 'Achats', share: 100 },
  { code: '61', label: 'Services extérieurs', share: 64 },
  { code: '64', label: 'Charges de personnel', share: 41 },
]

const label = (series: keyof typeof CHART_SERIES_INFO) => CHART_SERIES_INFO[series].label

const barConfig = {
  revenue: { label: label('revenue'), color: 'var(--chart-revenue)' },
  expenses: { label: label('expenses'), color: 'var(--chart-expenses)' },
} satisfies ChartConfig
const lineConfig = {
  treasury: { label: label('treasury'), color: 'var(--chart-treasury)' },
  balance: { label: label('balance'), color: 'var(--chart-balance)' },
} satisfies ChartConfig
const pieConfig = {
  amount: { label: 'Montant' },
  debit: { label: label('debit'), color: 'var(--chart-debit)' },
  credit: { label: label('credit'), color: 'var(--chart-credit)' },
} satisfies ChartConfig

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="bg-card min-w-0 space-y-2 rounded-lg border p-3">
      <figcaption className="text-muted-foreground text-xs font-medium">{title}</figcaption>
      {children}
    </figure>
  )
}

/**
 * Sample bar, line and pie charts drawn with the real chart components, in
 * `colors`: the series variables are set on the preview only, so the rest
 * of the page keeps the saved colours until the user saves.
 */
export function ChartPalettePreview({ colors }: { colors: ChartColors }) {
  const style = Object.fromEntries(CHART_SERIES.map((series) => [chartSeriesVariable(series), colors[series]])) as React.CSSProperties
  return (
    <div data-testid="chart-palette-preview" style={style} className="grid gap-3 sm:grid-cols-2" aria-label="Aperçu des couleurs des graphiques" role="group">
      <Panel title="Produits et charges">
        <ChartContainer config={barConfig} className="aspect-auto h-40 w-full">
          <BarChart data={MONTHS} barGap={2} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={6} minTickGap={12} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
            <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[3, 3, 0, 0]} maxBarSize={16} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </Panel>
      <Panel title="Trésorerie et solde cumulé">
        <ChartContainer config={lineConfig} className="aspect-auto h-40 w-full">
          <LineChart data={MONTHS} accessibilityLayer margin={{ left: 4, right: 8, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={6} minTickGap={12} />
            <ChartLegend content={<ChartLegendContent />} />
            <Line dataKey="treasury" type="linear" stroke="var(--color-treasury)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
            <Line dataKey="balance" type="linear" stroke="var(--color-balance)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ChartContainer>
      </Panel>
      <Panel title="Débit et crédit">
        <ChartContainer config={pieConfig} className="aspect-auto h-40 w-full">
          <PieChart accessibilityLayer>
            <Pie data={SIDES} dataKey="amount" nameKey="side" innerRadius="45%" outerRadius="80%" strokeWidth={2} isAnimationActive={false} />
            <ChartLegend content={<ChartLegendContent nameKey="side" />} />
          </PieChart>
        </ChartContainer>
      </Panel>
      <Panel title={label('breakdown')}>
        <ul className="space-y-3 pt-1">
          {POSTS.map((post) => (
            <li key={post.code} className="space-y-1">
              <div className="flex items-baseline gap-1.5 text-xs">
                <span className="text-muted-foreground font-mono">{post.code}</span>
                <span className="min-w-0 truncate">{post.label}</span>
              </div>
              <div className="bg-muted h-1.5 overflow-hidden rounded-full" aria-hidden>
                <div className="bg-chart-breakdown h-full rounded-full" style={{ width: `${post.share}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
