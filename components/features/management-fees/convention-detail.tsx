'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DateInput } from '@/components/ui/date-input'
import { Table, TableBody, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow, TableSkeleton } from '@/components/ui/table'
import { Amount, ConfirmDialog, DateDisplay, Field, PageHeader, StatusBadge, formatDisplayDate, useConfirm } from '@/components/shared'
import { useCompanyAccess } from '@/components/features/companies/company-access'
import { formatVatRate } from '@/lib/invoices/amounts'
import { ALLOCATION_KEY_LABELS, PRICING_LABELS, formatRateBp } from '@/lib/management-fees/rules'
import type { ManagementFeeComputation } from '@/lib/management-fees/compute-management-fees.service'
import type { BillingView, GeneratedBilling } from '@/lib/management-fees/bill-management-fees.service'
import { request, type ConventionView } from './api'

const euros = (cents: number) => cents / 100

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function InvoiceState({ invoice, companyRef }: { invoice: { id: string; number: string; posted: boolean } | 'unknown' | null; companyRef: string }) {
  if (invoice === null) return <span className="text-muted-foreground">Non proposée</span>
  if (invoice === 'unknown') return <span className="text-muted-foreground">Non visible avec votre accès</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Link href={`/${companyRef}/invoices/${invoice.id}`} className="text-link font-mono text-xs hover:underline">
        {invoice.number}
      </Link>
      <StatusBadge tone={invoice.posted ? 'success' : 'warning'}>{invoice.posted ? 'Comptabilisée' : 'Brouillon'}</StatusBadge>
    </span>
  )
}

