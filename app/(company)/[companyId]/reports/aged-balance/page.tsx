'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarClock, Download, Hourglass, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Amount, DateDisplay, EmptyState, HelpTip, PageHeader, StatCard } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { ReportsEmptyHint } from '@/components/features/onboarding/reports-empty-hint'
import { PaymentTermsDialog } from '@/components/features/reports/payment-terms-dialog'
import { downloadFile } from '@/components/features/reports/download-file'
import { responseError } from '@/hooks/use-cursor-list'
import { describePaymentTerms } from '@/lib/reports/third-parties/payment-terms'
import {
  AGE_BUCKET_LABELS,
  AGE_BUCKETS,
  overdueCents,
  type BucketAmounts,
  type ThirdPartyKind,
} from '@/lib/reports/third-parties/third-party-balances'
import type { AgedBalanceReport } from '@/lib/reports/third-parties/get-third-party-reports.service'

const KIND_TITLES: Record<ThirdPartyKind, string> = { customers: 'Clients', suppliers: 'Fournisseurs' }

const cell = (cents: number) => (cents === 0 ? <span className="text-muted-foreground">-</span> : <Amount value={cents / 100} />)

export default function AgedBalancePage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const { can } = useCompanyAccess()
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [asOf, setAsOf] = React.useState('')
  const [kind, setKind] = React.useState<ThirdPartyKind>('customers')
  const [report, setReport] = React.useState<AgedBalanceReport | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [termsOpen, setTermsOpen] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    if (!companyId || !fiscalYearId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({ companyId, fiscalYearId })
    if (asOf) query.set('asOf', asOf)
    fetch(`/api/reports/aged-balance?${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "La balance âgée ne s'est pas chargée. Réessayez dans un instant."))
        return response.json() as Promise<AgedBalanceReport>
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
  }, [companyId, fiscalYearId, asOf, version])

  const section = report?.[kind]
  const exportExcel = async () => {
    if (!report) return
    setExporting(true)
    try {
      await downloadFile(
        `/api/reports/aged-balance/export-excel?${new URLSearchParams({ companyId, fiscalYearId: report.fiscalYear.id, asOf: report.asOf })}`,
        `Balance_agee_${report.asOf}.xlsx`,
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const bucketsRow = (buckets: BucketAmounts, strong = false) =>
    AGE_BUCKETS.map((bucket) => (
      <TableCell key={bucket} numeric className={strong ? 'font-semibold' : undefined}>
        {cell(buckets[bucket])}
      </TableCell>
    ))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Balance âgée"
        description="Ce que vos clients vous doivent et ce que vous devez à vos fournisseurs, classé par ancienneté de l'échéance. Seules les lignes non lettrées comptent&nbsp;: lettrez les factures payées pour qu'elles sortent de la balance."
        actions={
          <>
            {can({ settings: ['update'] }) && report ? (
              <Button variant="outline" onClick={() => setTermsOpen(true)}>
                <CalendarClock aria-hidden />
                Délai de paiement
              </Button>
            ) : null}
            {can({ reports: ['export'] }) ? (
              <Button variant="outline" onClick={exportExcel} disabled={!report || exporting} loading={exporting}>
                <Download aria-hidden />
                Exporter en Excel
              </Button>
            ) : null}
          </>
        }
      />
      <ReportsEmptyHint companyId={companyId} />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="aged-fiscal-year">Exercice</Label>
            <FiscalYearSelector
              companyId={companyId}
              value={fiscalYearId}
              onValueChange={(id) => {
                setFiscalYearId(id)
                setAsOf('')
              }}
              showLabel={false}
              showPeriod={false}
              id="aged-fiscal-year"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aged-as-of">Situation au</Label>
            <DateInput id="aged-as-of" value={asOf || report?.asOf || ''} onValueChange={(iso) => iso && setAsOf(iso)} />
          </div>
          <div className="space-y-2">
            <span className="text-sm leading-none font-medium" id="aged-kind-label">
              Tiers
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={kind}
              onValueChange={(value) => {
                if (value) setKind(value as ThirdPartyKind)
              }}
              aria-labelledby="aged-kind-label"
              className="w-full"
            >
              <ToggleGroupItem value="customers" className="flex-1">
                Clients
              </ToggleGroupItem>
              <ToggleGroupItem value="suppliers" className="flex-1">
                Fournisseurs
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
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
          <div className="grid gap-4 sm:grid-cols-3" aria-busy={loading || undefined}>
            <StatCard
              label={kind === 'customers' ? 'Créances en cours' : 'Dettes en cours'}
              value={section ? <Amount value={section.totals.totalCents / 100} /> : '-'}
              busy={loading}
            />
            <StatCard label="Non échu" value={section ? <Amount value={section.totals.notDue / 100} /> : '-'} busy={loading} />
            <StatCard
              label="Échu"
              value={section ? <Amount value={overdueCents(section.totals) / 100} /> : '-'}
              valueClassName={section && overdueCents(section.totals) > 0 ? 'text-warning' : undefined}
              busy={loading}
            />
          </div>

          <Card aria-busy={loading || undefined}>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                {KIND_TITLES[kind]}
                <HelpTip term="Échéance">
                  L&apos;échéance d&apos;une facture est sa date plus le délai de paiement de la société. Un règlement ou un avoir non lettré
                  compte à sa date, en déduction.
                </HelpTip>
              </CardTitle>
              {report ? (
                <CardDescription>
                  Au <DateDisplay value={report.asOf} format="long" />, délai de paiement de {describePaymentTerms(report.terms)} (Code de
                  commerce, art. L441-10). Exercice {report.fiscalYear.year}.
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent>
              {section && section.tiers.length === 0 && !loading ? (
                <EmptyState
                  icon={Hourglass}
                  tone="success"
                  title={kind === 'customers' ? 'Aucune créance client en cours' : 'Aucune dette fournisseur en cours'}
                  description="Toutes les lignes de ces comptes sont lettrées ou soldées à cette date."
                />
              ) : (
                <>
                  <ul className="divide-y rounded-md border lg:hidden" aria-label={`Balance âgée, ${KIND_TITLES[kind]}`}>
                    {(section?.tiers ?? []).map((t) => (
                      <li key={t.code} className="space-y-1.5 px-3 py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm">{t.label}</p>
                            <p className="text-muted-foreground font-mono text-xs">{t.code}</p>
                          </div>
                          <Amount value={t.buckets.totalCents / 100} className="font-semibold" />
                        </div>
                        <dl className="text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                          {AGE_BUCKETS.filter((b) => t.buckets[b] !== 0).map((b) => (
                            <div key={b} className="flex justify-between gap-2">
                              <dt>{AGE_BUCKET_LABELS[b]}</dt>
                              <dd className="text-foreground">
                                <Amount value={t.buckets[b] / 100} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                    {section ? (
                      <li className="bg-muted/50 flex justify-between px-3 py-2.5 text-sm font-semibold">
                        <span>Total</span>
                        <Amount value={section.totals.totalCents / 100} />
                      </li>
                    ) : null}
                  </ul>
                  <div className="hidden rounded-md border lg:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tiers</TableHead>
                          {AGE_BUCKETS.map((bucket) => (
                            <TableHead key={bucket} numeric>
                              {AGE_BUCKET_LABELS[bucket]}
                            </TableHead>
                          ))}
                          <TableHead numeric>Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {loading && !report ? (
                          <TableSkeleton columns={7} />
                        ) : !section || section.tiers.length === 0 ? (
                          <TableEmpty colSpan={7}>Aucun tiers.</TableEmpty>
                        ) : (
                          <>
                            {section.tiers.map((t) => (
                              <TableRow key={t.code}>
                                <TableCell className="max-w-72">
                                  <span className="block truncate">{t.label}</span>
                                  <span className="text-muted-foreground font-mono text-xs">{t.code}</span>
                                </TableCell>
                                {bucketsRow(t.buckets)}
                                <TableCell numeric className="font-semibold">
                                  <Amount value={t.buckets.totalCents / 100} />
                                </TableCell>
                              </TableRow>
                            ))}
                            <TableRow className="bg-muted/50 border-t-foreground border-t-2">
                              <TableCell className="font-semibold">Total</TableCell>
                              {bucketsRow(section.totals, true)}
                              <TableCell numeric className="font-semibold">
                                <Amount value={section.totals.totalCents / 100} />
                              </TableCell>
                            </TableRow>
                          </>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
      {report ? (
        <PaymentTermsDialog
          companyId={companyId}
          open={termsOpen}
          onOpenChange={setTermsOpen}
          terms={report.terms}
          onSaved={() => setVersion((n) => n + 1)}
        />
      ) : null}
    </div>
  )
}
