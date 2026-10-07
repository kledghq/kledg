'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { CheckCircle2, ExternalLink, Workflow } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { NoCompanySelected } from '@/components/features/companies/no-company-selected'
import { TransactionSuggestionDialog } from '@/components/features/accounting/transaction-suggestion-dialog'
import { FiscalYearSelector } from '@/components/features/accounting/fiscal-year-selector'
import { JustificatifPreviewDialog } from '@/components/features/justificatifs/justificatif-preview-dialog'
import {
  ReconciliationQueue,
  ReconciliationQueueSkeleton,
  signedAmount,
  type QueueAttachment,
  type QueueTransaction,
} from '@/components/features/reconciliation/reconciliation-queue'
import { Amount, ConfirmDeleteDialog, DateDisplay, EmptyState, PageHeader, SyncButton } from '@/components/shared'
import { OnboardingEmptyState } from '@/components/features/onboarding/onboarding-empty-state'
import { bankAccountName } from '@/components/features/banking/format'
import { AccessNotice, useCompanyAccess } from '@/components/features/companies/company-access'
import { savedEntryLabel, type ReconciliationSaved } from '@/components/features/accounting/entry-form-reconciliation'
import { docsUrl } from '@/lib/docs-links'
import { logger } from '@/lib/logger'
import { plural, pluralWord } from '@/lib/utils/plural'
import { useCompactLayout } from '@/hooks/ui/use-media-query'

interface BankTransaction extends QueueTransaction {
  reference: string | null
  reconciled: boolean
  reconciledAt?: string | null
  reconciledWith?: string | null
  /** Provider id of the transaction, used to fetch its attachments. */
  transactionUuid?: string | null
  externalTransactionId?: string | null
  bankAccount: {
    id: string
    name: string
    displayName: string | null
    iban: string | null
  }
}

interface AccountingEntry {
  id: string
  entryNumber: string
  /** "draft" until validation: a draft has no definitive number yet. */
  status: string
  date: string
  description: string | null
  journal: { code: string; label: string }
  totalDebit: number
  totalCredit: number
}

interface RuleSummary {
  id: string
  enabled: boolean
}

interface PreviewTarget {
  attachment: QueueAttachment
  transactionUuid: string
}

interface ExecuteResults {
  processed: number
  matched: number
  applied: number
  errors?: Array<{ transactionId: string; error: string }>
}

/** Period bounds sent to the API: whole calendar days of the fiscal year. */
function periodParams(start?: string, end?: string): Record<string, string> {
  return start && end ? { startDate: `${start}T00:00:00.000Z`, endDate: `${end}T23:59:59.999Z` } : {}
}

function transactionTitle(transaction: BankTransaction): string {
  return transaction.counterpartyName || transaction.label || transaction.reference || 'Transaction'
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const data = (await response.json().catch(() => null)) as { error?: string } | null
  return data?.error || fallback
}

