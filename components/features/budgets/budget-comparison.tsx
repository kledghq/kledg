'use client'

import * as React from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, HelpTip, formatDisplayDate, formatPercent } from '@/components/shared'
import { cn } from '@/lib/utils'
import { SIDE_LABELS, type BudgetSide } from '@/lib/budgets/prefixes'
import type { BudgetReport } from '@/lib/budgets/get-budget-report.service'
import type { Comparison, MonthComparison, ReportRow, ReportSection } from '@/lib/budgets/report'

const monthLabel = (month: string) => formatDisplayDate(`${month}-01`, 'month')

/** Variance in euros and percent; colored only when it says something (unfavorable in red, favorable in green). */
function Variance({ value, percent = false }: { value: Comparison; percent?: boolean }) {
  const tone = value.varianceCents === 0 ? undefined : value.favorable ? 'text-success' : 'text-destructive'
  if (percent) {
    return <span className={cn('num', tone)}>{value.variancePercent === null ? '-' : formatPercent(value.variancePercent)}</span>
  }
  return <Amount value={value.varianceCents / 100} sign="always" className={tone} />
}

function RowCells({ row, strong = false }: { row: Comparison & { annualBudgetCents: number }; strong?: boolean }) {
  const weight = strong ? 'font-semibold' : undefined
  return (
    <>
      <TableCell numeric className={weight}>
        <Amount value={row.budgetCents / 100} />
      </TableCell>
      <TableCell numeric className={weight}>
        <Amount value={row.actualCents / 100} />
      </TableCell>
      <TableCell numeric className={weight}>
        <Variance value={row} />
      </TableCell>
      <TableCell numeric className={weight}>
        <Variance value={row} percent />
      </TableCell>
    </>
  )
}

/** One line on phones: label, then budget, actual and variance in a small grid. */
function StackedRow({ row, unbudgeted = false }: { row: ReportRow; unbudgeted?: boolean }) {
  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm">{row.label}</p>
          <p className="text-muted-foreground font-mono text-xs">
            {row.accountPrefix}
            {unbudgeted ? <span className="font-sans"> · hors budget</span> : null}
          </p>
        </div>
        <Amount value={row.actualCents / 100} className="font-semibold" />
      </div>
      <dl className="text-muted-foreground grid grid-cols-3 gap-x-3 text-xs">
        <div>
          <dt>Budget</dt>
          <dd className="text-foreground">
            <Amount value={row.budgetCents / 100} />
          </dd>
        </div>
        <div>
          <dt>Écart</dt>
          <dd>
            <Variance value={row} />
          </dd>
        </div>
        <div>
          <dt>Écart %</dt>
          <dd>
            <Variance value={row} percent />
          </dd>
        </div>
      </dl>
    </li>
  )
}

