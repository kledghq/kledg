'use client'

import * as React from 'react'
import { Paperclip, Workflow } from 'lucide-react'

import { Amount, DateDisplay, StatusBadge } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { ProposeWithAiButton } from '@/components/features/ai-assist/propose-with-ai-button'
import { toCents } from '@/lib/utils/money'
import { Skeleton } from '@/components/ui/skeleton'
import { operationTypeLabel } from '@/lib/banking/operation-type'

export interface QueueAttachment {
  id: string
  fileName: string
  fileContentType: string | null
}

export interface QueueTransaction {
  id: string
  amount: number
  date: string
  label: string | null
  side: string
  status?: string | null
  counterpartyName?: string | null
  cashflowCategory?: string | null
  cashflowSubcategory?: string | null
  operationType?: string | null
  vatAmount?: number | null
  vatRate?: number | null
  attachments?: QueueAttachment[]
  attachment?: QueueAttachment | null
  matchingRules?: Array<{ ruleId: string; ruleName: string; matched: boolean }>
}

interface ReconciliationQueueProps {
  transactions: QueueTransaction[]
  /** Opens the "Traiter la transaction" dialog. */
  onProcess: (transaction: QueueTransaction) => void
  /** Creates the entry proposed by an assignment rule. */
  onApplyRule: (transaction: QueueTransaction, ruleId: string) => void
  onPreviewAttachment: (transaction: QueueTransaction, attachment: QueueAttachment) => void
  /** `${transactionId}:${ruleId}` of the rule being applied. */
  applyingRuleKey?: string | null
}

const NEXT_KEYS = new Set(['ArrowDown', 'j'])
const PREVIOUS_KEYS = new Set(['ArrowUp', 'k'])

/** Attachments of a transaction: the list, or the single legacy attachment. */
export function attachmentsOf(transaction: QueueTransaction): QueueAttachment[] {
  if (transaction.attachments?.length) return transaction.attachments
  return transaction.attachment ? [transaction.attachment] : []
}

/** Signed amount of a bank transaction in euros: negative when money leaves the account. */
export function signedAmount(transaction: Pick<QueueTransaction, 'amount' | 'side'>): number {
  const amount = Math.abs(Number(transaction.amount))
  return transaction.side === 'debit' ? -amount : amount
}

const STATUS: Record<string, { label: string; tone: 'warning' | 'danger' }> = {
  pending: { label: 'En attente', tone: 'warning' },
  declined: { label: 'Refusée', tone: 'danger' },
}

function rowLabel(transaction: QueueTransaction): string {
  return transaction.counterpartyName || transaction.label || 'Transaction'
}

/**
 * Transactions waiting for their entry, as a dense list: one row per
 * transaction with its date, counterpart, signed amount, matching rules and a
 * "Traiter" action. Keyboard: arrows or j/k move between rows, Home/End jump,
 * Enter opens the selected transaction.
 */
