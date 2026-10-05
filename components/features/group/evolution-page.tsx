'use client'

import * as React from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { PageHeader, formatDisplayDate } from '@/components/shared'
import type { GroupEvolutionReport, MonthFigures } from '@/lib/group/get-group-evolution.service'
import { ProduitsChargesBars, TreasuryLineChart } from './charts'
import { Cents, CompanyLink, ExportButtons, GroupFiscalYear, LoadError, Notice, PerimeterNotes, useGroupReport, useReportUrl } from './space'

const GROUP = 'group'

/** Évolution of the group space: month by month, the group or one company. */
export function GroupEvolutionPage() {
  const report = useGroupReport<GroupEvolutionReport>(useReportUrl('evolution'), "L'évolution du groupe ne s'est pas chargée. Réessayez dans un instant.")
  const data = report.data
  const [selected, setSelected] = React.useState(GROUP)
  const company = data?.companies.find((c) => c.id === selected) ?? null
  const months = (data?.months ?? []).map((m) => ({ month: m.month, ...(company ? m.byCompany[company.id] : m.total) }) as MonthFigures & { month: string })
  const cash = months.filter((m) => m.tresorerieCents !== null).map((m) => ({ month: m.month, cents: m.tresorerieCents as number }))
  const label = company ? company.name : 'le groupe'
  return (
    <div className="space-y-6">
      <PageHeader
        title="Évolution"
        description="Produits, charges, résultat et trésorerie mois par mois, pour le groupe ou pour une société."
        actions={<ExportButtons report="evolution" disabled={!data} />}
      />
      <GroupFiscalYear />
      {report.error ? (
        <LoadError message={report.error} onRetry={report.retry} />
      ) : (
        <>
          <Notice>Le groupe est la somme des sociétés lues, à 100&nbsp;% et flux intragroupe compris&nbsp;: une agrégation, pas une consolidation.</Notice>
          {data ? <PerimeterNotes warnings={data.warnings} unreachable={data.unreachable} /> : null}
          <div className="max-w-xs space-y-2">
            <Label htmlFor="evolution-company">Afficher</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger id="evolution-company" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GROUP}>Le groupe</SelectItem>
                {data?.companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card aria-busy={report.loading || undefined}>
              <CardHeader>
                <CardTitle>
                  <h2>Produits et charges</h2>
                </CardTitle>
                <CardDescription>Classes 7 et 6 de {label}, par mois.</CardDescription>
              </CardHeader>
              <CardContent className="px-2 sm:px-5">{data ? <ProduitsChargesBars months={months} /> : <Skeleton className="h-64 w-full" />}</CardContent>
            </Card>
            <Card aria-busy={report.loading || undefined}>
              <CardHeader>
                <CardTitle>
                  <h2>Trésorerie</h2>
                </CardTitle>
                <CardDescription>Soldes des comptes 512 de {label} en fin de mois.</CardDescription>
              </CardHeader>
              <CardContent className="px-2 sm:px-5">
                {!data ? (
                  <Skeleton className="h-64 w-full" />
                ) : cash.length === 0 ? (
                  <p className="text-muted-foreground px-3 text-sm sm:px-0">Aucun exercice sur cette période.</p>
                ) : (
                  <TreasuryLineChart points={cash} />
                )}
              </CardContent>
            </Card>
          </div>
          <Card aria-busy={report.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>Mois par mois</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mois</TableHead>
                      <TableHead numeric>Produits</TableHead>
                      <TableHead numeric>Charges</TableHead>
                      <TableHead numeric>Résultat</TableHead>
                      <TableHead numeric>Trésorerie</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data ? (
                      <TableSkeleton columns={5} />
                    ) : (
                      months.map((m) => (
                        <TableRow key={m.month}>
                          <TableCell>{formatDisplayDate(`${m.month}-01`, 'month')}</TableCell>
                          <TableCell numeric>
                            <Cents value={m.produitsCents} />
                          </TableCell>
                          <TableCell numeric>
                            <Cents value={m.chargesCents} />
                          </TableCell>
                          <TableCell numeric>
                            <Cents value={m.resultatCents} signed />
                          </TableCell>
                          <TableCell numeric>
                            <Cents value={m.tresorerieCents} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <Card aria-busy={report.loading || undefined}>
            <CardHeader>
              <CardTitle>
                <h2>Cumul par société</h2>
              </CardTitle>
              <CardDescription>Sur les mois affichés.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Société</TableHead>
                      <TableHead numeric>Produits</TableHead>
                      <TableHead numeric>Charges</TableHead>
                      <TableHead numeric>Résultat</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!data ? (
                      <TableSkeleton columns={4} />
                    ) : (
                      data.companies.map((c) => {
                        const t = data.totals.byCompany[c.id]
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="whitespace-normal">
                              <CompanyLink company={c} />
                            </TableCell>
                            <TableCell numeric>
                              <Cents value={t?.produitsCents} />
                            </TableCell>
                            <TableCell numeric>
                              <Cents value={t?.chargesCents} />
                            </TableCell>
                            <TableCell numeric>
                              <Cents value={t?.resultatCents} signed />
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                  {data ? (
                    <TableFooter>
                      <TableRow>
                        <TableCell>Groupe</TableCell>
                        <TableCell numeric>
                          <Cents value={data.totals.total.produitsCents} />
                        </TableCell>
                        <TableCell numeric>
                          <Cents value={data.totals.total.chargesCents} />
                        </TableCell>
                        <TableCell numeric>
                          <Cents value={data.totals.total.resultatCents} signed />
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  ) : null}
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