function SectionCard({ section }: { section: ReportSection }) {
  const title = SIDE_LABELS[section.side]
  const empty = section.lines.length === 0 && section.unbudgeted.length === 0
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {section.side === 'charges'
            ? 'Comptes de classe 6, au débit. Un écart positif est une dépense au-dessus du budget.'
            : 'Comptes de classe 7, au crédit. Un écart positif est un produit au-dessus du budget.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-muted-foreground text-sm">Aucune ligne de budget ni aucun mouvement sur ces comptes.</p>
        ) : (
          <>
            <ul className="divide-y rounded-md border lg:hidden" aria-label={`Budget et réalisé, ${title.toLowerCase()}`}>
              {section.lines.map((row) => (
                <StackedRow key={row.lineId} row={row} />
              ))}
              {section.unbudgeted.map((row) => (
                <StackedRow key={`hors-${row.accountPrefix}`} row={row} unbudgeted />
              ))}
              <li className="bg-muted/50 flex justify-between gap-3 px-3 py-2.5 text-sm font-semibold">
                <span>Total {title.toLowerCase()}</span>
                <span className="flex flex-col items-end gap-0.5">
                  <Amount value={section.total.actualCents / 100} />
                  <span className="text-xs font-normal">
                    Budget <Amount value={section.total.budgetCents / 100} />
                  </span>
                </span>
              </li>
            </ul>
            <div className="hidden rounded-md border lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Compte</TableHead>
                    <TableHead>Libellé</TableHead>
                    <TableHead numeric>Budget</TableHead>
                    <TableHead numeric>Réel</TableHead>
                    <TableHead numeric>Écart</TableHead>
                    <TableHead numeric>Écart %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.lines.map((row) => (
                    <TableRow key={row.lineId}>
                      <TableCell className="font-mono text-xs">{row.accountPrefix}</TableCell>
                      <TableCell className="max-w-72">
                        <span className="block truncate" title={row.accounts.map((a) => `${a.code} ${a.label}`).join(', ') || undefined}>
                          {row.label}
                        </span>
                        {row.accounts.length === 0 ? <span className="text-muted-foreground text-xs">Aucun mouvement sur ces comptes</span> : null}
                      </TableCell>
                      <RowCells row={row} />
                    </TableRow>
                  ))}
                  {section.unbudgeted.length > 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="text-muted-foreground pt-4 text-xs font-medium">
                        Hors budget&nbsp;: comptes qu&apos;aucune ligne ne couvre
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {section.unbudgeted.map((row) => (
                    <TableRow key={`hors-${row.accountPrefix}`}>
                      <TableCell className="font-mono text-xs">{row.accountPrefix}</TableCell>
                      <TableCell className="max-w-72">
                        <span className="block truncate">{row.label}</span>
                      </TableCell>
                      <RowCells row={row} />
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 border-t-foreground border-t-2">
                    <TableCell colSpan={2} className="font-semibold">
                      Total {title.toLowerCase()}
                    </TableCell>
                    <RowCells row={section.total} strong />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

type MonthlySource = { key: string; label: string; months: MonthComparison[]; side: BudgetSide | 'resultat' }

/** Budget, actual and variance month by month for the résultat, a side or one line: one row per month, readable on a phone. */
function MonthlyCard({ report }: { report: BudgetReport }) {
  const sources: MonthlySource[] = [
    { key: 'resultat', label: 'Résultat', months: report.resultat.months, side: 'resultat' },
    { key: 'charges', label: 'Total charges', months: report.charges.total.months, side: 'charges' },
    { key: 'produits', label: 'Total produits', months: report.produits.total.months, side: 'produits' },
    ...[...report.charges.lines, ...report.produits.lines].map((row) => ({
      key: row.lineId as string,
      label: `${row.accountPrefix} ${row.label}`,
      months: row.months,
      side: (row.accountPrefix.startsWith('6') ? 'charges' : 'produits') as BudgetSide,
    })),
  ]
  const [key, setKey] = React.useState('resultat')
  const source = sources.find((s) => s.key === key) ?? sources[0]
  const through = report.months.indexOf(report.throughMonth)
  const favorable = (variance: number) => (source.side === 'charges' ? variance <= 0 : variance >= 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mois par mois</CardTitle>
        <CardDescription>Le budget et le réalisé de chaque mois de l&apos;exercice, d&apos;après la date des écritures.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm space-y-2">
          <Label htmlFor="budget-monthly-source">Afficher</Label>
          <Select value={source.key} onValueChange={setKey}>
            <SelectTrigger id="budget-monthly-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Totaux</SelectLabel>
                {sources.slice(0, 3).map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              {sources.length > 3 ? (
                <SelectGroup>
                  <SelectLabel>Lignes</SelectLabel>
                  {sources.slice(3).map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mois</TableHead>
                <TableHead numeric>Budget</TableHead>
                <TableHead numeric>Réel</TableHead>
                <TableHead numeric>Écart</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {source.months.map((m, i) => {
                const counted = i <= through
                const tone = !counted || m.varianceCents === 0 ? undefined : favorable(m.varianceCents) ? 'text-success' : 'text-destructive'
                return (
                  <TableRow key={m.month} className={counted ? undefined : 'text-muted-foreground'}>
                    <TableCell>
                      {monthLabel(m.month)}
                      {!counted ? <span className="sr-only"> (après la période comparée)</span> : null}
                    </TableCell>
                    <TableCell numeric>
                      <Amount value={m.budgetCents / 100} />
                    </TableCell>
                    <TableCell numeric>
                      <Amount value={m.actualCents / 100} />
                    </TableCell>
                    <TableCell numeric>
                      <Amount value={m.varianceCents / 100} sign="always" className={tone} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

/** Budget against the books: the résultat first, then charges and produits per line, then month by month. */
export function BudgetComparison({ report }: { report: BudgetReport }) {
  const { resultat } = report
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            Résultat
            <HelpTip term="Résultat">
              Produits moins charges des écritures validées de l&apos;exercice, sans l&apos;écriture de clôture&nbsp;: le résultat du compte de
              résultat. Le budget du résultat est le budget des produits moins celui des charges.
            </HelpTip>
          </CardTitle>
          <CardDescription>
            Jusqu&apos;à fin {monthLabel(report.throughMonth)}. Budget de l&apos;exercice entier&nbsp;: <Amount value={resultat.annualBudgetCents / 100} />.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <dt className="text-muted-foreground text-sm">Budget</dt>
              <dd className="num text-xl font-semibold">
                <Amount value={resultat.budgetCents / 100} />
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground text-sm">Réel</dt>
              <dd className="num text-xl font-semibold">
                <Amount value={resultat.actualCents / 100} tone="signed" />
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-muted-foreground text-sm">Écart</dt>
              <dd className="flex items-baseline gap-2 text-xl font-semibold">
                <Variance value={resultat} />
                {resultat.variancePercent !== null ? (
                  <Badge variant={resultat.favorable ? 'success' : 'warning'}>{formatPercent(resultat.variancePercent)}</Badge>
                ) : null}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <SectionCard section={report.charges} />
      <SectionCard section={report.produits} />
      <MonthlyCard report={report} />
    </div>
  )
}
