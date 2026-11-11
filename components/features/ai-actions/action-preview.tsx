'use client'

import { Amount, DateDisplay, StatusBadge, formatDisplayDate } from '@/components/shared'
import { requesterName } from './requester-name'

/**
 * The readable part of the dry run of an action prepared by an assistant,
 * shown above its full JSON on the approval page: for a bulk action, what
 * it will do item by item, not only a count.
 * - run_rules (and the refresh of sync_bank_data): each rule that would
 *   apply, the accounts it books to, its number of transactions, and a
 *   warning when an assistant created or changed it, with the date;
 * - bulk_reconcile auto_match: the transaction and entry pairs it would
 *   link (the first ones, with the total);
 * - mark_declaration: the deadline and its status today.
 * Everything comes from the server's dry run and is rendered as text.
 */

interface AssistantChange {
  change: 'created' | 'changed'
  tool: string
  assistant: string | null
  at: string
}

interface RulePreview {
  ruleId: string
  name: string
  journalCode?: string
  accounts?: string[]
  transactions?: number
  byAssistant: AssistantChange | null
}

interface PairPreview {
  transaction: { id: string; date?: string; label?: string; amount?: number | string; side?: string }
  entry: { id: string; number?: string | null; date?: string; description?: string | null; status?: string }
}

interface DeadlinePreview {
  label?: string
  date?: string
  statusLabel?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rulesOf(preview: Record<string, unknown>): RulePreview[] | null {
  const rules = Array.isArray(preview.rules) ? preview.rules : Array.isArray(preview.autoCreateRules) ? preview.autoCreateRules : null
  if (!rules) return null
  return rules.filter((r): r is RulePreview => isObject(r) && typeof r.name === 'string' && ('byAssistant' in r))
}

function AssistantWarning({ change }: { change: AssistantChange }) {
  const verb = change.change === 'created' ? 'Créée' : 'Modifiée'
  return (
    <p className="text-warning text-xs">
      {verb} par {requesterName(change.assistant)} le {formatDisplayDate(change.at, 'datetime')}
    </p>
  )
}

function RulesPreview({ rules, total, changed }: { rules: RulePreview[]; total: number; changed: number }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">
        Règles qui seront appliquées ({total})
        {changed > 0 ? (
          <>
            {' '}
            <StatusBadge tone="warning">
              {changed === 1 ? '1 créée ou modifiée par un assistant' : `${changed} créées ou modifiées par un assistant`}
            </StatusBadge>
          </>
        ) : null}
      </p>
      <ul className="divide-y rounded-md border text-sm">
        {rules.map((rule) => (
          <li key={rule.ruleId} className="space-y-1 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{rule.name}</span>
              {typeof rule.transactions === 'number' ? (
                <span className="text-muted-foreground text-xs">
                  {rule.transactions === 1 ? '1 transaction' : `${rule.transactions} transactions`}
                </span>
              ) : null}
            </div>
            {rule.accounts && rule.accounts.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                Comptes{' '}: <span className="font-mono">{rule.accounts.join(', ')}</span>
                {rule.journalCode ? (
                  <>
                    {' '}
                    · journal <span className="font-mono">{rule.journalCode}</span>
                  </>
                ) : null}
              </p>
            ) : null}
            {rule.byAssistant ? <AssistantWarning change={rule.byAssistant} /> : null}
          </li>
        ))}
      </ul>
      {total > rules.length ? <p className="text-muted-foreground text-xs">Les {rules.length} premières sont listées.</p> : null}
    </div>
  )
}

function PairsPreview({ pairs, total }: { pairs: PairPreview[]; total: number }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Rapprochements qui seront faits ({total})</p>
      {pairs.length > 0 ? (
        <ul className="divide-y rounded-md border text-sm">
          {pairs.map(({ transaction, entry }) => (
            <li key={`${transaction.id}:${entry.id}`} className="grid gap-1 p-3 sm:grid-cols-2 sm:gap-4">
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs">Transaction</p>
                <p className="truncate">{transaction.label ?? transaction.id}</p>
                <p className="text-muted-foreground text-xs">
                  {transaction.date ? <DateDisplay value={transaction.date} /> : null}
                  {transaction.amount !== undefined ? (
                    <>
                      {' · '}
                      <Amount value={transaction.side === 'debit' ? -Number(transaction.amount) : Number(transaction.amount)} />
                    </>
                  ) : null}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs">Écriture</p>
                <p className="truncate">
                  {entry.number ? <span className="font-mono text-xs">{entry.number} </span> : null}
                  {entry.description ?? ''}
                </p>
                <p className="text-muted-foreground text-xs">{entry.date ? <DateDisplay value={entry.date} /> : null}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {total > pairs.length ? <p className="text-muted-foreground text-xs">Les {pairs.length} premiers sont listés.</p> : null}
    </div>
  )
}

function DeadlineSummary({ deadline }: { deadline: DeadlinePreview }) {
  return (
    <div className="rounded-md border p-3 text-sm">
      <p className="font-medium">{deadline.label}</p>
      <p className="text-muted-foreground text-xs">
        {deadline.date ? (
          <>
            Échéance du <DateDisplay value={deadline.date} />
          </>
        ) : null}
        {deadline.statusLabel ? ` · aujourd’hui : ${deadline.statusLabel}` : null}
      </p>
    </div>
  )
}

/** Whether ActionPreview shows something for this dry run (else the JSON is shown open). */
export function hasReadablePreview(preview: unknown): boolean {
  if (!isObject(preview)) return false
  return Boolean(rulesOf(preview) || Array.isArray(preview.pairs) || isObject(preview.deadline) || typeof preview.effect === 'string')
}

export function ActionPreview({ preview }: { preview: unknown }) {
  if (!isObject(preview)) return null
  const rules = rulesOf(preview)
  const pairs = Array.isArray(preview.pairs) ? (preview.pairs.filter((p) => isObject(p) && isObject(p.transaction) && isObject(p.entry)) as PairPreview[]) : null
  const deadline = isObject(preview.deadline) ? (preview.deadline as DeadlinePreview) : null
  const effect = typeof preview.effect === 'string' ? preview.effect : null
  if (!rules && !pairs && !deadline && !effect) return null
  return (
    <div className="space-y-3">
      {effect ? <p className="text-sm">{effect}</p> : null}
      {deadline ? <DeadlineSummary deadline={deadline} /> : null}
      {rules ? (
        <RulesPreview
          rules={rules}
          total={typeof preview.rulesTotal === 'number' ? preview.rulesTotal : rules.length}
          changed={typeof preview.rulesChangedByAssistant === 'number' ? preview.rulesChangedByAssistant : rules.filter((r) => r.byAssistant).length}
        />
      ) : null}
      {pairs ? <PairsPreview pairs={pairs} total={typeof preview.pairsTotal === 'number' ? preview.pairsTotal : pairs.length} /> : null}
    </div>
  )
}
