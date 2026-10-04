/**
 * "Traiter la transaction" dialog: the entry that reconciles a bank
 * transaction, prefilled from a rule or from the counterparty's history, with
 * "Enregistrer et suivant" to work through the unreconciled transactions.
 */

'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, Plus, Undo2 } from 'lucide-react'
import { logger } from '@/lib/logger'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatAmount } from '@/components/shared/amount'
import { formatIsoDateFr } from '@/lib/utils/date'
import type { ReconciliationContext } from '@/lib/reconciliation/types'
import {
  EntryFormReconciliation,
  type ReconciliationAccount,
  savedEntryLabel,
  type ReconciliationSaved,
} from './entry-form-reconciliation'

interface Journal {
  id: string
  code: string
  label: string
}

interface TransactionSuggestionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  /** Transaction shown in the dialog. */
  transactionId: string | null
  /** Ids of the transactions still to process, in the order of the list. */
  queue: string[]
  journals: Journal[]
  onNavigate: (transactionId: string) => void
  /** Saved: the parent refreshes the list and offers to undo. */
  onSaved: (transactionId: string, saved: ReconciliationSaved) => void
  /** The transaction was reconciled meanwhile: the parent refreshes the list. */
  onConflict: (transactionId: string, message: string) => void
  /** Undoes a reconciliation; resolves to whether it worked. */
  onUndo: (transactionId: string) => Promise<boolean>
}

type Loaded = { id: string; context: ReconciliationContext } | { id: string; error: string }

