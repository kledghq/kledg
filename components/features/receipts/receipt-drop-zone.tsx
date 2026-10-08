'use client'

/**
 * "Déposer des justificatifs" of the Justificatifs page
 * (docs/justificatifs-photo.md): photos (the phone camera) or PDFs, several
 * at once. Each file is staged (POST /api/receipts/staged), then the user
 * confirms the amount, the date and the merchant (prefilled from the file
 * name: Kledg reads no image) and Kledg finds the bank transaction: matched,
 * candidates with "Rattacher", or none with "Créer une note de frais". The
 * same services as the assistants' file_receipt tool.
 */

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Camera, FileUp, Paperclip, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AmountInput } from '@/components/ui/amount-input'
import { DateInput } from '@/components/ui/date-input'
import { Input } from '@/components/ui/input'
import { Amount, ConfirmDialog, DateDisplay, Field, StatusBadge } from '@/components/shared'
import { responseError } from '@/hooks/use-cursor-list'
import { RECEIPT_ACCEPT } from '@/lib/receipts/file-type'
import { cn } from '@/lib/utils'
import type { FileNameFields } from '@/lib/receipts/file-name-fields'
import type { CandidateView, ExpenseResult, ReceiptMatchResult } from '@/lib/receipts/file-receipt.service'
import type { StagedReceiptView } from '@/lib/receipts/stage-receipt.service'
import { prepareReceiptFile } from './prepare-receipt-file'

type ItemState =
  | { step: 'uploading' }
  | { step: 'form' }
  | { step: 'matching' }
  | { step: 'result'; result: ReceiptMatchResult }
  | { step: 'attached'; transaction: CandidateView | null; toBank: boolean }
  | { step: 'expense'; report: ExpenseResult }
  | { step: 'error'; message: string }

interface Item {
  key: string
  name: string
  receipt: StagedReceiptView | null
  amountCents: number | null
  date: string
  merchant: string
  state: ItemState
  busy: boolean
}

interface ReceiptDropZoneProps {
  companyId: string
  /** The user may attach a receipt to a transaction (banking:reconcile). */
  canAttach: boolean
  /** Called once a receipt is attached: the list of missing receipts changed. */
  onAttached?: () => void
}

let nextKey = 0

function itemOf(receipt: StagedReceiptView, guess?: FileNameFields | null): Item {
  return {
    key: `r${nextKey++}`,
    name: receipt.fileName,
    receipt,
    amountCents: receipt.fields.amountCents ?? guess?.amountCents ?? null,
    date: receipt.fields.date ?? guess?.date ?? '',
    merchant: receipt.fields.merchant ?? guess?.merchant ?? '',
    state: { step: 'form' },
    busy: false,
  }
}

async function postJson<T>(url: string, body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(await responseError(response, fallback))
  return (await response.json()) as T
}

