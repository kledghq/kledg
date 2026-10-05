'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BookCheck, FileDown, Link2, Pencil, RotateCcw, Trash2, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Amount, DateDisplay, PageHeader, StatusBadge, useConfirm } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { ProposeWithAiButton } from '@/components/features/ai-assist/propose-with-ai-button'
import { responseError } from '@/hooks/use-cursor-list'
import { formatVatRate } from '@/lib/invoices/amounts'
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_TONES, type InvoiceStatus } from '@/lib/invoices/status'
import { invoiceOriginLabel, qontoStanding, type InvoiceOriginCode } from '@/lib/invoices/origin'

interface Detail {
  id: string
  direction: 'SALE' | 'PURCHASE'
  number: string | null
  origin: InvoiceOriginCode
  createdInQonto: boolean
  qontoPending: boolean
  qontoDraft: boolean
  /** Id of the invoice at Qonto (created there or imported). */
  qontoId?: string | null
  provisionalNumber: string | null
  typeCode: string
  issueDate: string
  dueDate: string
  label: string | null
  status: InvoiceStatus
  source: 'MANUAL' | 'QONTO'
  externalStatus: string | null
  hasAttachment: boolean
  letteringCode: string | null
  totalExclTaxCents: number
  totalVatCents: number
  totalInclTaxCents: number
  paidCents: number
  remainingCents: number
  tiers: { id: string; name: string; auxiliaryAccountNumber: string }
  parties: { sellerSiren: string | null; sellerVatNumber: string | null; buyerSiren: string | null; buyerVatNumber: string | null }
  entry: { id: string; entryNumber: string; status: string } | null
  lines: Array<{ id: string; label: string; quantity: string; unitPriceCents: number; vatRateBp: number; totalExclTaxCents: number; accountCode: string | null; nature: 'GOODS' | 'SERVICES'; fixedAsset: boolean; vatExemption?: 'training' | null }>
  /** Mentions of the exempt lines (CGI ann. II art. 242 nonies A, I, 12°). */
  vatExemptionMentions?: Array<{ code: string; text: string; positions: number[] }>
  vatBreakdown: Array<{ vatRateBp: number; baseCents: number; vatCents: number }>
  payments: Array<{ id: string; amountCents: number; entry: { id: string; entryNumber: string; date: string; description: string | null }; vatTransferEntry: { id: string; entryNumber: string; status: string } | null }>
}

interface Candidate {
  entryLineId: string
  entryNumber: string
  date: string
  description: string
  amountCents: number
  exact: boolean
}

async function send(url: string, method: string, body?: unknown, fallback = 'L’action n’a pas abouti. Réessayez.') {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(await responseError(response, fallback))
  return response.status === 204 ? null : response.json()
}

