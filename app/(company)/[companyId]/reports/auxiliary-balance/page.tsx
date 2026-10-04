'use client'

import * as React from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Contact, Download, RotateCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateInput } from '@/components/ui/date-input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Amount, DateDisplay, EmptyState, HelpTip, PageHeader } from '@/components/shared'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { ReportsEmptyHint } from '@/components/features/onboarding/reports-empty-hint'
import { downloadFile } from '@/components/features/reports/download-file'
import { responseError } from '@/hooks/use-cursor-list'
import type { ThirdPartyKind } from '@/lib/reports/third-parties/third-party-balances'
import type { AuxiliaryBalanceReport } from '@/lib/reports/third-parties/get-third-party-reports.service'

const KIND_TITLES: Record<ThirdPartyKind, string> = { customers: 'Clients', suppliers: 'Fournisseurs' }

/** A signed balance (debit - credit) as the trial balance shows it: the amount and its side. */
function Balance({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-muted-foreground">-</span>
  return (
    <span className="inline-flex items-baseline gap-1">
      <Amount value={Math.abs(cents) / 100} />
      <span className="text-muted-foreground text-xs">{cents > 0 ? 'D' : 'C'}</span>
    </span>
  )
}

const plain = (cents: number) => (cents === 0 ? <span className="text-muted-foreground">-</span> : <Amount value={cents / 100} />)

export default function AuxiliaryBalancePage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const { can } = useCompanyAccess()
  const [fiscalYearId, setFiscalYearId] = React.useState('')
  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [kind, setKind] = React.useState<ThirdPartyKind>('customers')
  const [report, setReport] = React.useState<AuxiliaryBalanceReport | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [exporting, setExporting] = React.useState(false)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    if (!companyId || !fiscalYearId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({ companyId, fiscalYearId })
    if (startDate) query.set('startDate', startDate)
    if (endDate) query.set('endDate', endDate)
    fetch(`/api/reports/auxiliary-balance?${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, "La balance auxiliaire ne s'est pas chargée. Réessayez dans un instant."))
        return response.json() as Promise<AuxiliaryBalanceReport>
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
  }, [companyId, fiscalYearId, startDate, endDate, version])

  const section = report?.[kind]
  const exportExcel = async () => {
    if (!report) return
    setExporting(true)
    try {
      await downloadFile(
        `/api/reports/auxiliary-balance/export-excel?${new URLSearchParams({
          companyId,
          fiscalYearId: report.fiscalYear.id,
          startDate: report.period.startDate,
          endDate: report.period.endDate,
        })}`,
        `Balance_auxiliaire_${report.period.endDate}.xlsx`,
      )
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  const amounts = (t: { openingCents: number; debitCents: number; creditCents: number; closingCents: number; unletteredCents: number }, strong = false) => (
    <>
      <TableCell numeric className={strong ? 'font-semibold' : undefined}>
        <Balance cents={t.openingCents} />
      </TableCell>
      <TableCell numeric className={strong ? 'font-semibold' : undefined}>
        {plain(t.debitCents)}
      </TableCell>
      <TableCell numeric className={strong ? 'font-semibold' : undefined}>
        {plain(t.creditCents)}
      </TableCell>
      <TableCell numeric className="font-semibold">
        <Balance cents={t.closingCents} />
      </TableCell>
      <TableCell numeric className={strong ? 'font-semibold' : undefined}>
        <Balance cents={t.unletteredCents} />
      </TableCell>
    </>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Balance auxiliaire"
        description="Le solde de chaque client et de chaque fournisseur sur la période, et la part de ses lignes qui n'est pas encore lettrée."
        actions={
          can({ reports: ['export'] }) ? (
            <Button variant="outline" onClick={exportExcel} disabled={!report || exporting} loading={exporting}>
              <Download aria-hidden />
              Exporter en Excel
            </Button>
          ) : null
        }
      />
      <ReportsEmptyHint companyId={companyId} />

      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="aux-fiscal-year">Exercice</Label>
            <FiscalYearSelector
              companyId={companyId}
              value={fiscalYearId}
              onValueChange={(id) => {
                setFiscalYearId(id)
                setStartDate('')
                setEndDate('')
              }}
              showLabel={false}
              showPeriod={false}
              id="aux-fiscal-year"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aux-start">Du</Label>
            <DateInput id="aux-start" value={startDate || report?.period.startDate || ''} onValueChange={(iso) => iso && setStartDate(iso)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="aux-end">Au</Label>
            <DateInput id="aux-end" value={endDate || report?.period.endDate || ''} onValueChange={(iso) => iso && setEndDate(iso)} />
          </div>
          <div className="space-y-2">
            <span className="text-sm leading-none font-medium" id="aux-kind-label">
              Tiers
            </span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={kind}
              onValueChange={(value) => {
                if (value) setKind(value as ThirdPartyKind)
              }}
              aria-labelledby="aux-kind-label"
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
        <Card aria-busy={loading || undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              {KIND_TITLES[kind]}
              <HelpTip term="Compte auxiliaire">
                Chaque client ou fournisseur a son compte auxiliaire (le CompAuxNum du FEC), rattaché au compte collectif 411 ou 401. Sans
                compte auxiliaire, le tiers est le compte lui-même (411DUPONT par exemple).
              </HelpTip>
            </CardTitle>
            {report ? (
              <CardDescription>
                Du <DateDisplay value={report.period.startDate} /> au <DateDisplay value={report.period.endDate} />, exercice {report.fiscalYear.year}.
                Soldes au débit (D) ou au crédit (C).
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            {section && section.tiers.length === 0 && !loading ? (
              <EmptyState
                icon={Contact}
                title={kind === 'customers' ? 'Aucun client sur la période' : 'Aucun fournisseur sur la période'}
                description="Les comptes 411 et 401 apparaissent ici dès qu'ils portent des écritures validées."
              />
            ) : (
              <>
                <ul className="divide-y rounded-md border lg:hidden" aria-label={`Balance auxiliaire, ${KIND_TITLES[kind]}`}>
                  {(section?.tiers ?? []).map((t) => (
                    <li key={t.code} className="space-y-1 px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm">{t.label}</p>
                          <p className="text-muted-foreground font-mono text-xs">{t.code}</p>
                        </div>
                        <span className="font-semibold">
                          <Balance cents={t.closingCents} />
                        </span>
                      </div>
                      <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
                        <span>
                          Débit <Amount value={t.debitCents / 100} />
                        </span>
                        <span>
                          Crédit <Amount value={t.creditCents / 100} />
                        </span>
                        <span>
                          Non lettré <Amount value={t.unletteredCents / 100} />
                        </span>
                      </p>
                    </li>
                  ))}
                  {section ? (
                    <li className="bg-muted/50 flex justify-between px-3 py-2.5 text-sm font-semibold">
                      <span>Total</span>
                      <Balance cents={section.totals.closingCents} />
                    </li>
                  ) : null}
                </ul>
                <div className="hidden rounded-md border lg:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tiers</TableHead>
                        <TableHead numeric>Solde au début</TableHead>
                        <TableHead numeric>Débit</TableHead>
                        <TableHead numeric>Crédit</TableHead>
                        <TableHead numeric>Solde</TableHead>
                        <TableHead numeric>Non lettré</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading && !report ? (
                        <TableSkeleton columns={6} />
                      ) : !section || section.tiers.length === 0 ? (
                        <TableEmpty colSpan={6}>Aucun tiers.</TableEmpty>
                      ) : (
                        <>
                          {section.tiers.map((t) => (
                            <TableRow key={t.code}>
                              <TableCell className="max-w-72">
                                <span className="block truncate">{t.label}</span>
                                <span className="text-muted-foreground font-mono text-xs">{t.code}</span>
                              </TableCell>
                              {amounts(t)}
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 border-t-foreground border-t-2">
                            <TableCell className="font-semibold">Total</TableCell>
                            {amounts(section.totals, true)}
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
      )}
    </div>
  )
}