export function ReceiptDropZone({ companyId, canAttach, onAttached }: ReceiptDropZoneProps) {
  const [items, setItems] = React.useState<Item[]>([])
  const [dragging, setDragging] = React.useState(false)
  const [toConfirm, setToConfirm] = React.useState<{ key: string; candidate: CandidateView } | null>(null)
  const cameraRef = React.useRef<HTMLInputElement>(null)
  const filesRef = React.useRef<HTMLInputElement>(null)

  const update = React.useCallback((key: string, change: Partial<Item>) => {
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)))
  }, [])

  // Receipts dropped earlier and not filed yet
  React.useEffect(() => {
    let cancelled = false
    fetch(`/api/receipts/staged?companyId=${encodeURIComponent(companyId)}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ receipts: StagedReceiptView[] }>) : null))
      .then((result) => {
        if (!cancelled && result?.receipts?.length) setItems((list) => [...list, ...result.receipts.filter((r) => !list.some((i) => i.receipt?.id === r.id)).map((r) => itemOf(r))])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [companyId])

  async function addFiles(files: FileList | File[] | null) {
    for (const file of Array.from(files ?? [])) {
      const key = `u${nextKey++}`
      setItems((list) => [{ key, name: file.name, receipt: null, amountCents: null, date: '', merchant: '', state: { step: 'uploading' }, busy: true }, ...list])
      try {
        const ready = await prepareReceiptFile(file)
        const form = new FormData()
        form.set('companyId', companyId)
        form.set('file', ready)
        const response = await fetch('/api/receipts/staged', { method: 'POST', body: form })
        if (!response.ok) throw new Error(await responseError(response, "Le justificatif n'a pas pu être déposé. Réessayez."))
        const { receipt, guess } = (await response.json()) as { receipt: StagedReceiptView; guess: FileNameFields }
        const item = itemOf(receipt, guess)
        setItems((list) => (list.some((i) => i.receipt?.id === receipt.id && i.key !== key) ? list.filter((i) => i.key !== key) : list.map((i) => (i.key === key ? { ...item, key } : i))))
      } catch (error) {
        update(key, { busy: false, state: { step: 'error', message: (error as Error).message } })
      }
    }
  }

  async function match(item: Item) {
    if (!item.receipt) return
    if (item.amountCents === null || !item.date) {
      update(item.key, { state: { step: 'error', message: 'Indiquez le montant TTC et la date du justificatif.' } })
      return
    }
    update(item.key, { busy: true, state: { step: 'matching' } })
    try {
      const result = await postJson<ReceiptMatchResult>(
        `/api/receipts/staged/${item.receipt.id}/match`,
        { fields: { amountCents: item.amountCents, date: item.date, merchant: item.merchant.trim() || null } },
        'La recherche de la transaction a échoué. Réessayez.',
      )
      update(item.key, { busy: false, receipt: result.receipt, state: { step: 'result', result } })
    } catch (error) {
      update(item.key, { busy: false, state: { step: 'error', message: (error as Error).message } })
    }
  }

  async function attach(item: Item, candidate: CandidateView) {
    if (!item.receipt) return
    update(item.key, { busy: true })
    try {
      await postJson(`/api/receipts/staged/${item.receipt.id}/attach`, { transactionId: candidate.transactionId }, "Le justificatif n'a pas pu être rattaché. Réessayez.")
      update(item.key, { busy: false, state: { step: 'attached', transaction: candidate, toBank: candidate.sendsToBank } })
      toast.success(candidate.sendsToBank ? 'Justificatif envoyé à Qonto' : 'Justificatif rattaché')
      onAttached?.()
    } catch (error) {
      update(item.key, { busy: false })
      toast.error((error as Error).message)
    }
  }

  async function expense(item: Item) {
    if (!item.receipt) return
    update(item.key, { busy: true })
    try {
      const report = await postJson<ExpenseResult>(`/api/receipts/staged/${item.receipt.id}/expense`, {}, "La note de frais n'a pas pu être préparée. Réessayez.")
      update(item.key, { busy: false, state: { step: 'expense', report } })
      toast.success(`Note de frais ${report.number} préparée en brouillon`)
    } catch (error) {
      update(item.key, { busy: false })
      toast.error((error as Error).message)
    }
  }

  async function discard(item: Item) {
    if (item.receipt) {
      const response = await fetch(`/api/receipts/staged/${item.receipt.id}`, { method: 'DELETE' })
      if (!response.ok) {
        toast.error(await responseError(response, "Le justificatif n'a pas pu être retiré."))
        return
      }
    }
    setItems((list) => list.filter((i) => i.key !== item.key))
  }

  const pickers = (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => cameraRef.current?.click()}>
        <Camera aria-hidden />
        Prendre une photo
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => filesRef.current?.click()}>
        <FileUp aria-hidden />
        Choisir des fichiers
      </Button>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Prendre une photo du justificatif" onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
      <input ref={filesRef} type="file" accept={RECEIPT_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-label="Choisir des justificatifs" onChange={(e) => { void addFiles(e.target.files); e.target.value = '' }} />
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Déposer des justificatifs</CardTitle>
        <CardDescription>Photos ou PDF de tickets et de factures (5&nbsp;Mo au plus chacun)&nbsp;: Kledg retrouve la transaction bancaire, ou prépare une note de frais.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          data-testid="receipt-drop-area"
          className={cn('flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center', dragging && 'border-ring bg-muted')}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void addFiles(e.dataTransfer.files)
          }}
        >
          <Paperclip className="text-muted-foreground size-4" aria-hidden />
          <p className="text-muted-foreground text-sm">Glissez vos justificatifs ici, ou</p>
          {pickers}
        </div>

        {items.length > 0 ? (
          <ul className="space-y-3" aria-label="Justificatifs déposés">
            {items.map((item) => (
              <ReceiptItem
                key={item.key}
                item={item}
                companyId={companyId}
                canAttach={canAttach}
                onChange={(change) => update(item.key, change)}
                onMatch={() => void match(item)}
                onAttach={(candidate) => (candidate.sendsToBank ? setToConfirm({ key: item.key, candidate }) : void attach(item, candidate))}
                onExpense={() => void expense(item)}
                onDiscard={() => void discard(item)}
              />
            ))}
          </ul>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={toConfirm !== null}
        onOpenChange={(open) => !open && setToConfirm(null)}
        title={'Envoyer le justificatif à Qonto\u00a0?'}
        description="Il sera joint à la transaction chez Qonto, puis synchronisé dans Kledg. Kledg ne pourra pas le retirer de Qonto."
        confirmLabel="Envoyer"
        tone="default"
        onConfirm={() => {
          const target = toConfirm
          setToConfirm(null)
          const item = items.find((i) => i.key === target?.key)
          if (item && target) void attach(item, target.candidate)
        }}
      />
    </Card>
  )
}

interface ReceiptItemProps {
  item: Item
  companyId: string
  canAttach: boolean
  onChange: (change: Partial<Item>) => void
  onMatch: () => void
  onAttach: (candidate: CandidateView) => void
  onExpense: () => void
  onDiscard: () => void
}

function CandidateRow({ candidate, action }: { candidate: CandidateView; action: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm">{candidate.counterpartyName || candidate.label || 'Opération sans libellé'}</span>
        <span className="text-muted-foreground block text-xs">
          <DateDisplay value={candidate.date} /> · {candidate.bankAccountName} · {candidate.reasons.join(', ')}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <Amount value={-candidate.amountCents / 100} sign="always" className="text-sm" />
        {action}
      </span>
    </li>
  )
}

function ReceiptItem({ item, companyId, canAttach, onChange, onMatch, onAttach, onExpense, onDiscard }: ReceiptItemProps) {
  const { state } = item
  const ids = `receipt-${item.key}`
  const editable = state.step === 'form' || state.step === 'error' || state.step === 'result' || state.step === 'matching'
  const filed = state.step === 'attached' || state.step === 'expense'
  const attachButton = (candidate: CandidateView, primary: boolean) =>
    canAttach ? (
      <Button size="xs" variant={primary ? 'default' : 'outline'} disabled={item.busy} onClick={() => onAttach(candidate)}>
        Rattacher
      </Button>
    ) : null

  return (
    <li className="space-y-3 rounded-lg border p-4" aria-busy={item.busy || undefined}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
        {filed ? (
          <StatusBadge tone="success">{state.step === 'attached' ? 'Rattaché' : 'Note de frais'}</StatusBadge>
        ) : (
          <Button size="icon-xs" variant="ghost" aria-label={`Retirer ${item.name}`} title="Retirer" disabled={item.busy} onClick={onDiscard}>
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>

      {state.step === 'uploading' ? <p className="text-muted-foreground text-sm">Dépôt en cours…</p> : null}

      {item.receipt && editable ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
          <Field label="Montant TTC" htmlFor={`${ids}-amount`}>
            <AmountInput id={`${ids}-amount`} value={item.amountCents} onValueChange={(amountCents) => onChange({ amountCents })} />
          </Field>
          <Field label="Date" htmlFor={`${ids}-date`}>
            <DateInput id={`${ids}-date`} value={item.date} onValueChange={(date) => onChange({ date })} />
          </Field>
          <Field label="Commerçant" htmlFor={`${ids}-merchant`} optional>
            <Input id={`${ids}-merchant`} value={item.merchant} autoComplete="off" onChange={(e) => onChange({ merchant: e.target.value })} />
          </Field>
          <Button onClick={onMatch} disabled={item.busy} loading={state.step === 'matching'}>
            Rechercher la transaction
          </Button>
        </div>
      ) : null}

      {state.step === 'matching' ? <p className="text-muted-foreground text-sm">Recherche de la transaction…</p> : null}
      {state.step === 'error' ? (
        <p className="text-destructive text-sm" role="alert">
          {state.message}
        </p>
      ) : null}

      {state.step === 'result' ? (
        <div className="space-y-3">
          {state.result.outcome === 'matched' && state.result.match ? (
            <>
              <p className="text-sm">Transaction trouvée&nbsp;:</p>
              <ul>
                <CandidateRow candidate={state.result.match} action={attachButton(state.result.match, true)} />
              </ul>
            </>
          ) : null}
          {state.result.outcome === 'candidates' ? (
            <>
              <p className="text-sm">Plusieurs transactions peuvent correspondre&nbsp;: choisissez la bonne.</p>
              <ul className="space-y-2">
                {state.result.candidates.map((c) => (
                  <CandidateRow key={c.transactionId} candidate={c} action={attachButton(c, false)} />
                ))}
              </ul>
            </>
          ) : null}
          {state.result.outcome === 'none' ? (
            <p className="text-sm">
              {state.result.reason === 'personal_payment' ? 'Payée personnellement.' : 'Aucune transaction ne correspond.'} Est-ce une note de frais&nbsp;?
            </p>
          ) : null}
          {state.result.outcome === 'attached' || state.result.outcome === 'expense' ? <p className="text-sm">Ce justificatif est déjà classé.</p> : null}
          {state.result.expenseProposal ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={state.result.outcome === 'none' ? 'default' : 'outline'} disabled={item.busy || state.result.expenseProposal.needsEuroAmount} onClick={onExpense}>
                Créer une note de frais
              </Button>
              <span className="text-muted-foreground text-xs">
                {state.result.expenseProposal.categoryLabel}
                {state.result.expenseProposal.openDraft ? `, ajoutée à ${state.result.expenseProposal.openDraft.number}` : ', nouvelle note du mois'}
              </span>
            </div>
          ) : null}
          {!canAttach && (state.result.outcome === 'matched' || state.result.outcome === 'candidates') ? (
            <p className="text-muted-foreground text-xs">Le rattachement est réservé aux membres qui rapprochent la banque.</p>
          ) : null}
        </div>
      ) : null}

      {state.step === 'attached' ? (
        <p className="text-sm">
          {state.toBank ? 'Envoyé à Qonto et rattaché' : 'Rattaché et conservé par Kledg'}
          {state.transaction ? (
            <>
              {' '}à la transaction du <DateDisplay value={state.transaction.date} />.
            </>
          ) : (
            '.'
          )}
        </p>
      ) : null}

      {state.step === 'expense' ? (
        <p className="text-sm">
          {state.report.created ? 'Note de frais' : 'Ligne ajoutée à la note de frais'} {state.report.number} en brouillon&nbsp;:{' '}
          <Link className="text-link underline-offset-4 hover:underline" href={`/${companyId}/expense-reports/${state.report.reportId}`}>
            vérifiez-la et soumettez-la
          </Link>
          .
        </p>
      ) : null}
    </li>
  )
}
