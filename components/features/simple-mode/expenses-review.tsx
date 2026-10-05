'use client'

import * as React from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, Paperclip, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, EmptyState, PageHeader, formatAmount, formatDisplayDate } from '@/components/shared'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { responseError } from '@/hooks/use-cursor-list'
import { cn } from '@/lib/utils'
import { findCategory } from '@/lib/simple/categories'
import type { Answers } from '@/lib/simple/posting'
import type { ExpenseToReview, ExpensesToReview } from '@/lib/simple/expenses-to-review.service'
import type { ConfirmAllResult, ConfirmResult } from '@/lib/simple/confirm-expense.service'
import { CategoryDialog, type CategoryChoice } from './category-dialog'

/** Event that makes the simple navigation reload its counts (components/layout/app-sidebar.tsx). */
const COUNTS_REFRESH_EVENT = 'simple:counts-refresh'

type Side = 'debit' | 'credit'

/** The words of each page: money out (Dépenses à vérifier), money in (Recettes à vérifier). */
const COPY = {
  debit: {
    title: 'Dépenses à vérifier',
    description: "Kledg a reconnu ces paiements. Confirmez d'un clic, ou corrigez la catégorie.",
    column: 'Paiement',
    loadError: 'Les dépenses ne se sont pas chargées. Réessayez dans un instant.',
    loadErrorTitle: 'Les dépenses ne se sont pas chargées',
    confirmError: "La dépense n'a pas été classée. Réessayez dans un instant.",
    confirmAllError: "Les dépenses n'ont pas été classées. Réessayez dans un instant.",
    denied: 'classer les dépenses',
    emptyDescription: 'Aucune dépense à vérifier pour le moment. Les nouveaux paiements apparaîtront ici après la synchronisation de votre banque.',
    sent: 'Dépense envoyée à votre comptable',
    done: 'Dépense classée',
    many: (n: number) => (n > 1 ? `${n} dépenses classées` : '1 dépense classée'),
    shown: (shown: number, count: number) => `${shown} dépenses affichées sur ${count}. Les suivantes apparaîtront une fois celles-ci classées.`,
    things: 'ces dépenses',
    undone: 'Dépense remise à vérifier',
    undoError: "La confirmation n'a pas été annulée. Réessayez dans un instant.",
  },
  credit: {
    title: 'Recettes à vérifier',
    description: "L'argent reçu sur vos comptes. Kledg retrouve la facture payée ou propose une catégorie : confirmez d'un clic, ou corrigez.",
    column: 'Versement',
    loadError: 'Les recettes ne se sont pas chargées. Réessayez dans un instant.',
    loadErrorTitle: 'Les recettes ne se sont pas chargées',
    confirmError: "La recette n'a pas été classée. Réessayez dans un instant.",
    confirmAllError: "Les recettes n'ont pas été classées. Réessayez dans un instant.",
    denied: 'classer les recettes',
    emptyDescription: "Aucune recette à identifier pour le moment. L'argent reçu apparaîtra ici après la synchronisation de votre banque.",
    sent: 'Recette envoyée à votre comptable',
    done: 'Recette classée',
    many: (n: number) => (n > 1 ? `${n} recettes classées` : '1 recette classée'),
    shown: (shown: number, count: number) => `${shown} recettes affichées sur ${count}. Les suivantes apparaîtront une fois celles-ci classées.`,
    things: 'ces recettes',
    undone: 'Recette remise à vérifier',
    undoError: "La confirmation n'a pas été annulée. Réessayez dans un instant.",
  },
} as const

const GRID = 'lg:grid lg:grid-cols-[6.5rem_minmax(0,2fr)_minmax(0,2.2fr)_7.5rem_11rem] lg:gap-4 lg:items-center'

