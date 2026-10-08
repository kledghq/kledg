'use client'

import * as React from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { StatCard, formatPercent } from '@/components/shared'
import { cn } from '@/lib/utils'
import { INDICATOR_SECTIONS, type IndicatorRow } from '@/lib/reports/financial-indicators/rows'
import type { FinancialIndicators } from '@/lib/reports/financial-indicators/indicators'
import type { GroupIndicatorsReport } from '@/lib/group/get-group-indicators.service'
import { CompareBars } from './charts'
import { Cents, CompanyLink, ExportButtons, LoadError, Notice, PerimeterNotes, roleLabel, useGroupReport, useReportUrl, SectionIntro, useGroupSpace } from './space'

/** Chiffre d'affaires is a sum of SIG rows: shown as a row of its own here. */
const CHIFFRE_AFFAIRES: IndicatorRow = { id: 'chiffreAffaires', label: "Chiffre d'affaires", source: 'Comptes 70 (2052 FL)', kind: 'amount', value: (i) => i.sig.chiffreAffairesCents }
const ALL_ROWS = [CHIFFRE_AFFAIRES, ...INDICATOR_SECTIONS.flatMap((s) => s.rows)]
const rowById = (id: string) => ALL_ROWS.find((r) => r.id === id) as IndicatorRow

/** The indicators compared company by company: the main balances, results and structure. */
const COMPARED = ['chiffreAffaires', 'valeurAjoutee', 'ebe', 'resultatExploitation', 'resultatExercice', 'caf', 'bfr', 'tresorerieNette', 'dettesFinancieres', 'capitauxPropres', 'margeEbe', 'margeNette']
/** The ratios of the Ratios page, with the balance sheet amounts they come from. */
const RATIOS = ['margeEbe', 'margeNette', 'tauxMarge', 'tauxMarque', 'endettement', 'dso', 'dpo', 'bfr', 'tresorerieNette', 'dettesFinancieres', 'capitauxPropres', 'caf']
/** Amounts the comparison chart can show. */
const CHARTED = ['chiffreAffaires', 'valeurAjoutee', 'ebe', 'resultatExercice', 'caf', 'tresorerieNette', 'capitauxPropres'] as const

const chartValue = (id: (typeof CHARTED)[number], i: FinancialIndicators | null): number | null => (i ? rowById(id).value(i) : null)
const CHART_LABELS: Record<(typeof CHARTED)[number], string> = {
  chiffreAffaires: "Chiffre d'affaires",
  valeurAjoutee: 'Valeur ajoutée',
  ebe: "Excédent brut d'exploitation",
  resultatExercice: "Résultat de l'exercice",
  caf: "Capacité d'autofinancement",
  tresorerieNette: 'Trésorerie nette',
  capitauxPropres: 'Capitaux propres',
}

/** An indicator as shown: amount, percentage or days; "-" when it cannot be computed. */
function IndicatorValue({ row, indicators }: { row: IndicatorRow; indicators: FinancialIndicators | null }) {
  const value = indicators ? row.value(indicators) : null
  if (value === null) return <span className="text-muted-foreground">-</span>
  if (row.kind === 'percent') return <span className={cn('num', value < 0 && 'text-destructive')}>{formatPercent(Math.round(value * 1000) / 10)}</span>
  if (row.kind === 'days') return <span className="num">{value} j</span>
  return <Cents value={value} signed={row.kind === 'total'} />
}

/** The indicators, narrowed to the company of the Pilotage filter (the aggregate stays the group's). */
function useIndicators() {
  const report = useGroupReport<GroupIndicatorsReport>(useReportUrl('indicators'), "Les indicateurs du groupe ne se sont pas chargés. Réessayez dans un instant.")
  const { companyFilter } = useGroupSpace()
  const data = report.data && companyFilter ? { ...report.data, members: report.data.members.filter((m) => m.company.id === companyFilter) } : report.data
  return { ...report, data }
}