/** A convention: its terms, the computation of a period, the invoices and the periods already invoiced. */
export function ConventionDetail({ companyId, convention, onChanged }: { companyId: string; convention: ConventionView; onChanged: () => void }) {
  const router = useRouter()
  const { can } = useCompanyAccess()
  const mayWrite = can({ entries: ['create'] })
  const { confirm, dialog } = useConfirm()
  const [periodStart, setPeriodStart] = React.useState('')
  const [periodEnd, setPeriodEnd] = React.useState('')
  const [computation, setComputation] = React.useState<ManagementFeeComputation | null>(null)
  const [computeError, setComputeError] = React.useState<string | null>(null)
  const [computing, setComputing] = React.useState(false)
  const [billings, setBillings] = React.useState<BillingView[] | null>(null)
  const [billingsError, setBillingsError] = React.useState<string | null>(null)
  const [billingsVersion, setBillingsVersion] = React.useState(0)
  const [generateOpen, setGenerateOpen] = React.useState(false)
  const [issueDate, setIssueDate] = React.useState('')
  const [purchaseDrafts, setPurchaseDrafts] = React.useState(true)
  const [generating, setGenerating] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    request<{ billings: BillingView[] }>(`/api/management-fees/conventions/${convention.id}/invoices`)
      .then((data) => !cancelled && setBillings(data.billings))
      .catch((e: Error) => !cancelled && setBillingsError(e.message))
    return () => {
      cancelled = true
    }
  }, [convention.id, billingsVersion])

  const compute = async (event: React.FormEvent) => {
    event.preventDefault()
    setComputeError(null)
    setComputing(true)
    try {
      const query = new URLSearchParams({ periodStart, periodEnd }).toString()
      setComputation(await request<ManagementFeeComputation>(`/api/management-fees/conventions/${convention.id}/preview?${query}`))
      setIssueDate(periodEnd)
    } catch (e) {
      setComputation(null)
      setComputeError((e as Error).message)
    } finally {
      setComputing(false)
    }
  }

  const generate = async () => {
    if (!computation) return
    setGenerating(true)
    try {
      const result = await request<{ billings: GeneratedBilling[] }>(`/api/management-fees/conventions/${convention.id}/invoices`, {
        method: 'POST',
        body: { periodStart: computation.period.start, periodEnd: computation.period.end, issueDate: issueDate || undefined, purchaseDrafts },
      })
      const created = result.billings.filter((b) => b.outcome === 'created').length
      toast.success(created > 0 ? `${created} facture${created > 1 ? 's' : ''} de vente préparée${created > 1 ? 's' : ''} en brouillon` : 'Factures complétées')
      setGenerateOpen(false)
      setBillingsVersion((v) => v + 1)
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  const remove = async () => {
    const ok = await confirm({
      title: `Supprimer la convention « ${convention.label} » ?`,
      description: 'Elle n’a jamais été facturée. Ses conditions et la liste de ses filiales sont supprimées.',
      confirmLabel: 'Supprimer',
    })
    if (!ok) return
    try {
      await request(`/api/management-fees/conventions/${convention.id}`, { method: 'DELETE' })
      toast.success('Convention supprimée')
      router.push(`/${companyId}/management-fees`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const result = computation?.result
  const showRevenue = convention.allocationKey === 'REVENUE'
  const showShare = convention.allocationKey === 'CUSTOM'
  const actions = mayWrite ? (
    <>
      <Button size="sm" variant="outline" asChild>
        <Link href={`/${companyId}/management-fees/${convention.id}/edit`}>
          <Pencil aria-hidden />
          Modifier
        </Link>
      </Button>
      {convention.billingCount === 0 ? (
        <Button size="icon-sm" variant="ghost" className="hover:text-destructive" aria-label="Supprimer la convention" title="Supprimer" onClick={remove}>
          <Trash2 aria-hidden />
        </Button>
      ) : null}
    </>
  ) : null

  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader
        title={convention.label}
        description={`${PRICING_LABELS[convention.pricing]}, répartition par ${ALLOCATION_KEY_LABELS[convention.allocationKey].toLowerCase()}.`}
        actions={actions}
      />

      <Card>
        <CardHeader>
          <CardTitle>Conditions</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Durée">
              {convention.endDate ? (
                <>
                  Du <DateDisplay value={convention.startDate} /> au <DateDisplay value={convention.endDate} />
                </>
              ) : (
                <>
                  À partir du <DateDisplay value={convention.startDate} />
                </>
              )}
            </Fact>
            {convention.pricing === 'FIXED' ? (
              <Fact label="Forfait HT par période">
                <Amount value={euros(convention.fixedAmountCents ?? 0)} />
              </Fact>
            ) : (
              <>
                <Fact label="Marge">{formatRateBp(convention.markupBp)}</Fact>
                <Fact label="Charges refacturables">{formatRateBp(convention.costShareBp)} des comptes retenus</Fact>
                <Fact label="Comptes">
                  <span className="font-mono text-xs">
                    {convention.costAccountPrefixes.join(', ')} sauf {convention.excludedAccountPrefixes.join(', ') || 'aucun'}
                  </span>
                </Fact>
              </>
            )}
            <Fact label="TVA">{formatVatRate(convention.vatRateBp)}</Fact>
            <Fact label="Comptes de facturation">
              <span className="font-mono text-xs">
                {convention.revenueAccountCode} / {convention.expenseAccountCode}
              </span>
            </Fact>
            <Fact label="Série des factures">
              <span className="font-mono text-xs">{convention.invoicePrefix}-AAAA-001</span>
            </Fact>
          </dl>
          <ul className="mt-4 divide-y rounded-md border">
            {convention.subsidiaries.map((s) => (
              <li key={s.subsidiaryId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className={s.accessible ? undefined : 'text-muted-foreground'}>{s.name ?? 'Société non accessible avec votre compte'}</span>
                <span className="text-muted-foreground text-xs">
                  {s.sharePercentBp !== null ? `${formatRateBp(s.sharePercentBp)}` : null}
                  {s.startDate ? (
                    <>
                      {' '}
                      entrée le <DateDisplay value={s.startDate} />
                    </>
                  ) : null}
                  {s.endDate ? (
                    <>
                      {' '}
                      sortie le <DateDisplay value={s.endDate} />
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calculer une période</CardTitle>
          <CardDescription>
            Kledg lit les écritures validées de la holding et, selon la clé, celles des filiales. Rien n’est enregistré tant que vous ne préparez pas les factures.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={compute} className="flex flex-wrap items-end gap-3">
            <Field label="Début de la période" htmlFor="mf-period-start" required>
              <DateInput id="mf-period-start" value={periodStart} onValueChange={setPeriodStart} />
            </Field>
            <Field label="Fin de la période" htmlFor="mf-period-end" required>
              <DateInput id="mf-period-end" value={periodEnd} onValueChange={setPeriodEnd} />
            </Field>
            <Button type="submit" loading={computing} disabled={!periodStart || !periodEnd}>
              Calculer
            </Button>
          </form>
          {computeError ? (
            <p role="alert" className="text-destructive text-sm">
              {computeError}
            </p>
          ) : null}
          {computation && result ? (
            <div className="space-y-4">
              {computation.warnings.length > 0 ? (
                <ul className="text-warning space-y-1 text-sm" role="status">
                  {computation.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              {computation.costPool ? (
                <details className="rounded-md border px-3 py-2 text-sm">
                  <summary className="cursor-pointer">
                    Charges retenues de la holding&nbsp;: <Amount value={euros(computation.costPool.totalCents)} /> ({computation.costPool.accounts.length} comptes)
                  </summary>
                  <div className="mt-2 max-h-72 overflow-auto">
                    <Table>
                      <TableBody>
                        {computation.costPool.accounts.map((a) => (
                          <TableRow key={a.code}>
                            <TableCell className="font-mono text-xs">{a.code}</TableCell>
                            <TableCell className="whitespace-normal">{a.label}</TableCell>
                            <TableCell numeric>
                              <Amount value={euros(a.cents)} />
                            </TableCell>
                          </TableRow>
                        ))}
                        {computation.costPool.excluded.map((a) => (
                          <TableRow key={`x-${a.code}`} className="text-muted-foreground">
                            <TableCell className="font-mono text-xs">{a.code}</TableCell>
                            <TableCell className="whitespace-normal">{a.label} (exclu)</TableCell>
                            <TableCell numeric>
                              <Amount value={euros(a.cents)} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </details>
              ) : null}
              <dl className="grid gap-4 sm:grid-cols-3">
                <Fact label={result.pricing === 'FIXED' ? 'Forfait' : `Base (${formatRateBp(result.costShareBp)} des charges)`}>
                  <Amount value={euros(result.baseCents)} />
                </Fact>
                <Fact label={`Marge (${formatRateBp(result.markupBp)})`}>
                  <Amount value={euros(result.markupCents)} />
                </Fact>
                <Fact label="Total HT à répartir">
                  <Amount value={euros(result.totalExclTaxCents)} className="font-semibold" />
                </Fact>
              </dl>
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Filiale</TableHead>
                      <TableHead numeric className="hidden sm:table-cell">
                        Jours
                      </TableHead>
                      {showRevenue ? (
                        <TableHead numeric className="hidden md:table-cell">
                          Chiffre d’affaires
                        </TableHead>
                      ) : null}
                      {showShare ? <TableHead numeric className="hidden md:table-cell">Part</TableHead> : null}
                      <TableHead numeric>HT</TableHead>
                      <TableHead numeric className="hidden sm:table-cell">
                        TVA
                      </TableHead>
                      <TableHead numeric>TTC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.parts.map((p) => (
                      <TableRow key={p.subsidiaryId}>
                        <TableCell className="whitespace-normal">{p.name}</TableCell>
                        <TableCell numeric className="hidden sm:table-cell">
                          {p.eligibleDays}
                        </TableCell>
                        {showRevenue ? (
                          <TableCell numeric className="hidden md:table-cell">
                            <Amount value={euros(p.revenueCents ?? 0)} />
                          </TableCell>
                        ) : null}
                        {showShare ? (
                          <TableCell numeric className="hidden md:table-cell">
                            {p.sharePercentBp === null ? '' : formatRateBp(p.sharePercentBp)}
                          </TableCell>
                        ) : null}
                        <TableCell numeric>
                          <Amount value={euros(p.amountExclTaxCents)} />
                        </TableCell>
                        <TableCell numeric className="hidden sm:table-cell">
                          <Amount value={euros(p.vatCents)} />
                        </TableCell>
                        <TableCell numeric>
                          <Amount value={euros(p.amountInclTaxCents)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-medium">Total</TableCell>
                      <TableCell className="hidden sm:table-cell" />
                      {showRevenue ? <TableCell className="hidden md:table-cell" /> : null}
                      {showShare ? <TableCell className="hidden md:table-cell" /> : null}
                      <TableCell numeric>
                        <Amount value={euros(result.totalExclTaxCents)} />
                      </TableCell>
                      <TableCell numeric className="hidden sm:table-cell">
                        <Amount value={euros(result.totalVatCents)} />
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={euros(result.totalInclTaxCents)} />
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
              {computation.billed.length > 0 ? (
                <p className="text-muted-foreground text-sm">
                  Déjà facturé sur cette période&nbsp;: {computation.billed.map((b) => b.salesInvoiceNumber ?? 'facture en cours').join(', ')}. Les montants déjà facturés ne sont pas recalculés.
                </p>
              ) : null}
              {mayWrite ? (
                <Button onClick={() => setGenerateOpen(true)}>Préparer les factures</Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>Périodes facturées</CardTitle>
          <CardDescription>Chaque facture de vente reste un brouillon jusqu’à sa comptabilisation depuis Factures de vente. La facture d’achat proposée se comptabilise dans la filiale.</CardDescription>
        </CardHeader>
        {billingsError ? (
          <CardContent role="alert" className="text-sm">
            {billingsError}
          </CardContent>
        ) : (
          <div className="overflow-x-auto border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Période</TableHead>
                  <TableHead>Filiale</TableHead>
                  <TableHead numeric>HT</TableHead>
                  <TableHead numeric className="hidden md:table-cell">
                    TTC
                  </TableHead>
                  <TableHead>Facture de vente</TableHead>
                  <TableHead className="hidden lg:table-cell">Facture d’achat de la filiale</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody aria-busy={billings === null}>
                {billings === null ? (
                  <TableSkeleton columns={6} rows={2} />
                ) : billings.length === 0 ? (
                  <TableEmpty colSpan={6}>Aucune période facturée. Calculez une période, puis préparez ses factures.</TableEmpty>
                ) : (
                  billings.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <DateDisplay value={b.periodStart} /> au <DateDisplay value={b.periodEnd} />
                      </TableCell>
                      <TableCell className="whitespace-normal">{b.subsidiaryName ?? 'Société non accessible'}</TableCell>
                      <TableCell numeric>
                        <Amount value={euros(b.amountExclTaxCents)} />
                      </TableCell>
                      <TableCell numeric className="hidden md:table-cell">
                        <Amount value={euros(b.amountInclTaxCents)} />
                      </TableCell>
                      <TableCell>
                        <InvoiceState invoice={b.salesInvoice} companyRef={companyId} />
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <InvoiceState invoice={b.purchaseInvoice} companyRef={b.subsidiaryId} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        tone="default"
        title={computation ? `Préparer les factures du ${formatDisplayDate(computation.period.start)} au ${formatDisplayDate(computation.period.end)} ?` : 'Préparer les factures ?'}
        description="Une facture de vente en brouillon par filiale, dans la série de la convention. Rien n’est comptabilisé&nbsp;: vous les vérifiez et les comptabilisez depuis Factures de vente."
        confirmLabel="Préparer les factures"
        loading={generating}
        onConfirm={generate}
      >
        <div className="space-y-3">
          <Field label="Date des factures" htmlFor="mf-issue-date">
            <DateInput id="mf-issue-date" value={issueDate} onValueChange={setIssueDate} />
          </Field>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox checked={purchaseDrafts} onCheckedChange={(checked) => setPurchaseDrafts(checked === true)} aria-label="Proposer la facture d’achat à chaque filiale" />
            <span>
              Proposer la facture d’achat en brouillon à chaque filiale
              <span className="text-muted-foreground block text-xs">
                Il faut pouvoir saisir des factures dans chaque filiale. La filiale la vérifie et la comptabilise elle-même&nbsp;; sinon elle enregistre la facture reçue comme d’habitude.
              </span>
            </span>
          </label>
        </div>
      </ConfirmDialog>
    </div>
  )
}