function names(list: Array<{ name: string }>): string {
  const all = list.map((a) => a.name)
  return all.length <= 1 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} et ${all[all.length - 1]}`
}

/** The line under the table: where confirmed lines go. */
function ReviewNotice({ review, things }: { review: ExpensesToReview['review']; things: string }) {
  const text = review.accountantReview
    ? review.accountants.length > 0
      ? `Une fois confirmées, ${things} sont envoyées à ${names(review.accountants)}, ${review.accountants.length > 1 ? 'vos experts-comptables' : 'votre expert-comptable'}, pour validation.`
      : `Une fois confirmées, ${things} sont envoyées à votre expert-comptable pour validation.`
    : `Une fois confirmées, ${things} sont enregistrées dans vos comptes.`
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-sm">
      <ShieldCheck aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
      <span>{text}</span>
    </p>
  )
}

/** What the user is told once a line is confirmed. */
function confirmedMessage(result: ConfirmResult, side: Side): string {
  const invoice = result.invoice
  if (invoice) {
    if (!invoice.recorded) {
      const sent = result.status === 'draft' ? `Paiement de la facture n°\u00a0${invoice.number} envoyé à votre comptable.` : `${COPY[side].done}.`
      return `${sent} ${invoice.pending ?? ''}`.trim()
    }
    if (invoice.lettered || invoice.remainingCents === 0) return `Facture n°\u00a0${invoice.number} payée.`
    return `Paiement enregistré sur la facture n°\u00a0${invoice.number}, reste ${formatAmount((invoice.remainingCents ?? 0) / 100)} à payer.`
  }
  const rule = result.learnedRule ? ` Kledg classera désormais « ${result.learnedRule.name.replace(/ \(mode simple\)$/, '')} » de la même façon.` : ''
  const asset = result.fixedAsset ? ` Son coût sera étalé sur ${result.fixedAsset.years} an${result.fixedAsset.years > 1 ? 's' : ''}.` : ''
  return `${result.needsReview ? COPY[side].sent : COPY[side].done}.${asset}${rule}`
}

/**
 * "Dépenses à vérifier" and "Recettes à vérifier" of simple mode
 * (docs/categories-simples.md): each bank line not yet classified, money
 * out or money in, with what Kledg proposes and why: a category, or for
 * money in the sales invoice it pays. "Confirmer" confirms it, "Modifier" (or "Choisir la catégorie" when nothing is proposed) picks
 * another category, a question is answered in one click, "Tout confirmer"
 * confirms the sure ones.
 */
export function ExpensesReview({ companyId, side = 'debit' }: { companyId: string; side?: Side }) {
  const copy = COPY[side]
  const { can, denied } = useCompanyAccess()
  const canConfirm = can({ banking: ['reconcile'] }) && can({ entries: ['create'] })
  const [data, setData] = React.useState<ExpensesToReview | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)
  const [answered, setAnswered] = React.useState(-1)
  const loading = answered !== version
  const [notes, setNotes] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = React.useState(false)
  const [editing, setEditing] = React.useState<ExpenseToReview | null>(null)

  React.useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/simple/expenses?${new URLSearchParams({ companyId, side })}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await responseError(response, copy.loadError))
        return response.json() as Promise<ExpensesToReview>
      })
      .then((list) => {
        if (cancelled) return
        setData(list)
        setError(null)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setAnswered(version))
    return () => {
      cancelled = true
    }
  }, [companyId, version, side, copy.loadError])

  const setBusyFor = (id: string, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const remove = (ids: string[]) => {
    window.dispatchEvent(new Event(COUNTS_REFRESH_EVENT))
    setData((current) =>
      current
        ? {
            ...current,
            items: current.items.filter((i) => !ids.includes(i.id)),
            count: Math.max(0, current.count - ids.length),
            bulkConfirmableIds: current.bulkConfirmableIds.filter((id) => !ids.includes(id)),
          }
        : current,
    )
  }

  /**
   * "Annuler" in the toast of a confirmation left as a draft: the
   * reconciliation is undone through DELETE /api/transactions/[id]/reconcile
   * (same permission, audit log), which deletes the draft entry with its
   * simple mode record and fixed asset, and the line comes back to review.
   * A validated entry is definitive (PCG art. 1031-3): no undo is offered.
   */
  const undo = async (result: ConfirmResult) => {
    try {
      const response = await fetch(`/api/transactions/${encodeURIComponent(result.transactionId)}/reconcile`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await responseError(response, copy.undoError))
      toast.success(copy.undone)
      window.dispatchEvent(new Event(COUNTS_REFRESH_EVENT))
      setVersion((v) => v + 1)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const toastFor = (result: ConfirmResult) => {
    const message = confirmedMessage(result, side)
    if (result.status === 'draft') toast.success(message, { action: { label: 'Annuler', onClick: () => void undo(result) } })
    else toast.success(message)
  }

  const confirm = async (expense: ExpenseToReview, body: { categoryId?: string; ruleId?: string; invoiceId?: string; answers?: Answers; note?: string }) => {
    setBusyFor(expense.id, true)
    try {
      const response = await fetch(`/api/simple/expenses/${encodeURIComponent(expense.id)}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await responseError(response, copy.confirmError))
      toastFor((await response.json()) as ConfirmResult)
      remove([expense.id])
      setEditing(null)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyFor(expense.id, false)
    }
  }

  const confirmSuggestion = (expense: ExpenseToReview, answers: Answers = expense.suggestion.answers) => {
    const note = notes[expense.id]?.trim() || undefined
    const s = expense.suggestion
    if (s.invoice) return confirm(expense, { invoiceId: s.invoice.invoiceId, note })
    return confirm(expense, s.ruleId ? { ruleId: s.ruleId, categoryId: s.categoryId ?? undefined, note } : { categoryId: s.categoryId ?? undefined, answers, note })
  }

  const confirmChoice = (expense: ExpenseToReview, choice: CategoryChoice) =>
    confirm(expense, { categoryId: choice.categoryId, answers: choice.answers, note: choice.note.trim() || undefined })

  const confirmAll = async () => {
    if (!data) return
    setBulkBusy(true)
    try {
      const response = await fetch('/api/simple/expenses/confirm-all', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ companyId, transactionIds: data.bulkConfirmableIds }),
      })
      if (!response.ok) throw new Error(await responseError(response, copy.confirmAllError))
      const result = (await response.json()) as ConfirmAllResult
      remove(result.confirmed.map((r) => r.transactionId))
      const n = result.confirmed.length
      if (n > 0) toast.success(copy.many(n))
      if (result.skipped.length > 0) toast.info(`${result.skipped.length} à vérifier une par une.`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBulkBusy(false)
    }
  }

  const sendReceipt = async (expense: ExpenseToReview, file: File) => {
    const form = new FormData()
    form.set('file', file)
    try {
      const response = await fetch(`/api/simple/expenses/${encodeURIComponent(expense.id)}/receipt`, { method: 'POST', body: form })
      if (!response.ok) throw new Error(await responseError(response, "Le justificatif n'a pas été envoyé. Réessayez dans un instant."))
      toast.success('Justificatif envoyé')
      setData((current) => (current ? { ...current, items: current.items.map((i) => (i.id === expense.id ? { ...i, hasReceipt: true } : i)) } : current))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const bulkCount = data?.bulkConfirmableIds.length ?? 0

  return (
    // The company layout already pads the page: no padding of its own, like every other page
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href={`/${companyId}/simple`} className="text-link inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline">
          <ArrowLeft aria-hidden className="size-3.5" />
          Accueil
        </Link>
        <PageHeader
          title={copy.title}
          description={copy.description}
          actions={
            // Only when there is something to confirm at once: a disabled "Tout confirmer (0)" was the loudest thing on the page
            bulkCount > 0 ? (
              <Button onClick={confirmAll} loading={bulkBusy} disabled={!canConfirm}>
                Tout confirmer ({bulkCount})
              </Button>
            ) : undefined
          }
        />
      </div>
      {!canConfirm ? <AccessNotice>{denied(copy.denied)}</AccessNotice> : null}

      {error ? (
        <Card className="px-5 py-5">
          <EmptyState
            title={copy.loadErrorTitle}
            description={error}
            action={
              <Button size="sm" variant="outline" onClick={() => setVersion((v) => v + 1)}>
                Réessayer
              </Button>
            }
          />
        </Card>
      ) : loading && !data ? (
        <Card className="space-y-3 px-5 py-5" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </Card>
      ) : data && data.items.length === 0 ? (
        <EmptyState
          bordered
          tone="success"
          icon={CheckCircle2}
          title="Tout est vérifié"
          description={copy.emptyDescription}
        />
      ) : data ? (
        <Card className="gap-0 overflow-hidden py-0">
          <div className={cn(GRID, 'text-muted-foreground hidden border-b px-5 py-3 text-xs')} aria-hidden>
            <div>Date</div>
            <div>{copy.column}</div>
            <div>Catégorie proposée</div>
            <div className="text-right">Montant</div>
            <div />
          </div>
          <ul>
            {data.items.map((expense) => (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                note={notes[expense.id] ?? ''}
                onNote={(value) => setNotes((current) => ({ ...current, [expense.id]: value }))}
                busy={busy.has(expense.id)}
                canConfirm={canConfirm}
                onConfirm={(answers) => confirmSuggestion(expense, answers)}
                onEdit={() => setEditing(expense)}
              />
            ))}
          </ul>
          {data.count > data.items.length ? (
            <p className="text-muted-foreground border-t px-5 py-3 text-sm">
              {copy.shown(data.items.length, data.count)}
            </p>
          ) : null}
        </Card>
      ) : null}

      {data ? <ReviewNotice review={data.review} things={copy.things} /> : null}

      {side === 'credit' ? (
        <p className="text-muted-foreground text-sm">
          Vos factures de vente, payées ou à encaisser, sont dans{' '}
          <Link href={`/${companyId}/invoices/sales`} className="text-link underline-offset-4 hover:underline">
            Factures de vente
          </Link>
          .
        </p>
      ) : null}

      <CategoryDialog
        expense={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onConfirm={confirmChoice}
        onReceipt={sendReceipt}
        initialNote={editing ? (notes[editing.id] ?? '') : ''}
        busy={editing ? busy.has(editing.id) : false}
      />
    </div>
  )
}

interface ExpenseRowProps {
  expense: ExpenseToReview
  note: string
  onNote: (value: string) => void
  busy: boolean
  canConfirm: boolean
  onConfirm: (answers?: Answers) => void
  onEdit: () => void
}

function ExpenseRow({ expense, note, onNote, busy, canConfirm, onConfirm, onEdit }: ExpenseRowProps) {
  const s = expense.suggestion
  const category = findCategory(s.categoryId)
  const label = s.invoice ? `Facture n°\u00a0${s.invoice.number}, ${s.invoice.customerName}` : (category?.label ?? (s.ruleName ? s.ruleName : 'À classer'))
  const question = s.pendingQuestion
  const blocked = Boolean(expense.blockedReason)
  const classified = Boolean(s.categoryId || s.ruleId || s.invoice)
  const noteId = `note-${expense.id}`

  return (
    <li className={cn('space-y-3 border-b px-5 py-4 last:border-b-0', question && 'bg-warning/5')}>
      <div className={cn(GRID, 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2')}>
        <div className="text-muted-foreground text-sm lg:order-none">{formatDisplayDate(expense.date, 'short')}</div>
        <div className="num text-right lg:order-4 lg:hidden">
          <Amount value={expense.amountCents / 100} />
        </div>
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <div className="truncate font-medium">{expense.name}</div>
          {expense.label && expense.label !== expense.name ? <div className="text-muted-foreground truncate text-sm">{expense.label}</div> : null}
        </div>
        <div className="col-span-2 min-w-0 lg:col-span-1">
          <span
            className={cn(
              'inline-flex max-w-full items-center truncate rounded-full px-3 py-1 text-sm',
              question ? 'border-warning text-warning border border-dashed' : classified ? 'bg-muted' : 'text-muted-foreground border border-dashed',
            )}
          >
            {question ? `${label} ?` : label}
          </span>
          <div className={cn('mt-1.5 text-xs', question ? 'text-warning' : 'text-muted-foreground')}>
            {blocked ? expense.blockedReason : category?.notePrompt && !question ? category.notePrompt : s.reason}
          </div>
        </div>
        <div className="num hidden text-right lg:block">
          <Amount value={expense.amountCents / 100} />
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2 lg:col-span-1">
          {expense.hasReceipt ? <Paperclip role="img" aria-label="Justificatif joint" className="text-muted-foreground size-4" /> : null}
          {question ? null : classified ? (
            <>
              <Button size="sm" variant="outline" onClick={onEdit} disabled={!canConfirm || blocked || busy}>
                Modifier
              </Button>
              <Button size="sm" onClick={() => onConfirm()} loading={busy} disabled={!canConfirm || blocked}>
                Confirmer
              </Button>
            </>
          ) : (
            // Nothing proposed: choosing the category is the one thing to do, so it is the primary action
            <Button size="sm" onClick={onEdit} disabled={!canConfirm || blocked || busy}>
              Choisir la catégorie
            </Button>
          )}
        </div>
      </div>

      {question ? (
        <div className="flex flex-wrap items-center gap-3 lg:ml-[7.5rem]">
          <span className="text-sm">{question.text}</span>
          {question.answers.map((a) => (
            <Button key={a.id} size="sm" variant="outline" disabled={!canConfirm || blocked || busy} onClick={() => onConfirm({ ...s.answers, [question.id]: a.id })}>
              {a.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={onEdit} disabled={!canConfirm || blocked || busy}>
            Autre catégorie
          </Button>
          <p className="text-muted-foreground basis-full text-xs">{question.help}</p>
        </div>
      ) : null}

      {category?.notePrompt && !question ? (
        <div className="lg:ml-[7.5rem] lg:max-w-md">
          <label htmlFor={noteId} className="sr-only">
            Note pour votre comptable
          </label>
          <Input id={noteId} value={note} onChange={(e) => onNote(e.target.value)} maxLength={1000} placeholder="ex. avec Claire Martin, Studio Nord" />
        </div>
      ) : null}
    </li>
  )
}
