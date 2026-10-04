'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Download, FileSpreadsheet, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Amount, DateDisplay, PageHeader, StatCard } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { ReportsEmptyHint } from '@/components/features/onboarding/reports-empty-hint'
import { downloadFile } from '@/components/features/reports/download-file'
import { responseError } from '@/hooks/use-cursor-list'
import { docsUrl } from '@/lib/docs-links'
import { cn } from '@/lib/utils'
import { INDICATOR_SECTIONS, type IndicatorRow } from '@/lib/reports/financial-indicators/rows'
import type { FinancialIndicatorsReport } from '@/lib/reports/financial-indicators/get-financial-indicators.service'

/** A ratio as "25,3 %", a variation of ratios in points. */
function percent(value: number, points = false): string {
  const text = (value * 100).toFixed(1).replace('.', ',')
  return points ? `${value > 0 ? '+' : ''}${text} pt` : `${text} %`
}

function Value({ row, value, variation = false }: { row: IndicatorRow; value: number | null; variation?: boolean }) {
  if (value === null) return <span className="text-muted-foreground">-</span>
  if (row.kind === 'percent') return <span className="num">{percent(value, variation)}</span>
  if (row.kind === 'days') return <span className="num">{`${variation && value > 0 ? '+' : ''}${value} j`}</span>
  return <Amount value={value / 100} className={cn(!variation && row.kind === 'total' && value < 0 && 'text-destructive')} />
}

function variationOf(row: IndicatorRow, current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null
  return row.kind === 'percent' ? Math.round((current - previous) * 10_000) / 10_000 : current - previous
}

