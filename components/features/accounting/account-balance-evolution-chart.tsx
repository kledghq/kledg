'use client'

import { Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts'

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Amount, formatAmount } from '@/components/shared'
import { compactEuros } from './chart-format'

export interface AccountBalanceEvolutionData {
  /** Month label from the API, already in French ("oct. 2026"). */
  month: string
  debit: number
  credit: number
  cumulative: number
}

interface AccountBalanceEvolutionChartProps {
  data: AccountBalanceEvolutionData[]
}

// Colours by meaning, chosen by the user (Apparence settings, lib/appearance).
// By default the dashboard pair, green accent against the neutral gray, and
// the balance as an ink line. Debit and credit are sides, not good or bad news.
const chartConfig = {
  debit: { label: 'Débit', color: 'var(--chart-debit)' },
  credit: { label: 'Crédit', color: 'var(--chart-credit)' },
  cumulative: { label: 'Solde cumulé', color: 'var(--chart-balance)' },
} satisfies ChartConfig

/** Monthly debits and credits of an account with its cumulative balance (debit minus credit). */
export function AccountBalanceEvolutionChart({ data }: AccountBalanceEvolutionChartProps) {
  if (!data.length) {
    return null
  }

  const currentBalance = data[data.length - 1]?.cumulative ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Évolution du solde</CardTitle>
        <CardDescription>Débits, crédits et solde cumulé par mois sur l&apos;exercice du compte.</CardDescription>
        <CardAction className="text-right">
          <div className="text-muted-foreground text-xs">Solde fin de période</div>
          <Amount value={currentBalance} className="text-lg font-semibold" />
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 sm:px-5">
        <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
          <ComposedChart data={data} barGap={2} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              width={56}
              tickFormatter={(value) => compactEuros(Number(value))}
            />
            <ChartTooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-4">
                      <span className="text-muted-foreground">
                        {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                      </span>
                      <span className="num font-medium">{formatAmount(Number(value))}</span>
                    </div>
                  )}
                />
              }
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="debit" fill="var(--color-debit)" radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Bar dataKey="credit" fill="var(--color-credit)" radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Line dataKey="cumulative" type="linear" stroke="var(--color-cumulative)" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