export default function ReconciliationPage() {
  const params = useParams()
  const companyId = params?.companyId as string
  const { can, denied } = useCompanyAccess()
  const canReconcile = can({ banking: ['reconcile'] })
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState<BankTransaction[]>([])
  const [accountingEntries, setAccountingEntries] = useState<AccountingEntry[]>([])
  const [rules, setRules] = useState<RuleSummary[]>([])
  const [journals, setJournals] = useState<Array<{ id: string; code: string; label: string }>>([])
  const [dialogTransactionId, setDialogTransactionId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [undoTarget, setUndoTarget] = useState<BankTransaction | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [autoReconciling, setAutoReconciling] = useState(false)
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const [selectedFiscalYearId, setSelectedFiscalYearId] = useState<string | undefined>(undefined)
  const [period, setPeriod] = useState<{ start?: string; end?: string }>({})
  const [applyingRuleKey, setApplyingRuleKey] = useState<string | null>(null)
  // Phones and small tablets: the two tables below the queue become stacked lists.
  const compact = useCompactLayout()

  const loadData = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const transactionParams = new URLSearchParams({
        companyId,
        includeSuggestions: 'true',
        ...periodParams(period.start, period.end),
      })
      // The bank accounts and entries come from /api/banking/reconciliation,
      // without its copy of the transactions.
      const reconciliationParams = new URLSearchParams({ companyId, includeTransactions: 'false' })
      const [transactionResponse, reconciliationResponse] = await Promise.all([
        fetch(`/api/transactions?${transactionParams}`),
        fetch(`/api/banking/reconciliation?${reconciliationParams}`),
      ])
      if (transactionResponse.ok) {
        const data = (await transactionResponse.json()) as { transactions?: BankTransaction[] }
        setTransactions(data.transactions ?? [])
      } else {
        toast.error(await errorMessage(transactionResponse, 'Les transactions ne se sont pas chargées. Rechargez la page.'))
      }
      if (reconciliationResponse.ok) {
        const data = (await reconciliationResponse.json()) as { accountingEntries?: AccountingEntry[] }
        setAccountingEntries(data.accountingEntries ?? [])
      }
    } catch (error) {
      logger.error('Error loading reconciliation data:', error)
      toast.error('Les transactions ne se sont pas chargées. Vérifiez votre connexion et rechargez la page.')
    } finally {
      setLoading(false)
    }
  }, [companyId, period.start, period.end])

  const loadRules = useCallback(async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/transaction-rules?companyId=${companyId}`)
      if (response.ok) {
        const data = (await response.json()) as { rules?: RuleSummary[] }
        setRules(data.rules ?? [])
      }
    } catch (error) {
      logger.error('Error loading rules:', error)
    }
  }, [companyId])

  const loadJournals = useCallback(async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/journals?companyId=${companyId}`)
      if (response.ok) {
        const data: unknown = await response.json()
        setJournals(Array.isArray(data) ? data : [])
      }
    } catch (error) {
      logger.error('Error loading journals:', error)
    }
  }, [companyId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    void loadRules()
    void loadJournals()
  }, [loadRules, loadJournals])

  // Dates of the selected fiscal year bound the transactions shown.
  useEffect(() => {
    if (!selectedFiscalYearId || !companyId) return
    let cancelled = false
    fetch(`/api/companies/${companyId}/fiscal-years/${selectedFiscalYearId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((fiscalYear: { startDate?: string; endDate?: string } | null) => {
        if (cancelled || !fiscalYear?.startDate || !fiscalYear.endDate) return
        setPeriod({ start: fiscalYear.startDate.slice(0, 10), end: fiscalYear.endDate.slice(0, 10) })
      })
      .catch((error) => logger.error('Error loading fiscal year:', error))
    return () => {
      cancelled = true
    }
  }, [selectedFiscalYearId, companyId])

  const handleAutoReconcile = async () => {
    if (!companyId) return
    setAutoReconciling(true)
    try {
      const response = await fetch('/api/banking/reconciliation/auto-reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, ...periodParams(period.start, period.end) }),
      })
      if (!response.ok) {
        toast.error(await errorMessage(response, 'Le rapprochement automatique a échoué. Réessayez.'))
        return
      }
      const data = (await response.json()) as {
        success?: boolean
        message?: string
        reconciledCount: number
        unreconciledOrphanedCount: number
        total?: number
      }
      await loadData()
      // Some entries could not be processed: say so instead of a plain count
      if (data.success === false) {
        toast.error(data.message || 'Le rapprochement automatique a échoué. Réessayez.')
        return
      }
      if (data.unreconciledOrphanedCount > 0) {
        toast.warning(
          `${plural(data.unreconciledOrphanedCount, 'transaction')} à traiter de nouveau\u00a0: ${pluralWord(data.unreconciledOrphanedCount, 'son écriture a été supprimée ou n\'est plus liée', 'leur écriture a été supprimée ou n\'est plus liée')}.`,
        )
      }
      if (data.reconciledCount > 0) {
        toast.success(`${plural(data.reconciledCount, 'transaction rapprochée', 'transactions rapprochées')} sur ${plural(data.total ?? 0, 'écriture analysée', 'écritures analysées')}`)
      } else if ((data.total ?? 0) > 0 && data.unreconciledOrphanedCount === 0) {
        toast.info(`Aucune transaction rapprochée sur ${plural(data.total ?? 0, 'écriture analysée', 'écritures analysées')}`)
      } else if (data.unreconciledOrphanedCount === 0) {
        toast.info('Aucune écriture bancaire à rapprocher sur la période')
      }
    } catch (error) {
      logger.error('Error auto-reconciling:', error)
      toast.error('Le rapprochement automatique a échoué. Réessayez.')
    } finally {
      setAutoReconciling(false)
    }
  }

  /** Undoes a reconciliation: deletes the draft entry it created (refused once validated). */
  const unreconcile = async (transactionId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/transactions/${transactionId}/reconcile`, { method: 'DELETE' })
      const data = (await response.json().catch(() => ({}))) as { error?: string; deletedEntryId?: string }
      if (!response.ok) {
        toast.error(data.error || "Le rapprochement n'a pas été annulé. Réessayez.")
        if (response.status === 409) void loadData()
        return false
      }
      toast.success(data.deletedEntryId ? 'Rapprochement annulé, écriture brouillon supprimée' : 'Rapprochement annulé')
      void loadData()
      return true
    } catch (error) {
      logger.error('Error unreconciling:', error)
      toast.error("Le rapprochement n'a pas été annulé. Réessayez.")
      return false
    }
  }

  const confirmUndo = async () => {
    if (!undoTarget) return
    setUndoing(true)
    await unreconcile(undoTarget.id)
    setUndoing(false)
    setUndoTarget(null)
  }

  const handleApplyAllRules = async () => {
    if (!companyId) return
    setExecuting(true)
    try {
      const response = await fetch('/api/transaction-rules/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, autoApply: true }),
      })
      if (!response.ok) {
        toast.error(await errorMessage(response, "Les règles d'affectation n'ont pas été appliquées. Réessayez."))
        return
      }
      const { results } = (await response.json()) as { results: ExecuteResults }
      toast.success(
        results.applied > 0
          ? `${plural(results.applied, 'écriture créée', 'écritures créées')} en brouillon par les règles sur ${plural(results.processed, 'transaction analysée', 'transactions analysées')}`
          : `Aucune règle active ne correspond ${results.processed === 1 ? 'à la transaction' : `aux ${results.processed} transactions`} à traiter`,
      )
      const failed = results.errors ?? []
      if (failed.length > 0) {
        toast.warning(`${plural(failed.length, 'règle')} ${pluralWord(failed.length, "n'a pas pu être appliquée", "n'ont pas pu être appliquées")}`, {
          description: failed[0].error,
          duration: 8000,
        })
      }
      void loadData()
    } catch (error) {
      logger.error('Error applying rules:', error)
      toast.error("Les règles d'affectation n'ont pas été appliquées. Réessayez.")
    } finally {
      setExecuting(false)
    }
  }

  const handleApplyRule = async (transaction: QueueTransaction, ruleId: string) => {
    if (!companyId) return
    setApplyingRuleKey(`${transaction.id}:${ruleId}`)
    try {
      const response = await fetch(`/api/transactions/${transaction.id}/apply-rule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleId, companyId }),
      })
      if (response.ok) {
        toast.success('Écriture créée, transaction rapprochée')
        void loadData()
      } else {
        toast.error(await errorMessage(response, "La règle n'a pas été appliquée. Réessayez."))
        if (response.status === 409) void loadData()
      }
    } catch (error) {
      logger.error('Error applying rule:', error)
      toast.error("La règle n'a pas été appliquée. Réessayez.")
    } finally {
      setApplyingRuleKey(null)
    }
  }

  const handlePreviewAttachment = (transaction: QueueTransaction, attachment: QueueAttachment) => {
    const full = transactions.find((t) => t.id === transaction.id)
    const transactionUuid = full?.transactionUuid || full?.externalTransactionId
    if (!transactionUuid) {
      toast.error("Ce justificatif n'est pas disponible\u00a0: la transaction n'a pas d'identifiant bancaire.")
      return
    }
    setPreview({ attachment, transactionUuid })
  }

  const openDialog = (transaction: QueueTransaction) => {
    setDialogTransactionId(transaction.id)
    setDialogOpen(true)
  }

  const handleSaved = (transactionId: string, saved: ReconciliationSaved) => {
    toast.success(`${savedEntryLabel(saved)}, transaction rapprochée`, {
      action: { label: 'Annuler', onClick: () => void unreconcile(transactionId) },
      duration: 8000,
    })
    void loadData()
  }

  const handleConflict = (_transactionId: string, message: string) => {
    toast.info(message)
    void loadData()
  }

  if (!companyId) {
    return <NoCompanySelected />
  }

  const reconciledActions = (transaction: BankTransaction) => (
    <div className="flex items-center justify-end gap-1">
      {transaction.reconciledWith && (
        <Button size="icon-sm" variant="ghost" asChild>
          <Link
            href={`/${companyId}/entries/${transaction.reconciledWith}`}
            aria-label="Voir l'écriture liée"
            title="Voir l'écriture liée"
          >
            <ExternalLink aria-hidden />
          </Link>
        </Button>
      )}
      <Button size="xs" variant="outline" onClick={() => setUndoTarget(transaction)}>
        Annuler
      </Button>
    </div>
  )

  const unreconciledTransactions = transactions.filter((t) => !t.reconciled)
  const reconciledTransactions = transactions.filter((t) => t.reconciled)
  const activeRules = rules.filter((r) => r.enabled).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rapprochement bancaire"
        description="Associez chaque opération de la banque à son écriture comptable."
        docsHref={docsUrl('bankReconciliation')}
        actions={
          <>
            <SyncButton
              syncing={autoReconciling}
              disabled={loading || !canReconcile}
              title={canReconcile ? undefined : denied('rapprocher les transactions')}
              onClick={handleAutoReconcile}
              label="Actualiser et rapprocher"
            />
            <Button
              variant="outline"
              onClick={handleApplyAllRules}
              loading={executing}
              disabled={!canReconcile}
              title={
                canReconcile
                  ? "Crée en brouillon l'écriture de chaque transaction qui remplit toutes les conditions d'une règle active"
                  : denied('appliquer les règles')
              }
            >
              <Workflow aria-hidden />
              Appliquer les règles
            </Button>
          </>
        }
      >
        <FiscalYearSelector companyId={companyId} value={selectedFiscalYearId} onValueChange={setSelectedFiscalYearId} className="w-full sm:w-72" />
      </PageHeader>

      {!canReconcile ? <AccessNotice>{denied('rapprocher les transactions ni de créer leurs écritures')}</AccessNotice> : null}

      <section aria-labelledby="queue-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="queue-title" className="text-base font-semibold">
            À traiter{loading ? null : <span className="text-muted-foreground num font-normal"> ({unreconciledTransactions.length})</span>}
          </h2>
          {unreconciledTransactions.length > 0 ? (
            <p id="reconciliation-queue-help" className="text-muted-foreground hidden text-xs sm:block">
              Flèches ou <kbd className="font-mono">j</kbd> / <kbd className="font-mono">k</kbd> pour passer d&apos;une
              transaction à l&apos;autre, Entrée pour la traiter.
            </p>
          ) : null}
        </div>

        {loading ? (
          <ReconciliationQueueSkeleton />
        ) : transactions.length === 0 ? (
          <OnboardingEmptyState
            companyId={companyId}
            title="Aucune opération bancaire à rapprocher"
            description="Le rapprochement associe chaque opération de la banque à une écriture. Les opérations arrivent quand la banque est connectée ou qu'un relevé est importé."
            steps={['bank']}
            fallback={{ label: 'Importer un relevé', href: `/${companyId}/banking/statements` }}
            docsHref={docsUrl('bankReconciliation')}
            docsLabel="Le rapprochement bancaire"
          />
        ) : unreconciledTransactions.length === 0 ? (
          <EmptyState
            bordered
            tone="success"
            icon={CheckCircle2}
            title="Toutes les transactions sont rapprochées"
            description="Chaque opération bancaire de la période a son écriture. Les prochaines opérations apparaîtront ici."
          />
        ) : (
          <ReconciliationQueue
            transactions={unreconciledTransactions}
            onProcess={openDialog}
            onApplyRule={handleApplyRule}
            onPreviewAttachment={handlePreviewAttachment}
            applyingRuleKey={applyingRuleKey}
          />
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Règles d&apos;affectation</CardTitle>
          <CardDescription>
            {rules.length === 0
              ? "Une règle propose l'écriture des transactions qui se ressemblent (même fournisseur, même libellé)\u00a0: créez-en une depuis une transaction ou depuis la page des règles."
              : `${plural(activeRules, 'règle active', 'règles actives')} sur ${rules.length}. Les transactions qui remplissent toutes les conditions d'une règle affichent son nom\u00a0: un clic crée l'écriture. « Appliquer les règles » le fait pour toutes les transactions à traiter, les règles marquées « Créer automatiquement l'écriture » s'appliquent aussi à chaque actualisation. Les écritures sont créées en brouillon.`}
          </CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${companyId}/rules`}>Gérer les règles</Link>
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      {reconciledTransactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Transactions rapprochées ({reconciledTransactions.length})</CardTitle>
            <CardDescription>Annuler un rapprochement remet la transaction à traiter.</CardDescription>
          </CardHeader>
          <CardContent>
            {compact ? (
              <ul className="divide-y rounded-lg border" aria-label="Transactions rapprochées">
                {reconciledTransactions.map((transaction) => (
                  <li key={transaction.id} className="space-y-1 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">{transactionTitle(transaction)}</span>
                      <Amount value={signedAmount(transaction)} sign="always" className="shrink-0 font-medium" />
                    </div>
                    <div className="text-muted-foreground text-xs">
                      <DateDisplay value={transaction.date} />, {bankAccountName(transaction.bankAccount)}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs">
                        Rapprochée le <DateDisplay value={transaction.reconciledAt} empty="date non renseignée" />
                      </span>
                      {reconciledActions(transaction)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
            <Table containerClassName="rounded-lg border">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead numeric>Montant</TableHead>
                  <TableHead>Compte</TableHead>
                  <TableHead>Rapprochée le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconciledTransactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell>
                      <DateDisplay value={transaction.date} />
                    </TableCell>
                    <TableCell className="max-w-72 truncate">{transactionTitle(transaction)}</TableCell>
                    <TableCell numeric>
                      <Amount value={signedAmount(transaction)} sign="always" />
                    </TableCell>
                    <TableCell className="max-w-40 truncate">
                      {bankAccountName(transaction.bankAccount)}
                    </TableCell>
                    <TableCell>
                      <DateDisplay value={transaction.reconciledAt} empty="Non renseignée" />
                    </TableCell>
                    <TableCell className="text-right">{reconciledActions(transaction)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      )}

      {accountingEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Écritures de banque</CardTitle>
            <CardDescription>Écritures passées sur les comptes de banque (51), avec ou sans transaction rapprochée.</CardDescription>
          </CardHeader>
          <CardContent>
            {compact ? (
              <ul className="divide-y rounded-lg border" aria-label="Écritures de banque">
                {accountingEntries.map((entry) => (
                  <li key={entry.id} className="space-y-1 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 truncate">{entry.description || 'Sans libellé'}</span>
                      <span className="shrink-0 text-right font-medium">
                        {entry.totalDebit > 0 ? <Amount value={entry.totalDebit} /> : <Amount value={entry.totalCredit} />}
                      </span>
                    </div>
                    <div className="text-muted-foreground flex items-center justify-between gap-3 text-xs">
                      <span>
                        <DateDisplay value={entry.date} />{' '}
                        <span className="font-mono" title={entry.journal.label}>
                          {entry.journal.code}
                        </span>{' '}
                        {entry.status === 'validated' ? <span className="num">{entry.entryNumber}</span> : 'Brouillon'}
                      </span>
                      <span>{entry.totalDebit > 0 ? 'Débit' : 'Crédit'}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
            <Table containerClassName="rounded-lg border">
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Journal</TableHead>
                  <TableHead>N°</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead numeric>Débit</TableHead>
                  <TableHead numeric>Crédit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accountingEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <DateDisplay value={entry.date} />
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs" title={entry.journal.label}>
                        {entry.journal.code}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.status === 'validated' ? (
                        <span className="num">{entry.entryNumber}</span>
                      ) : (
                        <span className="text-muted-foreground" title="Numéro attribué à la validation">
                          Brouillon
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-80 truncate">{entry.description || 'Sans libellé'}</TableCell>
                    <TableCell numeric>
                      {entry.totalDebit > 0 ? <Amount value={entry.totalDebit} /> : null}
                    </TableCell>
                    <TableCell numeric>
                      {entry.totalCredit > 0 ? <Amount value={entry.totalCredit} /> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      )}

      {preview && (
        <JustificatifPreviewDialog
          open
          onOpenChange={(open) => {
            if (!open) setPreview(null)
          }}
          attachmentId={preview.attachment.id}
          transactionUuid={preview.transactionUuid}
          companyId={companyId}
          fileName={preview.attachment.fileName}
          fileContentType={preview.attachment.fileContentType}
        />
      )}

      <TransactionSuggestionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={companyId}
        transactionId={dialogTransactionId}
        queue={unreconciledTransactions.map((t) => t.id)}
        journals={journals}
        onNavigate={setDialogTransactionId}
        onSaved={handleSaved}
        onConflict={handleConflict}
        onUndo={unreconcile}
      />

      <ConfirmDeleteDialog
        open={undoTarget !== null}
        onOpenChange={(open) => {
          if (!open) setUndoTarget(null)
        }}
        title="Annuler le rapprochement ?"
        description={
          <>
            La transaction <strong>{undoTarget?.counterpartyName || undoTarget?.label || ''}</strong> redeviendra à traiter.
            Si son écriture a été créée par le rapprochement et n&apos;est pas validée, elle sera supprimée. Une écriture
            validée ne peut pas être supprimée&nbsp;: passez alors une écriture de contre-passation.
          </>
        }
        confirmLabel="Annuler le rapprochement"
        loadingLabel="Annulation..."
        cancelLabel="Conserver"
        loading={undoing}
        onConfirm={confirmUndo}
      />
    </div>
  )
}