export function ReconciliationQueue({
  transactions,
  onProcess,
  onApplyRule,
  onPreviewAttachment,
  applyingRuleKey,
}: ReconciliationQueueProps) {
  const rowRefs = React.useRef<Array<HTMLLIElement | null>>([])
  const [activeIndex, setActiveIndex] = React.useState(0)
  const current = Math.min(activeIndex, Math.max(transactions.length - 1, 0))

  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(index, transactions.length - 1))
    setActiveIndex(next)
    rowRefs.current[next]?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLLIElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    // Keys typed inside a row's buttons keep their own meaning (Enter on "Appliquer").
    const onRow = event.target === event.currentTarget
    if (NEXT_KEYS.has(event.key)) {
      event.preventDefault()
      focusRow(index + 1)
    } else if (PREVIOUS_KEYS.has(event.key)) {
      event.preventDefault()
      focusRow(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusRow(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusRow(transactions.length - 1)
    } else if (event.key === 'Enter' && onRow) {
      event.preventDefault()
      onProcess(transactions[index])
    }
  }

  return (
    <ul
      aria-label="Transactions à traiter"
      aria-describedby="reconciliation-queue-help"
      className="divide-y rounded-lg border"
    >
      {transactions.map((transaction, index) => {
        const name = rowLabel(transaction)
        const type = operationTypeLabel(transaction.operationType)
        const category = transaction.cashflowSubcategory || transaction.cashflowCategory
        const status = transaction.status ? STATUS[transaction.status] : undefined
        const attachments = attachmentsOf(transaction)
        const rules = transaction.matchingRules?.filter((rule) => rule.matched) ?? []
        const amount = signedAmount(transaction)
        // Roving focus: only the active row and its buttons are in the Tab order.
        const tabIndex = index === current ? 0 : -1
        return (
          <li
            key={transaction.id}
            ref={(node) => {
              rowRefs.current[index] = node
            }}
            tabIndex={tabIndex}
            aria-label={`${name}, ${transaction.side === 'debit' ? 'débit' : 'crédit'}`}
            data-slot="reconciliation-row"
            onFocus={() => setActiveIndex(index)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className="hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-ring/50 flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 outline-none first:rounded-t-lg last:rounded-b-lg focus-visible:ring-[3px] focus-visible:ring-inset"
          >
            <div className="min-w-0 flex-1 basis-56">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{name}</span>
                {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
              </div>
              <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
                <DateDisplay value={transaction.date} />
                {type ? <span>{type}</span> : null}
                {category ? <span className="max-w-48 truncate">{category}</span> : null}
                {transaction.label && transaction.label !== name ? (
                  <span className="max-w-64 truncate">{transaction.label}</span>
                ) : null}
                {transaction.vatAmount != null ? (
                  <span>
                    TVA <Amount value={transaction.vatAmount} />
                  </span>
                ) : null}
              </div>
            </div>

            {/* Attachments and matching rules: their own line on phones, before the amount on wider screens. */}
            {attachments.length > 0 || rules.length > 0 ? (
              <div className="order-last flex w-full flex-wrap items-center justify-end gap-1.5 md:order-none md:w-auto">
                {attachments.map((attachment) => (
                  <Button
                    key={attachment.id}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    tabIndex={tabIndex}
                    aria-label={`Voir le justificatif ${attachment.fileName}`}
                    title={attachment.fileName}
                    onClick={() => onPreviewAttachment(transaction, attachment)}
                  >
                    <Paperclip aria-hidden />
                  </Button>
                ))}
                {rules.map((rule) => (
                  <Button
                    key={rule.ruleId}
                    type="button"
                    variant="outline"
                    size="xs"
                    className="max-w-48"
                    tabIndex={tabIndex}
                    loading={applyingRuleKey === `${transaction.id}:${rule.ruleId}`}
                    title={`Créer l'écriture avec la règle « ${rule.ruleName} »`}
                    onClick={() => onApplyRule(transaction, rule.ruleId)}
                  >
                    <Workflow aria-hidden />
                    <span className="truncate">{rule.ruleName}</span>
                  </Button>
                ))}
              </div>
            ) : null}

            {/* Fixed widths keep the amounts aligned from one row to the next. */}
            <div className="ml-auto flex shrink-0 items-center justify-end gap-2 sm:w-48">
              <Amount value={amount} sign="always" className="text-sm font-medium" />
              <StatusBadge className="w-14 justify-center">{transaction.side === 'debit' ? 'Débit' : 'Crédit'}</StatusBadge>
            </div>
            <div className="flex items-center gap-1">
              <ProposeWithAiButton
                icon
                tabIndex={tabIndex}
                target={{ kind: 'bank_transaction', id: transaction.id, date: transaction.date.slice(0, 10), label: transaction.label || name, amountCents: toCents(amount) ?? 0 }}
              />
              <Button
                type="button"
                variant="outline"
                size="xs"
                tabIndex={tabIndex}
                onClick={() => onProcess(transaction)}
              >
                Traiter
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Placeholder rows shaped like the queue while transactions load. */
export function ReconciliationQueueSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy className="divide-y rounded-lg border" data-slot="reconciliation-skeleton">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 px-3 py-2.5">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  )
}