export default function SigPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const { can } = useCompanyAccess()
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [report, setReport] = React.useState<FinancialIndicatorsReport | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [exporting, setExporting] = React.useState<'csv' | 'xlsx' | null>(null)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    if (!companyId || !fiscalYearId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/reports/financial-indicators?${new URLSearchParams({ companyId, fiscalYearId })}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "Les soldes de gestion ne se sont pas chargés. Réessayez dans un instant."))
        return response.json() as Promise<FinancialIndicatorsReport>
      })
      .then((data) => {
        if (!cancelled) setReport(data)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, fiscalYearId, version])

  const exportFile = async (format: 'csv' | 'xlsx') => {
    if (!report) return
    setExporting(format)
    try {
      await downloadFile(
        `/api/reports/financial-indicators/export?${new URLSearchParams({ companyId, fiscalYearId: report.fiscalYear.id, format })}`,
        `SIG_${report.fiscalYear.year}.${format}`,
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(null)
    }
  }

  const current = report?.current
  const previous = report?.previous

  return (
    <div className="space-y-6">
      <PageHeader
        title="Soldes intermédiaires de gestion"
        description="Comment se forme le résultat, de la marge à l'excédent brut d'exploitation, avec la capacité d'autofinancement, le besoin en fonds de roulement et les principaux ratios, comparés à l'exercice précédent."
        docsHref={docsUrl('incomeStatement')}
        actions={
          can({ reports: ['export'] }) ? (
            <>
              <Button variant="outline" onClick={() => exportFile('csv')} disabled={!report || exporting !== null} loading={exporting === 'csv'}>
                <Download aria-hidden />
                Exporter en CSV
              </Button>
              <Button variant="outline" onClick={() => exportFile('xlsx')} disabled={!report || exporting !== null} loading={exporting === 'xlsx'}>
                <FileSpreadsheet aria-hidden />
                Exporter en Excel
              </Button>
            </>
          ) : null
        }
      />
      <ReportsEmptyHint companyId={companyId} />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="sig-fiscal-year">Exercice</Label>
            <FiscalYearSelector
              companyId={companyId}
              value={fiscalYearId}
              onValueChange={setFiscalYearId}
              showLabel={false}
              showPeriod={false}
              id="sig-fiscal-year"
            />
          </div>
          {report ? (
            <p className="text-muted-foreground text-sm sm:col-span-2 sm:self-end">
              Écritures validées de l&apos;exercice {report.fiscalYear.year}, écriture de clôture exclue
              {previous ? `, comparées à l'exercice ${previous.fiscalYear.year}` : ", sans exercice précédent pour comparer"}. Délais de
              paiement au <DateDisplay value={report.fiscalYear.asOf} format="long" />, sur {current?.delais.days} jours.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3" role="alert">
            <p className="text-sm">{error}</p>
            <Button size="sm" variant="outline" onClick={() => setVersion((n) => n + 1)}>
              <RotateCw aria-hidden />
              Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy={loading || undefined}>
            <StatCard
              label="Excédent brut d'exploitation"
              value={current ? <Amount value={current.sig.ebeCents / 100} /> : '-'}
              valueClassName={current && current.sig.ebeCents < 0 ? 'text-destructive' : undefined}
              hint={previous ? <>En {previous.fiscalYear.year}&nbsp;: <Amount value={previous.indicators.sig.ebeCents / 100} /></> : undefined}
              busy={loading}
            />
            <StatCard
              label="Capacité d'autofinancement"
              value={current ? <Amount value={current.caf.cafCents / 100} /> : '-'}
              valueClassName={current && current.caf.cafCents < 0 ? 'text-destructive' : undefined}
              hint={previous ? <>En {previous.fiscalYear.year}&nbsp;: <Amount value={previous.indicators.caf.cafCents / 100} /></> : undefined}
              busy={loading}
            />
            <StatCard
              label="Besoin en fonds de roulement"
              value={current ? <Amount value={current.bilan.bfrCents / 100} /> : '-'}
              hint={previous ? <>En {previous.fiscalYear.year}&nbsp;: <Amount value={previous.indicators.bilan.bfrCents / 100} /></> : undefined}
              busy={loading}
            />
            <StatCard
              label="Délais clients et fournisseurs"
              value={current ? <span className="num">{`${current.delais.dsoDays ?? '-'} j / ${current.delais.dpoDays ?? '-'} j`}</span> : '-'}
              hint="Clients, puis fournisseurs, TVA comprise"
              busy={loading}
            />
          </div>

          {INDICATOR_SECTIONS.map((section) => (
            <Card key={section.id} aria-busy={loading || undefined}>
              <CardHeader>
                <CardTitle>
                  <h2>{section.title}</h2>
                </CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-64">Libellé</TableHead>
                        <TableHead numeric>{report ? `Exercice ${report.fiscalYear.year}` : 'Exercice'}</TableHead>
                        <TableHead numeric>{previous ? `Exercice ${previous.fiscalYear.year}` : 'Exercice précédent'}</TableHead>
                        <TableHead numeric>Variation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading && !report ? (
                        <TableSkeleton columns={4} />
                      ) : current ? (
                        section.rows.map((row) => {
                          const value = row.value(current)
                          const before = previous ? row.value(previous.indicators) : null
                          const total = row.kind === 'total'
                          return (
                            <TableRow key={row.id} className={cn(total && 'bg-muted/50 font-semibold')}>
                              <TableCell>
                                <span className="flex items-baseline gap-2">
                                  {row.operator ? (
                                    <span className="text-muted-foreground w-3 shrink-0 font-mono text-xs" aria-hidden>
                                      {row.operator}
                                    </span>
                                  ) : (
                                    <span className="w-3 shrink-0" aria-hidden />
                                  )}
                                  <span>
                                    <span className="block">{row.label}</span>
                                    <span className="text-muted-foreground block text-xs font-normal">{row.source}</span>
                                  </span>
                                </span>
                              </TableCell>
                              <TableCell numeric>
                                <Value row={row} value={value} />
                              </TableCell>
                              <TableCell numeric>
                                <Value row={row} value={before} />
                              </TableCell>
                              <TableCell numeric className="font-normal">
                                <Value row={row} value={variationOf(row, value, before)} variation />
                              </TableCell>
                            </TableRow>
                          )
                        })
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
