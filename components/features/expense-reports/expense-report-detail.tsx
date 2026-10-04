'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BookCheck, CheckCheck, Eye, Link2, Pencil, RotateCcw, Send, Trash2, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Amount, DateDisplay, Field, PageHeader, StatusBadge, useConfirm } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { JustificatifPreviewDialog } from '@/components/features/justificatifs/justificatif-preview-dialog'
import { responseError } from '@/hooks/use-cursor-list'
import { formatVatRate } from '@/lib/invoices/amounts'
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/expense-reports/categories'
import { VEHICLE_LABELS, type VehicleType } from '@/lib/expense-reports/mileage-scale'
import { CLAIMANT_KIND_LABELS, EXPENSE_STATUS_LABELS, EXPENSE_STATUS_TONES, type ExpenseReportStatus } from '@/lib/expense-reports/status'
import { ExpenseTotals } from './expense-totals'

export interface ExpenseReportDetailData {
  id: string
  number: string
  label: string | null
  periodStart: string
  periodEnd: string
  status: ExpenseReportStatus
  storedStatus: 'DRAFT' | 'SUBMITTED' | 'VALIDATED'
  own: boolean
  returnNote: string | null
  vatExempt: boolean
  claimant: { id: string; name: string; kind: 'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE'; auxiliaryAccountNumber: string; accountCode: string | null }
  totalInclTaxCents: number
  recoverableVatCents: number
  totalExpenseCents: number
  vatByRate: Array<{ vatRateBp: number; recoverableVatCents: number }>
  letteringCode: string | null
  entry: { id: string; entryNumber: string; status: string } | null
  mileageBaselines: Record<string, number>
  lines: Array<{
    id: string
    kind: 'EXPENSE' | 'MILEAGE'
    date: string
    supplierName: string | null
    label: string
    category: ExpenseCategory
    accountCode: string | null
    amountInclTaxCents: number
    vatRateBp: number
    vatCents: number
    recoverableVatCents: number
    recovery: string
    receiptKind: 'NONE' | 'RECEIPT' | 'INVOICE'
    receiptAttachmentId: string | null
    receiptFileName: string | null
    receiptContentType: string | null
    receiptReference: string | null
    vehicleType: string | null
    fiscalPower: number | null
    electric: boolean
    distanceKm: number | null
    priorDistanceKm: number | null
    scaleYear: number | null
    powerClass: string | null
  }>
}

interface Candidate {
  entryLineId: string
  entryNumber: string
  date: string
  description: string
  amountCents: number
  exact: boolean
}

const RECEIPT_LABELS = { NONE: 'Sans justificatif', RECEIPT: 'Ticket', INVOICE: 'Facture' } as const

async function send(url: string, method: string, body?: unknown, fallback = 'L’action n’a pas abouti. Réessayez.') {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(await responseError(response, fallback))
  return response.status === 204 ? null : response.json()
}