export function InvoiceDetailView({ companyId, invoiceId }: { companyId: string; invoiceId: string }) {
  const router = useRouter()
  const { can, denied } = useCompanyAccess()
  const { confirm, dialog } = useConfirm()
  const [invoice, setInvoice] = React.useState<Detail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null)
  const [accounts, setAccounts] = React.useState<Record<string, string>>({})
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((v) => v + 1)

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/invoices/${invoiceId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'La facture ne s’est pas chargée. Réessayez.'))
        return response.json() as Promise<Detail>
      })
      .then((data) => {
        if (cancelled) return
        setInvoice(data)
        setAccounts(Object.fromEntries(data.lines.map((l) => [l.id, l.accountCode ?? ''])))
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [invoiceId, version])

  React.useEffect(() => {
    if (!invoice || !invoice.entry || invoice.remainingCents === 0) return
    let cancelled = false
    fetch(`/api/invoices/${invoiceId}/payments/candidates`)
      .then((response) => (response.ok ? (response.json() as Promise<{ candidates: Candidate[] }>) : { candidates: [] }))
      .then((data) => !cancelled && setCandidates(data.candidates))
    return () => {
      cancelled = true
    }
  }, [invoice, invoiceId])

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      reload()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !invoice) {
    return (
      <Card>
        <CardContent role="alert" className="flex flex-col items-start gap-3">
          <p className="text-sm">{error}</p>
          <Button size="sm" variant="outline" onClick={reload}>
            Réessayer
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (!invoice) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const sale = invoice.direction === 'SALE'
  const qonto = qontoStanding({ ...invoice, qontoId: invoice.qontoId ?? null })
  const posted = invoice.entry !== null
  const mayPost = can({ entries: ['create'] })
  const mayUpdate = can({ entries: ['update'] })
  const mayDelete = can({ entries: ['delete'] })
  const listUrl = `/${companyId}/invoices/${sale ? 'sales' : 'purchases'}`
  const kind = invoice.typeCode === '381' ? 'Avoir' : 'Facture'
  const name = invoice.number ? `${kind.toLowerCase()} ${invoice.number}` : `${kind.toLowerCase()} en brouillon`
  // A number given by the series, or an invoice created in Qonto, stays: a credit note cancels it.
  const deletable = !(invoice.origin === 'AUTO' && invoice.number) && (!invoice.createdInQonto || invoice.qontoDraft)
  const resumeQonto = () => run(() => send(`/api/invoices/${invoiceId}/qonto`, 'POST'), 'Facture créée dans Qonto')
  const accountsChanged = invoice.lines.some((l) => (accounts[l.id] ?? '') !== (l.accountCode ?? ''))

  const post = () => run(() => send(`/api/invoices/${invoiceId}/post`, 'POST'), 'Écriture créée en brouillon dans le journal ' + (sale ? 'VE' : 'AC'))
  const unpost = async () => {
    const ok = await confirm({
      title: `Supprimer l’écriture de la ${name} ?`,
      description:
        invoice.origin === 'AUTO'
          ? 'L’écriture en brouillon est supprimée et la facture redevient un brouillon modifiable. Elle garde son numéro.'
          : 'L’écriture en brouillon est supprimée et la facture redevient un brouillon modifiable.',
      confirmLabel: 'Supprimer l’écriture',
    })
    if (ok) await run(() => send(`/api/invoices/${invoiceId}/post`, 'DELETE'), 'Écriture supprimée')
  }
  const remove = async () => {
    const ok = await confirm({
      title: `Supprimer la ${name} ?`,
      description: invoice.qontoDraft
        ? 'La facture est supprimée de Kledg. Son brouillon reste dans Qonto : supprimez-le aussi dans Qonto, ou finalisez-le et importez-le de nouveau.'
        : 'La facture et ses lignes sont supprimées. Aucune écriture n’existe encore.',
      confirmLabel: 'Supprimer la facture',
    })
    if (!ok) return
    setBusy(true)
    try {
      await send(`/api/invoices/${invoiceId}`, 'DELETE')
      toast.success('Facture supprimée')
      router.push(listUrl)
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }
  const saveAccounts = () =>
    run(
      () => send(`/api/invoices/${invoiceId}/lines`, 'PATCH', { lines: invoice.lines.map((l) => ({ id: l.id, accountCode: accounts[l.id] || null })) }),
      'Comptes enregistrés',
    )
  const recordPayment = (entryLineId: string) =>
    run(async () => {
      const result = (await send(`/api/invoices/${invoiceId}/payments`, 'POST', { entryLineId })) as { letteringPending: string | null; lettered: boolean; letteringCode: string | null }
      if (result.letteringPending) toast.info(result.letteringPending)
      else if (result.lettered) toast.info(`Facture lettrée ${result.letteringCode} avec ses règlements`)
    }, 'Règlement enregistré')
  const removePayment = async (paymentId: string) => {
    const ok = await confirm({
      title: 'Retirer ce règlement de la facture ?',
      description: 'Le règlement redevient disponible. Son écriture bancaire ne change pas ; une écriture de TVA exigible en brouillon est supprimée.',
      confirmLabel: 'Retirer le règlement',
      tone: 'default',
    })
    if (ok) await run(() => send(`/api/invoices/${invoiceId}/payments/${paymentId}`, 'DELETE'), 'Règlement retiré')
  }
  const settle = () =>
    run(async () => {
      const result = (await send(`/api/invoices/${invoiceId}/settle`, 'POST')) as { letteringPending: string | null }
      if (result.letteringPending) throw new Error(result.letteringPending)
    }, 'Facture lettrée')

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoice.number ? `${kind} ${invoice.number}` : `${kind} en brouillon`}
        description={
          <>
            {sale ? 'Facture de vente à ' : 'Facture d’achat de '}
            <Link href={`/${companyId}/tiers/${invoice.tiers.id}`} className="text-link underline-offset-4 hover:underline">
              {invoice.tiers.name}
            </Link>{' '}
            (<span className="font-mono text-xs">{invoice.tiers.auxiliaryAccountNumber}</span>), du <DateDisplay value={invoice.issueDate} />, échéance le{' '}
            <DateDisplay value={invoice.dueDate} />.
          </>
        }
        actions={
          <>
            <ProposeWithAiButton
              size="default"
              target={{ kind: 'invoice', id: invoice.id, direction: invoice.direction, number: invoice.number, date: invoice.issueDate, tiersName: invoice.tiers.name, totalInclTaxCents: invoice.totalInclTaxCents, posted }}
            />
            {invoice.hasAttachment ? (
              <Button variant="outline" asChild>
                <a href={`/api/invoices/${invoiceId}/attachment`} target="_blank" rel="noreferrer">
                  <FileDown aria-hidden />
                  Document
                </a>
              </Button>
            ) : null}
            {!posted && invoice.source === 'MANUAL' && mayUpdate ? (
              <Button variant="outline" asChild>
                <Link href={`/${companyId}/invoices/${invoiceId}/edit`}>
                  <Pencil aria-hidden />
                  Modifier
                </Link>
              </Button>
            ) : null}
            {!posted && mayDelete && deletable ? (
              <Button variant="outline" onClick={remove} disabled={busy}>
                <Trash2 aria-hidden />
                Supprimer
              </Button>
            ) : null}
            {posted && invoice.entry?.status === 'draft' && invoice.payments.length === 0 && mayDelete ? (
              <Button variant="outline" onClick={unpost} disabled={busy}>
                <Undo2 aria-hidden />
                Supprimer l’écriture
              </Button>
            ) : null}
            {invoice.qontoPending && mayPost ? (
              <Button variant="outline" onClick={resumeQonto} disabled={busy}>
                Reprendre la création dans Qonto
              </Button>
            ) : null}
            {!posted && !invoice.qontoPending && !invoice.qontoDraft ? (
              <Button onClick={post} disabled={busy || !mayPost || accountsChanged} loading={busy}>
                <BookCheck aria-hidden />
                Comptabiliser
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={INVOICE_STATUS_TONES[invoice.status]}>{INVOICE_STATUS_LABELS[invoice.status]}</StatusBadge>
          {qonto.label ? (
            <StatusBadge tone="info">{qonto.label}</StatusBadge>
          ) : sale && invoiceOriginLabel(invoice.origin, invoice.createdInQonto) ? (
            <StatusBadge tone="info">{invoiceOriginLabel(invoice.origin, invoice.createdInQonto)}</StatusBadge>
          ) : null}
          {qonto.draftLabel ? <StatusBadge tone="warning">{qonto.draftLabel}</StatusBadge> : null}
          {qonto.qontoId ? (
            // Qonto documents no web address for one client invoice: its id lets the user find it in Qonto.
            <span className="text-muted-foreground text-sm" data-testid="qonto-id">
              Identifiant Qonto&nbsp;: <span className="font-mono">{qonto.qontoId}</span>
            </span>
          ) : null}
          {!invoice.number && invoice.origin === 'AUTO' ? (
            <span className="text-muted-foreground text-sm" data-testid="draft-number-hint">
              Numéro attribué à l’émission{invoice.provisionalNumber ? ` (prochain prévu : ${invoice.provisionalNumber})` : ''}
            </span>
          ) : null}
          {invoice.letteringCode ? <StatusBadge tone="success">Lettrée {invoice.letteringCode}</StatusBadge> : null}
          {invoice.entry ? (
            <Link href={`/${companyId}/entries/${invoice.entry.id}`} className="text-link text-sm underline-offset-4 hover:underline">
              Écriture n° {invoice.entry.entryNumber} ({invoice.entry.status === 'validated' ? 'validée' : 'brouillon'})
            </Link>
          ) : null}
        </div>
      </PageHeader>

      {!mayPost ? <AccessNotice>{denied('comptabiliser les factures')}</AccessNotice> : null}
      {invoice.qontoDraft ? (
        <p role="status" className="max-w-prose text-sm" data-testid="qonto-draft-note">
          Cette facture est un brouillon dans Qonto : elle n’a pas encore de numéro. Finalisez-la dans Qonto, puis importez les factures Qonto : Kledg reprend son numéro et vous pourrez la comptabiliser.
        </p>
      ) : null}
      {invoice.qontoPending ? (
        <p role="status" className="max-w-prose text-sm">
          Qonto n’a pas confirmé la création de cette facture. Reprenez sa création : Kledg vérifie d’abord si Qonto l’a créée, pour ne jamais la créer deux fois.
        </p>
      ) : null}
      {sale && invoice.lines.some((l) => l.nature === 'SERVICES') && invoice.vatBreakdown.some((b) => b.vatCents > 0) ? (
        <p className="text-muted-foreground max-w-prose text-sm" role="note">
          TVA sur les prestations de services&nbsp;: exigible à l’encaissement, sauf option pour les débits (CGI art. 269, 2, c). Sans option, elle attend au compte 44574 et passe
          au 44571 quand un règlement est enregistré sur la facture. L’option se règle sur la page Factures de vente.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Lignes</CardTitle>
          {!posted && invoice.source === 'QONTO' ? (
            <CardDescription>Les montants viennent du document Qonto. Choisissez le compte de chaque ligne avant de comptabiliser.</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          {/* Phones and tablets: one card per line */}
          <ul className="divide-y rounded-md border lg:hidden">
            {invoice.lines.map((line) => (
              <li key={line.id} className="space-y-2 px-3 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    {line.label}
                    <span className="text-muted-foreground block text-xs">
                      {line.quantity.replace('.', ',')} x <Amount value={line.unitPriceCents / 100} />, TVA {formatVatRate(line.vatRateBp)}
                      {line.fixedAsset ? ', immobilisation' : ''}
                    </span>
                  </span>
                  <Amount value={line.totalExclTaxCents / 100} />
                </div>
                {!posted && mayUpdate ? (
                  <Input
                    value={accounts[line.id] ?? ''}
                    onChange={(e) => setAccounts((current) => ({ ...current, [line.id]: e.target.value.trim() }))}
                    placeholder={sale ? '706' : 'ex. 6064'}
                    aria-label={`Compte de la ligne ${line.label}`}
                    className="font-mono"
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">
                    Compte <span className="font-mono">{line.accountCode ?? (sale ? (line.nature === 'GOODS' ? '707' : '706') : '')}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <Table containerClassName="hidden lg:block">
            <TableHeader>
              <TableRow>
                <TableHead>Désignation</TableHead>
                <TableHead numeric>Qté</TableHead>
                <TableHead numeric>Prix unitaire HT</TableHead>
                <TableHead>TVA</TableHead>
                <TableHead>Compte</TableHead>
                <TableHead numeric>Total HT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="min-w-48 whitespace-normal">
                    {line.label}
                    <span className="text-muted-foreground block text-xs">
                      {line.nature === 'GOODS' ? 'Bien' : 'Prestation'}
                      {line.fixedAsset ? ', immobilisation' : ''}
                    </span>
                  </TableCell>
                  <TableCell numeric>{line.quantity.replace('.', ',')}</TableCell>
                  <TableCell numeric>
                    <Amount value={line.unitPriceCents / 100} />
                  </TableCell>
                  <TableCell>{line.vatExemption ? 'Exonérée' : formatVatRate(line.vatRateBp)}</TableCell>
                  <TableCell>
                    {!posted && mayUpdate ? (
                      <Input
                        value={accounts[line.id] ?? ''}
                        onChange={(e) => setAccounts((current) => ({ ...current, [line.id]: e.target.value.trim() }))}
                        placeholder={sale ? '706' : 'ex. 6064'}
                        aria-label={`Compte de la ligne ${line.label}`}
                        className="w-28 font-mono"
                      />
                    ) : (
                      <span className="font-mono text-xs">{line.accountCode ?? (sale ? (line.nature === 'GOODS' ? '707' : '706') : '')}</span>
                    )}
                  </TableCell>
                  <TableCell numeric>
                    <Amount value={line.totalExclTaxCents / 100} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {accountsChanged ? (
            <div className="flex justify-end pt-3">
              <Button size="sm" onClick={saveAccounts} loading={busy}>
                Enregistrer les comptes
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>TVA et totaux</CardTitle>
            <CardDescription>Par taux, le total hors taxe et la taxe correspondante (CGI, annexe II, art. 242 nonies A).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Taux</TableHead>
                  <TableHead numeric>Base HT</TableHead>
                  <TableHead numeric>TVA</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.vatBreakdown.map((row) => (
                  <TableRow key={row.vatRateBp}>
                    <TableCell>{formatVatRate(row.vatRateBp)}</TableCell>
                    <TableCell numeric>
                      <Amount value={row.baseCents / 100} />
                    </TableCell>
                    <TableCell numeric>
                      <Amount value={row.vatCents / 100} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {invoice.vatExemptionMentions?.length ? (
              <div className="space-y-1" data-testid="vat-exemption-mentions">
                <p className="text-sm font-medium">Mention d’exonération</p>
                {invoice.vatExemptionMentions.map((m) => (
                  <p key={m.code} className="text-sm">
                    {m.text}
                  </p>
                ))}
                <p className="text-muted-foreground text-xs">À porter sur la facture émise (CGI, ann. II, art. 242 nonies A, I, 12°)&nbsp;; texte réglable sur la page Factures de vente.</p>
              </div>
            ) : null}
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Total HT</dt>
              <dd className="text-right">
                <Amount value={invoice.totalExclTaxCents / 100} />
              </dd>
              <dt className="text-muted-foreground">TVA</dt>
              <dd className="text-right">
                <Amount value={invoice.totalVatCents / 100} />
              </dd>
              <dt className="font-medium">Total TTC</dt>
              <dd className="text-right font-semibold">
                <Amount value={invoice.totalInclTaxCents / 100} />
              </dd>
              <dt className="text-muted-foreground">Reste dû</dt>
              <dd className="text-right">
                <Amount value={invoice.remainingCents / 100} />
              </dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Règlements</CardTitle>
            <CardDescription>
              Les paiements viennent de la banque&nbsp;: un mouvement rapproché et validé sur le compte {sale ? 'client' : 'fournisseur'}. Une facture réglée en plusieurs fois reste
              payée partiellement, sans lettrage, jusqu’au dernier règlement.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!posted ? <p className="text-muted-foreground text-sm">Comptabilisez la facture pour enregistrer ses règlements.</p> : null}
            {invoice.payments.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {invoice.payments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      Écriture n° {payment.entry.entryNumber}, <DateDisplay value={payment.entry.date} />
                      {payment.vatTransferEntry ? (
                        <span className="text-muted-foreground block text-xs">TVA exigible&nbsp;: écriture n° {payment.vatTransferEntry.entryNumber}</span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <Amount value={payment.amountCents / 100} />
                      {!invoice.letteringCode && mayUpdate ? (
                        <Button size="icon-sm" variant="ghost" aria-label="Retirer ce règlement" title="Retirer ce règlement" onClick={() => removePayment(payment.id)} disabled={busy}>
                          <RotateCcw aria-hidden />
                        </Button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {invoice.status === 'paid' && !invoice.letteringCode && mayUpdate ? (
              <Button size="sm" variant="outline" onClick={settle} disabled={busy}>
                <Link2 aria-hidden />
                Lettrer avec ses règlements
              </Button>
            ) : null}
            {posted && invoice.remainingCents > 0 && candidates && candidates.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Règlements proposés</p>
                <ul className="divide-y rounded-md border">
                  {candidates.map((c) => (
                    <li key={c.entryLineId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate">{c.description || `Écriture n° ${c.entryNumber}`}</span>
                        <span className="text-muted-foreground text-xs">
                          n° {c.entryNumber}, <DateDisplay value={c.date} />
                          {c.exact ? ', montant exact' : ''}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Amount value={c.amountCents / 100} />
                        <Button size="xs" variant="outline" onClick={() => recordPayment(c.entryLineId)} disabled={busy || !mayUpdate}>
                          Enregistrer
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : posted && invoice.remainingCents > 0 && candidates ? (
              <p className="text-muted-foreground text-sm">
                Aucun mouvement bancaire rapproché ne correspond. Rapprochez la transaction sur le compte {sale ? '411' : '401'}, validez l’écriture, puis revenez ici.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identifiants des parties</CardTitle>
          <CardDescription>
            SIREN et numéros de TVA tels qu’enregistrés sur la facture. Kledg n’est pas une plateforme agréée de facturation électronique&nbsp;: il ne reçoit, n’émet ni ne transmet de facture électronique et ne transmet aucune donnée à l’administration (e-reporting).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">SIREN du vendeur</dt>
              <dd className="font-mono">{invoice.parties.sellerSiren ?? 'Non renseigné'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">TVA du vendeur</dt>
              <dd className="font-mono">{invoice.parties.sellerVatNumber ?? 'Non renseigné'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">SIREN de l’acheteur</dt>
              <dd className="font-mono">{invoice.parties.buyerSiren ?? 'Non renseigné'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">TVA de l’acheteur</dt>
              <dd className="font-mono">{invoice.parties.buyerVatNumber ?? 'Non renseigné'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Type de document</dt>
              <dd>
                {invoice.typeCode} ({kind.toLowerCase()})
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      {dialog}
    </div>
  )
}