export function TransactionSuggestionDialog({
  open,
  onOpenChange,
  companyId,
  transactionId,
  queue,
  journals,
  onNavigate,
  onSaved,
  onConflict,
  onUndo,
}: TransactionSuggestionDialogProps) {
  const router = useRouter()
  const [loaded, setLoaded] = React.useState<Loaded | null>(null)
  const [done, setDone] = React.useState<Set<string>>(() => new Set())
  // Last transaction saved from this dialog: undoable here, since toasts are not clickable over a modal
  const [lastSaved, setLastSaved] = React.useState<{ transactionId: string; saved: ReconciliationSaved; label: string } | null>(null)
  const [undoing, setUndoing] = React.useState(false)
  const [accounts, setAccounts] = React.useState<Record<string, ReconciliationAccount[]>>({})
  const requested = React.useRef(new Set<string>())

  React.useEffect(() => {
    if (!open || !transactionId) return
    let cancelled = false
    fetch(`/api/transactions/${transactionId}/reconcile`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (cancelled) return
        if (!response.ok) setLoaded({ id: transactionId, error: data.error ?? 'Impossible de charger la transaction.' })
        else setLoaded({ id: transactionId, context: data as ReconciliationContext })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: transactionId, error: 'Connexion impossible\u00a0: vérifiez votre réseau puis réessayez.' })
      })
    return () => {
      cancelled = true
    }
  }, [open, transactionId])

  const loadAccounts = React.useCallback(
    (fiscalYearId: string) => {
      if (requested.current.has(fiscalYearId)) return
      requested.current.add(fiscalYearId)
      fetch(`/api/accounts?companyId=${encodeURIComponent(companyId)}&fiscalYearId=${encodeURIComponent(fiscalYearId)}`)
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((data) => {
          const list = (Array.isArray(data) ? data : (data.accounts ?? [])) as ReconciliationAccount[]
          setAccounts((current) => ({ ...current, [fiscalYearId]: list }))
        })
        .catch((error) => {
          requested.current.delete(fiscalYearId)
          logger.error('Error loading accounts:', error)
          toast.error('Erreur lors du chargement du plan comptable')
        })
    },
    [companyId],
  )
  const accountsFor = React.useCallback((fiscalYearId: string) => accounts[fiscalYearId], [accounts])

  const remaining = queue.filter((id) => !done.has(id) && id !== transactionId)
  const position = transactionId ? queue.indexOf(transactionId) : -1
  const nextId = (() => {
    const after = queue.slice(position + 1).find((id) => !done.has(id) && id !== transactionId)
    return after ?? remaining[0] ?? null
  })()

  const handleOpenChange = (next: boolean) => {
    // Reopening shows fresh data, not the last form
    if (!next) {
      setLoaded(null)
      setLastSaved(null)
    }
    onOpenChange(next)
  }

  const undoLastSaved = async () => {
    if (!lastSaved || undoing) return
    setUndoing(true)
    const undone = await onUndo(lastSaved.transactionId)
    setUndoing(false)
    if (!undone) return
    const { transactionId: undoneId } = lastSaved
    setLastSaved(null)
    setDone((d) => {
      const next = new Set(d)
      next.delete(undoneId)
      return next
    })
    // Back to the transaction, to enter it again
    onNavigate(undoneId)
  }

  const moveOn = (goToNext: boolean) => {
    if (goToNext && nextId) onNavigate(nextId)
    else handleOpenChange(false)
  }

  const handleCreateRule = async () => {
    if (!transactionId) return
    try {
      const response = await fetch(`/api/transactions/${transactionId}/create-rule`)
      if (!response.ok) throw new Error('Erreur lors de la récupération des données')
      const data = await response.json()
      const params = new URLSearchParams({
        fromTransaction: transactionId,
        ...(data.suggestedName && { ruleName: data.suggestedName }),
        ...(data.suggestedConditions && { conditions: JSON.stringify(data.suggestedConditions) }),
        ...(data.suggestedEntryLines && { entryLines: JSON.stringify(data.suggestedEntryLines) }),
      })
      router.push(`/${companyId}/rules?${params.toString()}`)
    } catch (error) {
      logger.error('Error creating rule:', error)
      toast.error(error instanceof Error ? error.message : 'Erreur lors de la création de la règle')
    }
  }

  const current = loaded && loaded.id === transactionId ? loaded : null
  const context = current && 'context' in current ? current.context : null
  const tx = context?.transaction

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Traiter la transaction</DialogTitle>
          <DialogDescription>
            Saisissez l&apos;écriture de contrepartie&nbsp;: la ligne bancaire est fixée par la transaction.
            {position >= 0 && queue.length > 1 && ` Transaction ${position + 1} sur ${queue.length}.`}
          </DialogDescription>
        </DialogHeader>

        {!current ? (
          <div className="flex items-center justify-center py-10" role="status" aria-label="Chargement">
            <Loader2 aria-hidden className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : 'error' in current ? (
          <Alert variant="destructive">
            <AlertDescription>{current.error}</AlertDescription>
          </Alert>
        ) : context && tx ? (
          <div className="space-y-5">
            {lastSaved && lastSaved.transactionId !== tx.id && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {savedEntryLabel(lastSaved.saved)} pour « {lastSaved.label} ».
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={undoLastSaved} loading={undoing}>
                    <Undo2 aria-hidden />
                    Annuler le rapprochement
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="grid gap-x-6 gap-y-1 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Date&nbsp;: </span>
                {formatIsoDateFr(tx.date)}
              </div>
              <div>
                <span className="text-muted-foreground">Montant&nbsp;: </span>
                <span className="num font-medium">
                  {formatAmount((tx.side === 'debit' ? -tx.amountCents : tx.amountCents) / 100, { sign: 'always' })}
                </span>
                {tx.vatAmountCents != null && (
                  <span className="text-muted-foreground">
                    {' '}
                    (TVA détectée par la banque&nbsp;: {formatAmount(tx.vatAmountCents / 100)}
                    {tx.vatRatePercent != null && `, ${String(tx.vatRatePercent).replace('.', ',')} %`})
                  </span>
                )}
              </div>
              <div className="truncate">
                <span className="text-muted-foreground">Libellé&nbsp;: </span>
                {tx.label || '-'}
              </div>
              <div className="truncate">
                <span className="text-muted-foreground">Contrepartie&nbsp;: </span>
                {tx.counterpartyName || '-'}
              </div>
            </div>

            {tx.reconciled ? (
              <Alert>
                <AlertDescription>Cette transaction est déjà rapprochée.</AlertDescription>
              </Alert>
            ) : (
              <EntryFormReconciliation
                key={tx.id}
                context={context}
                journals={journals}
                accountsFor={accountsFor}
                loadAccounts={loadAccounts}
                hasNext={nextId !== null}
                onCancel={() => handleOpenChange(false)}
                onSaved={(saved, goToNext) => {
                  setDone((d) => new Set(d).add(tx.id))
                  setLastSaved({
                    transactionId: tx.id,
                    saved,
                    label: tx.counterpartyName || tx.label || 'Transaction',
                  })
                  onSaved(tx.id, saved)
                  moveOn(goToNext)
                }}
                onConflict={(message) => {
                  setDone((d) => new Set(d).add(tx.id))
                  onConflict(tx.id, message)
                  moveOn(true)
                }}
              />
            )}

            <div className="flex justify-start border-t pt-4">
              <Button type="button" variant="ghost" size="sm" className="max-w-full whitespace-normal" onClick={handleCreateRule}>
                <Plus aria-hidden />
                Créer une règle à partir de cette transaction
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