export function ExpenseReportDetailView({ companyId, reportId }: { companyId: string; reportId: string }) {
  const router = useRouter()
  const { can, denied } = useCompanyAccess()
  const { confirm, dialog } = useConfirm()
  const [report, setReport] = React.useState<ExpenseReportDetailData | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState('')
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null)
  const [chosen, setChosen] = React.useState<string[]>([])
  const [preview, setPreview] = React.useState<ExpenseReportDetailData['lines'][number] | null>(null)
  const [version, setVersion] = React.useState(0)
  const reload = () => setVersion((v) => v + 1)

  const mayManage = can({ expenses: ['validate'] })
  const mayPost = can({ entries: ['create'] })
  const mayUnpost = can({ entries: ['delete'] })
  const mayLetter = can({ entries: ['update'] })
  const mayReadReceipts = can({ banking: ['read'] })

  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/expense-reports/${reportId}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, 'La note de frais ne s’est pas chargée. Réessayez.'))
        return response.json() as Promise<ExpenseReportDetailData>
      })
      .then((data) => {
        if (cancelled) return
        setReport(data)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [reportId, version])

  React.useEffect(() => {
    if (!report || report.status !== 'posted' || !mayManage) return
    let cancelled = false
    fetch(`/api/expense-reports/${reportId}/reimbursement`)
      .then((response) => (response.ok ? (response.json() as Promise<{ candidates: Candidate[] }>) : { candidates: [] }))
      .then((data) => {
        if (cancelled) return
        setCandidates(data.candidates)
        const exact = data.candidates.filter((c) => c.exact)
        setChosen(exact.length === 1 ? [exact[0].entryLineId] : [])
      })
    return () => {
      cancelled = true
    }
  }, [report, reportId, mayManage])

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

  if (error && !report) {
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
  if (!report) {
    return (
      <div className="space-y-4" aria-busy>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const draft = report.storedStatus === 'DRAFT'
  const submitted = report.storedStatus === 'SUBMITTED'
  const posted = report.entry !== null
  const author = report.own
  const mayEdit = !posted && ((draft && (author || mayManage)) || (submitted && mayManage))
  const mayDelete = !posted && ((draft && author) || mayManage)
  const listUrl = `/${companyId}/expense-reports${author && !mayManage ? '/mine' : ''}`
  const workflow = (action: 'submit' | 'return' | 'validate' | 'reopen', success: string) =>
    run(() => send(`/api/expense-reports/${reportId}/workflow`, 'POST', { action, note: note || null }), success)

  const remove = async () => {
    const ok = await confirm({
      title: `Supprimer la note de frais ${report.number}\u00a0?`,
      description: 'La note et ses lignes sont supprimées. Aucune écriture n’existe encore.',
      confirmLabel: 'Supprimer la note',
    })
    if (!ok) return
    setBusy(true)
    try {
      await send(`/api/expense-reports/${reportId}`, 'DELETE')
      toast.success('Note de frais supprimée')
      router.push(listUrl)
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }
  const unpost = async () => {
    const ok = await confirm({
      title: `Supprimer l’écriture de la note ${report.number}\u00a0?`,
      description: 'L’écriture en brouillon est supprimée et la note redevient validée, prête à comptabiliser.',
      confirmLabel: 'Supprimer l’écriture',
    })
    if (ok) await run(() => send(`/api/expense-reports/${reportId}/post`, 'DELETE'), 'Écriture supprimée')
  }
  const post = () =>
    run(async () => {
      const result = (await send(`/api/expense-reports/${reportId}/post`, 'POST')) as { journal: string }
      toast.info(`Écriture créée en brouillon dans le journal ${result.journal}\u00a0: validez-la dans Écritures.`)
    }, 'Note de frais comptabilisée')
  const reimburse = () => run(() => send(`/api/expense-reports/${reportId}/reimbursement`, 'POST', { entryLineIds: chosen }), 'Note de frais lettrée avec son remboursement')
  const chosenCents = (candidates ?? []).filter((c) => chosen.includes(c.entryLineId)).reduce((sum, c) => sum + c.amountCents, 0)

  return (
    <div className="space-y-6">
      {dialog}
      <PageHeader
        title={`Note de frais ${report.number}`}
        description={
          <>
            {report.claimant.name} ({CLAIMANT_KIND_LABELS[report.claimant.kind]}, <span className="font-mono text-xs">{report.claimant.auxiliaryAccountNumber}</span>), du{' '}
            <DateDisplay value={report.periodStart} /> au <DateDisplay value={report.periodEnd} />
            {report.label ? `. ${report.label}` : ''}.
          </>
        }
        actions={
          <>
            {mayEdit ? (
              <Button variant="outline" asChild>
                <Link href={`/${companyId}/expense-reports/${reportId}/edit`}>
                  <Pencil aria-hidden />
                  Modifier
                </Link>
              </Button>
            ) : null}
            {mayDelete ? (
              <Button variant="outline" onClick={remove} disabled={busy}>
                <Trash2 aria-hidden />
                Supprimer
              </Button>
            ) : null}
            {draft && (author || mayManage) ? (
              <Button onClick={() => workflow('submit', 'Note de frais soumise')} disabled={busy || report.lines.length === 0} loading={busy}>
                <Send aria-hidden />
                Soumettre
              </Button>
            ) : null}
            {submitted && mayManage ? (
              <Button onClick={() => workflow('validate', 'Note de frais validée')} disabled={busy} loading={busy}>
                <CheckCheck aria-hidden />
                Valider
              </Button>
            ) : null}
            {report.status === 'validated' && mayManage ? (
              <Button variant="outline" onClick={() => workflow('reopen', 'Note de frais rouverte')} disabled={busy}>
                <RotateCcw aria-hidden />
                Rouvrir
              </Button>
            ) : null}
            {report.status === 'validated' ? (
              <Button onClick={post} disabled={busy || !mayPost} loading={busy}>
                <BookCheck aria-hidden />
                Comptabiliser
              </Button>
            ) : null}
            {posted && report.entry?.status === 'draft' && mayUnpost && !report.letteringCode ? (
              <Button variant="outline" onClick={unpost} disabled={busy}>
                <Undo2 aria-hidden />
                Supprimer l’écriture
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={EXPENSE_STATUS_TONES[report.status]}>{EXPENSE_STATUS_LABELS[report.status]}</StatusBadge>
          {report.letteringCode ? <StatusBadge tone="success">Lettrée {report.letteringCode}</StatusBadge> : null}
          {report.entry ? (
            <Link href={`/${companyId}/entries/${report.entry.id}`} className="text-link text-sm underline-offset-4 hover:underline">
              Écriture n° {report.entry.entryNumber} ({report.entry.status === 'validated' ? 'validée' : 'brouillon'})
            </Link>
          ) : null}
        </div>
      </PageHeader>

      {report.returnNote && draft ? (
        <p role="note" className="border-warning text-sm max-w-prose rounded-md border px-3 py-2">
          Renvoyée par le valideur&nbsp;: {report.returnNote}
        </p>
      ) : null}
      {report.status === 'validated' && !mayPost ? <AccessNotice>{denied('comptabiliser les notes de frais')}</AccessNotice> : null}

      <Card>
        <CardHeader>
          <CardTitle>Dépenses et trajets</CardTitle>
          <CardDescription>La TVA récupérable de chaque ligne dépend de sa catégorie et de son justificatif&nbsp;; le reste fait partie de la charge.</CardDescription>
        </CardHeader>
        <CardContent>
          {report.lines.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucune ligne&nbsp;: modifiez la note pour ajouter les dépenses.</p>
          ) : (
            <>
              <ul className="divide-y rounded-md border lg:hidden">
                {report.lines.map((line) => (
                  <li key={line.id} className="space-y-1 px-3 py-3 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        {line.label}
                        <span className="text-muted-foreground block text-xs">
                          <DateDisplay value={line.date} />, {line.kind === 'MILEAGE' ? `${line.distanceKm} km, ${line.powerClass ?? ''}` : (line.supplierName ?? EXPENSE_CATEGORIES[line.category].label)}
                        </span>
                      </span>
                      <Amount value={line.amountInclTaxCents / 100} />
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {line.recovery}
                      {line.recoverableVatCents > 0 ? (
                        <>
                          {' '}
                          (<Amount value={line.recoverableVatCents / 100} />)
                        </>
                      ) : null}
                    </p>
                    {line.receiptAttachmentId && mayReadReceipts ? (
                      <Button variant="link" size="xs" onClick={() => setPreview(line)}>
                        <Eye aria-hidden />
                        Voir le justificatif
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              <Table containerClassName="hidden lg:block">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Dépense</TableHead>
                    <TableHead>Compte</TableHead>
                    <TableHead>Justificatif</TableHead>
                    <TableHead numeric>Payé TTC</TableHead>
                    <TableHead numeric>TVA</TableHead>
                    <TableHead numeric>TVA récupérable</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <DateDisplay value={line.date} />
                      </TableCell>
                      <TableCell className="min-w-56 whitespace-normal">
                        {line.label}
                        <span className="text-muted-foreground block text-xs">
                          {line.kind === 'MILEAGE'
                            ? `${line.distanceKm} km, ${VEHICLE_LABELS[(line.vehicleType ?? 'CAR') as VehicleType]} ${line.powerClass ?? ''}${line.electric ? ', électrique' : ''}, barème ${line.scaleYear}`
                            : [line.supplierName, EXPENSE_CATEGORIES[line.category].label].filter(Boolean).join(', ')}
                        </span>
                        <span className="text-muted-foreground block text-xs">{line.recovery}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{line.accountCode ?? EXPENSE_CATEGORIES[line.category].account ?? '?'}</TableCell>
                      <TableCell className="text-xs">
                        {line.kind === 'MILEAGE' ? '' : RECEIPT_LABELS[line.receiptKind]}
                        {line.receiptReference ? <span className="text-muted-foreground block">{line.receiptReference}</span> : null}
                        {line.receiptAttachmentId && mayReadReceipts ? (
                          <Button variant="link" size="xs" onClick={() => setPreview(line)}>
                            <Eye aria-hidden />
                            Voir
                          </Button>
                        ) : null}
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={line.amountInclTaxCents / 100} />
                      </TableCell>
                      <TableCell numeric>
                        {line.vatCents > 0 ? (
                          <>
                            <Amount value={line.vatCents / 100} /> <span className="text-muted-foreground text-xs">{formatVatRate(line.vatRateBp)}</span>
                          </>
                        ) : (
                          ''
                        )}
                      </TableCell>
                      <TableCell numeric>
                        <Amount value={line.recoverableVatCents / 100} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Totaux</CardTitle>
            <CardDescription>
              Crédit au compte {report.claimant.accountCode ?? { EMPLOYEE: '421', DIRIGEANT: '467', ASSOCIE: '455' }[report.claimant.kind]} du bénéficiaire, compte auxiliaire{' '}
              <span className="font-mono text-xs">{report.claimant.auxiliaryAccountNumber}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExpenseTotals totals={report} />
          </CardContent>
        </Card>

        {submitted && mayManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Renvoyer à son auteur</CardTitle>
              <CardDescription>La note redevient un brouillon modifiable, avec votre explication.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Ce qu’il faut corriger" htmlFor="return-note">
                <Textarea id="return-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. Joindre la facture de l’hôtel du 12 mars" />
              </Field>
              <Button variant="outline" size="sm" onClick={() => workflow('return', 'Note de frais renvoyée')} disabled={busy || !note.trim()}>
                <Undo2 aria-hidden />
                Renvoyer la note
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {report.status === 'posted' && mayManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Remboursement</CardTitle>
              <CardDescription>
                Choisissez le virement rapproché qui rembourse la note&nbsp;: Kledg lettre la ligne du bénéficiaire avec lui, et la note devient remboursée.
                {report.entry?.status !== 'validated' ? ' Validez d’abord l’écriture de la note dans Écritures.' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {candidates === null ? (
                <Skeleton className="h-16 w-full" />
              ) : candidates.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Aucun virement rapproché au débit du compte du bénéficiaire pour l’instant. Rapprochez la transaction bancaire du remboursement avec ce compte, puis revenez ici.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {candidates.map((c) => (
                    <li key={c.entryLineId}>
                      <label className="flex items-center gap-3 px-3 py-2 text-sm">
                        <Checkbox
                          checked={chosen.includes(c.entryLineId)}
                          onCheckedChange={(checked) => setChosen((current) => (checked === true ? [...current, c.entryLineId] : current.filter((id) => id !== c.entryLineId)))}
                          aria-label={`Virement du ${c.date}, écriture n° ${c.entryNumber}`}
                        />
                        <span className="min-w-0 flex-1">
                          <DateDisplay value={c.date} />, écriture n° {c.entryNumber}
                          <span className="text-muted-foreground block truncate text-xs">{c.description}</span>
                        </span>
                        <Amount value={c.amountCents / 100} />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">
                  Sélection <Amount value={chosenCents / 100} /> sur <Amount value={report.totalInclTaxCents / 100} />
                </span>
                <Button size="sm" onClick={reimburse} disabled={busy || !mayLetter || chosenCents !== report.totalInclTaxCents || report.entry?.status !== 'validated'}>
                  <Link2 aria-hidden />
                  Lettrer avec le remboursement
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {preview?.receiptAttachmentId ? (
        <JustificatifPreviewDialog
          open
          onOpenChange={(open) => !open && setPreview(null)}
          attachmentId={preview.receiptAttachmentId}
          transactionUuid=""
          companyId={companyId}
          fileName={preview.receiptFileName ?? 'Justificatif'}
          fileContentType={preview.receiptContentType}
        />
      ) : null}
    </div>
  )
}