/** Comparaison of the group space: the companies side by side, N and N-1, and the aggregate. */
export function GroupComparisonSection() {
  const report = useIndicators()
  const data = report.data
  const [charted, setCharted] = React.useState<(typeof CHARTED)[number]>('chiffreAffaires')
  return (
    <div className="space-y-6">
      <SectionIntro
        description="Les sociétés du groupe côte à côte sur l'exercice et le précédent, avec les soldes intermédiaires de gestion et la structure du bilan."
        actions={<ExportButtons report="indicators" disabled={!data} />}
      />
      {report.error ? (
        <LoadError message={report.error} onRetry={report.retry} />
      ) : (
        <>
          {data ? <Notice>{data.notice}</Notice> : null}
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
          <Card aria-busy={report.loading || undefined}>
            <CardHeader className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1.5">
                <CardTitle>
                  <h2>{CHART_LABELS[charted]} par société</h2>
                </CardTitle>
                <CardDescription>Exercice N face à l&apos;exercice N-1.</CardDescription>
              </div>
              <div className="space-y-1">
                <Label htmlFor="compare-figure" className="sr-only">
                  Indicateur du graphique
                </Label>
                <Select value={charted} onValueChange={(v) => setCharted(v as (typeof CHARTED)[number])}>
                  <SelectTrigger id="compare-figure" size="sm" className="w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHARTED.map((id) => (
                      <SelectItem key={id} value={id}>
                        {CHART_LABELS[id]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="px-2 sm:px-5">
              {data ? (
                <CompareBars rows={data.members.map((m) => ({ name: m.company.name, current: chartValue(charted, m.current), previous: chartValue(charted, m.previous) }))} />
              ) : (
                <Skeleton className="h-64 w-full" />
              )}
            </CardContent>
          </Card>
          <Card aria-busy={report.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>Indicateurs par société</h2>
              </CardTitle>
              <CardDescription>Chaque société à 100 %, puis l&apos;agrégat du groupe (flux intragroupe non éliminés).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead rowSpan={2} className="min-w-52 align-bottom">
                        Indicateur
                      </TableHead>
                      {data?.members.map((m) => (
                        <TableHead key={m.company.id} colSpan={2} className="border-l text-center whitespace-normal">
                          <CompanyLink company={m.company} />
                          <span className="text-muted-foreground block text-xs font-normal">{roleLabel(m.company)}</span>
                        </TableHead>
                      ))}
                      <TableHead colSpan={2} className="border-l text-center">
                        Agrégat du groupe
                      </TableHead>
                    </TableRow>
                    <TableRow>
                      {[...(data?.members ?? []).map((m) => m.company.id), 'combined'].flatMap((id) => [
                        <TableHead key={`${id}-n`} numeric className="min-w-28 border-l">
                          N
                        </TableHead>,
                        <TableHead key={`${id}-n1`} numeric className="min-w-28">
                          N-1
                        </TableHead>,
                      ])}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data ? (
                      <TableSkeleton columns={5} />
                    ) : (
                      COMPARED.map((id) => {
                        const row = rowById(id)
                        return (
                          <TableRow key={id}>
                            <TableCell className={cn('whitespace-normal', row.kind === 'total' && 'font-medium')}>{row.label}</TableCell>
                            {[...data.members.map((m) => [m.current, m.previous] as const), [data.combined.current, data.combined.previous] as const].flatMap(([n, n1], i) => [
                              <TableCell key={`${i}-n`} numeric className="border-l">
                                <IndicatorValue row={row} indicators={n} />
                              </TableCell>,
                              <TableCell key={`${i}-n1`} numeric className="text-muted-foreground">
                                <IndicatorValue row={row} indicators={n1} />
                              </TableCell>,
                            ])}
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

/** Ratios of the group space: profitability, payment delays and structure, per company and for the aggregate. */
export function GroupRatiosSection() {
  const report = useIndicators()
  const data = report.data
  const combined = data?.combined.current ?? null
  const kpis = ['margeEbe', 'margeNette', 'endettement', 'dso'].map(rowById)
  return (
    <div className="space-y-6">
      <SectionIntro
        description="Rentabilité, délais de paiement et endettement de chaque société et de l'agrégat du groupe, calculés comme sur la page SIG et ratios de chaque société."
        actions={<ExportButtons report="indicators" disabled={!data} />}
      />
      {report.error ? (
        <LoadError message={report.error} onRetry={report.retry} />
      ) : (
        <>
          {data ? <Notice>{data.notice}</Notice> : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={report.loading || undefined}>
            {kpis.map((row) => (
              <StatCard key={row.id} label={row.label} value={data ? <IndicatorValue row={row} indicators={combined} /> : '-'} hint="Agrégat du groupe" busy={report.loading} />
            ))}
          </div>
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
          <Card aria-busy={report.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>Ratios par société</h2>
              </CardTitle>
              <CardDescription>Exercice N. Un ratio de l&apos;agrégat est celui de la somme des comptes, pas la moyenne des sociétés.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-52">Ratio</TableHead>
                      {data?.members.map((m) => (
                        <TableHead key={m.company.id} numeric className="min-w-32 whitespace-normal">
                          {m.company.name}
                        </TableHead>
                      ))}
                      <TableHead numeric className="min-w-32">
                        Agrégat
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data ? (
                      <TableSkeleton columns={4} />
                    ) : (
                      RATIOS.map((id) => {
                        const row = rowById(id)
                        return (
                          <TableRow key={id}>
                            <TableCell className="whitespace-normal">
                              <span className="block">{row.label}</span>
                              <span className="text-muted-foreground block text-xs">{row.source}</span>
                            </TableCell>
                            {data.members.map((m) => (
                              <TableCell key={m.company.id} numeric>
                                <IndicatorValue row={row} indicators={m.current} />
                              </TableCell>
                            ))}
                            <TableCell numeric className="font-medium">
                              <IndicatorValue row={row} indicators={combined} />
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
