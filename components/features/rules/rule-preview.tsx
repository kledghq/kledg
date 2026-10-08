'use client'

import * as React from 'react'

import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Amount, DateDisplay, Field } from '@/components/shared'
import { findMatchingRules, type RuleWithConditions } from '@/lib/transactions/rule-matcher'
import type { EnrichedTransaction } from '@/lib/transactions/types'
import { addUtcDays, toIsoDateUtc, todayUtc } from '@/lib/utils/date'
import { cn } from '@/lib/utils'
import { plural, pluralWord } from '@/lib/utils/plural'
import { EntrySimulation, type SimulatedEntry } from './entry-simulation'
import {
  hasVat,
  simulationRuleData,
  transactionVatOf,
  type Account,
  type Condition,
  type EntryLine,
  type PreviewTransaction,
} from './rule-form'

/** Transactions the preview matches the conditions against. */
const PREVIEW_DAYS = 90
const PREVIEW_LIMIT = 2000
/** Pause after the last edit before the preview matches or simulates again. */
export const PREVIEW_DEBOUNCE_MS = 400
const EXAMPLES = 3

type Loaded<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T }

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timeout)
  }, [value, delay])
  return debounced
}

export interface ManualExample {
  amount: string
  side: 'debit' | 'credit'
}

export interface RulePreviewState {
  transactions: Loaded<{ items: PreviewTransaction[]; truncated: boolean }>
  /** Conditions with a value: the ones that can match. */
  completeConditions: number
  incompleteConditions: number
  matches: PreviewTransaction[]
  selected: PreviewTransaction | null
  select: (id: string) => void
  manual: ManualExample
  setManual: (example: ManualExample) => void
  simulation: SimulatedEntry | null
  simulating: boolean
  simulationError: string | null
}

/**
 * Live preview of a rule being edited: the recent bank transactions its
 * conditions recognise (matched in the browser with the matcher of the
 * rules engine) and the entry it would book for one of them, from
 * POST /api/transaction-rules/simulate. Both run after a pause in the
 * edits.
 */
export function useRulePreview({
  companyId,
  conditions,
  entryLines,
  defaultVatAccountId,
  accounts,
}: {
  companyId: string
  conditions: Condition[]
  entryLines: EntryLine[]
  defaultVatAccountId: string
  accounts: Account[]
}): RulePreviewState {
  const [transactions, setTransactions] = React.useState<RulePreviewState['transactions']>({ status: 'loading' })
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [manual, setManual] = React.useState<ManualExample>({ amount: '100', side: 'debit' })
  const [result, setResult] = React.useState<{ request: string; simulation: SimulatedEntry | null; error: string | null } | null>(null)

  React.useEffect(() => {
    if (!companyId) return
    let cancelled = false
    const params = new URLSearchParams({
      companyId,
      startDate: toIsoDateUtc(addUtcDays(todayUtc(), -PREVIEW_DAYS)),
      limit: String(PREVIEW_LIMIT),
    })
    fetch(`/api/transactions?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('transactions')
        const data = (await response.json()) as { transactions?: PreviewTransaction[]; nextCursor?: string }
        if (!cancelled) setTransactions({ status: 'ready', data: { items: data.transactions ?? [], truncated: !!data.nextCursor } })
      })
      .catch(() => !cancelled && setTransactions({ status: 'error' }))
    return () => {
      cancelled = true
    }
  }, [companyId])

  const debouncedConditions = useDebounced(conditions, PREVIEW_DEBOUNCE_MS)
  const complete = React.useMemo(() => debouncedConditions.filter((c) => !!c.value), [debouncedConditions])

  const matches = React.useMemo(() => {
    if (transactions.status !== 'ready' || complete.length === 0) return []
    const rule = {
      id: 'preview',
      name: 'Aperçu',
      priority: 0,
      autoCreate: false,
      conditions: complete.map((c) => ({ ...c, value: c.value || null, value2: c.value2 || null })),
    } as unknown as RuleWithConditions
    return transactions.data.items
      .filter((tx) => findMatchingRules([rule], tx as unknown as EnrichedTransaction).length > 0)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [transactions, complete])

  const selected = matches.find((tx) => tx.id === selectedId) ?? matches[0] ?? null

  const example = React.useMemo(() => {
    if (selected) {
      const vat = transactionVatOf(selected)
      return {
        amount: Math.abs(Number(selected.amount)),
        side: selected.side === 'credit' ? 'credit' : 'debit',
        label: selected.label || 'Transaction bancaire',
        ...(vat?.vatRate != null ? { vatRate: vat.vatRate } : {}),
        ...(vat?.vatAmount != null ? { vatAmount: vat.vatAmount } : {}),
      }
    }
    return { amount: parseFloat(manual.amount), side: manual.side, label: 'Transaction exemple' }
  }, [selected, manual])

  const ruleData = React.useMemo(
    () => (entryLines.length > 0 ? simulationRuleData({ entryLines, defaultVatAccountId }, accounts) : null),
    [entryLines, defaultVatAccountId, accounts],
  )
  // Simulate once the example is known: transactions loaded and conditions matched
  const settled = transactions.status !== 'loading' && debouncedConditions === conditions
  const request = React.useMemo(
    () =>
      settled && ruleData && Number.isFinite(example.amount) && example.amount !== 0
        ? JSON.stringify({ companyId, ruleData, transactionExample: example })
        : null,
    [settled, companyId, ruleData, example],
  )
  const debouncedRequest = useDebounced(request, PREVIEW_DEBOUNCE_MS)

  React.useEffect(() => {
    if (!debouncedRequest) return
    let cancelled = false
    fetch('/api/transaction-rules/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: debouncedRequest,
    })
      .then(async (response) => {
        if (!response.ok) {
          const error = (await response.json().catch(() => null)) as { error?: string } | null
          throw new Error(error?.error || 'Erreur lors de la simulation')
        }
        return (await response.json()) as SimulatedEntry
      })
      .then((data) => !cancelled && setResult({ request: debouncedRequest, simulation: data, error: null }))
      .catch((error: unknown) => {
        if (cancelled) return
        setResult({
          request: debouncedRequest,
          simulation: null,
          error: error instanceof Error ? error.message : "La simulation a échoué. Vérifiez les lignes de l'écriture.",
        })
      })
    return () => {
      cancelled = true
    }
  }, [debouncedRequest])

  // The last result stays on screen while the next one is computed
  const current = request ? result : null

  return {
    transactions,
    completeConditions: complete.length,
    incompleteConditions: debouncedConditions.length - complete.length,
    matches,
    selected,
    select: setSelectedId,
    manual,
    setManual,
    simulation: current?.simulation ?? null,
    simulating: !!request && result?.request !== request,
    simulationError: current?.error ?? null,
  }
}

/** VAT booked by a simulated entry: the VAT carried by the lines that are not VAT accounts (44x). */
function bookedVat(simulation: SimulatedEntry): number {
  return simulation.entryLines
    .filter((l) => l.vatInfo && !l.account.code.startsWith('44'))
    .reduce((sum, l) => sum + (l.vatInfo?.amount ?? 0), 0)
}

/**
 * Where the VAT of the simulated entry comes from: the bank, the entered
 * rate, or the entered rate because the bank detected nothing.
 */
function vatSourceLabel(entryLines: EntryLine[], tx: PreviewTransaction | null): string {
  const vatLines = entryLines.filter(hasVat)
  const detected = tx ? transactionVatOf(tx) : null
  const usesBank = vatLines.some((l) => l.vatRateSource === 'transaction')
  if (usesBank && detected) return 'détectée par la banque'
  if (usesBank) return 'taux de secours, la banque n’a pas détecté de TVA'
  return 'taux saisi'
}

export function RulePreview({
  preview,
  entryLines,
  servicesVatOnDebits = null,
}: {
  preview: RulePreviewState
  entryLines: EntryLine[]
  /** Company option for VAT on services on debits (GET /api/companies/[id]/vat-settings), null when unknown. */
  servicesVatOnDebits?: boolean | null
}) {
  const { transactions, matches, selected } = preview
  const examples = matches.slice(0, EXAMPLES)

  return (
    <section
      aria-labelledby="rule-preview-title"
      className="bg-card text-card-foreground min-w-0 space-y-5 rounded-lg border px-5 py-5"
      data-testid="rule-preview"
    >
      <div className="space-y-1.5">
        <h2 id="rule-preview-title" className="leading-tight font-semibold tracking-tight">
          Aperçu
        </h2>
        <p className="text-muted-foreground text-sm">Mis à jour pendant que vous modifiez la règle.</p>
      </div>

      <div className="space-y-3" aria-live="polite">
        {transactions.status === 'loading' ? (
          <Skeleton className="h-5 w-56" />
        ) : transactions.status === 'error' ? (
          <p className="text-muted-foreground text-sm">Les transactions récentes ne se sont pas chargées.</p>
        ) : preview.completeConditions === 0 ? (
          <p className="text-muted-foreground text-sm">Ajoutez une condition avec une valeur pour voir les transactions reconnues.</p>
        ) : (
          <p className="text-sm" data-testid="rule-preview-count">
            <span className="num font-semibold">{plural(matches.length, 'transaction', 'transactions')}</span>{' '}
            {pluralWord(matches.length, 'reconnue', 'reconnues')} sur {PREVIEW_DAYS} jours
            {transactions.data.truncated ? ` (${PREVIEW_LIMIT.toLocaleString('fr-FR')} premières transactions)` : ''}.
          </p>
        )}
        {preview.incompleteConditions > 0 ? (
          <p className="text-muted-foreground text-xs">
            Une condition sans valeur ne reconnaît aucune transaction&nbsp;: complétez-la ou supprimez-la.
          </p>
        ) : null}

        {examples.length > 0 ? (
          <ul className="space-y-1.5" aria-label="Exemples de transactions reconnues">
            {examples.map((tx) => {
              const vat = transactionVatOf(tx)
              const active = tx.id === selected?.id
              return (
                <li key={tx.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => preview.select(tx.id)}
                    className={cn(
                      'hover:bg-muted/60 focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px]',
                      active && 'border-foreground/40 bg-muted/60',
                    )}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-medium">{tx.counterpartyName || tx.label || 'Transaction'}</span>
                      <Amount value={tx.side === 'credit' ? Math.abs(Number(tx.amount)) : -Math.abs(Number(tx.amount))} className="shrink-0" />
                    </span>
                    <span className="text-muted-foreground flex justify-between gap-3 text-xs">
                      <DateDisplay value={tx.date} />
                      <span>
                        {vat?.vatAmount != null ? (
                          <>
                            TVA détectée <Amount value={vat.vatAmount} />
                          </>
                        ) : vat?.vatRate != null ? (
                          `TVA détectée ${String(vat.vatRate).replace('.', ',')} %`
                        ) : (
                          'Pas de TVA détectée'
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>

      {entryLines.length === 0 ? (
        <p className="text-muted-foreground text-sm">Ajoutez une ligne d&apos;écriture pour voir l&apos;écriture proposée.</p>
      ) : (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">
            {selected ? 'Écriture proposée pour cette transaction' : 'Écriture proposée pour un exemple'}
          </h3>
          {!selected ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Montant">
                <Input
                  id="rule-preview-amount"
                  type="number"
                  inputMode="decimal"
                  value={preview.manual.amount}
                  onChange={(e) => preview.setManual({ ...preview.manual, amount: e.target.value })}
                  placeholder="100.00"
                />
              </Field>
              <Field label="Sens" htmlFor="rule-preview-side">
                <Select
                  value={preview.manual.side}
                  onValueChange={(value) => preview.setManual({ ...preview.manual, side: value as 'debit' | 'credit' })}
                >
                  <SelectTrigger id="rule-preview-side" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="debit">Débit</SelectItem>
                    <SelectItem value="credit">Crédit</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
          ) : null}

          <div aria-busy={preview.simulating || undefined}>
            {preview.simulationError ? (
              <p role="alert" className="text-destructive text-sm">
                {preview.simulationError}
              </p>
            ) : preview.simulation ? (
              <div className="space-y-3">
                <EntrySimulation {...preview.simulation} compact />
                {entryLines.some(hasVat) ? (
                  <p className="text-sm" data-testid="rule-preview-vat">
                    {bookedVat(preview.simulation) > 0 ? (
                      <>
                        TVA comptabilisée&nbsp;: <Amount value={bookedVat(preview.simulation)} /> ({vatSourceLabel(entryLines, selected)})
                      </>
                    ) : (
                      'Aucune TVA comptabilisée pour cette transaction.'
                    )}
                  </p>
                ) : null}
                {servicesVatOnDebits !== null && entryLines.some((l) => l.vatType === 'collectible') ? (
                  <p className="text-muted-foreground text-xs" data-testid="rule-preview-vat-regime">
                    Régime de la société&nbsp;: TVA sur les prestations exigible{' '}
                    {servicesVatOnDebits ? 'd’après les débits' : 'à l’encaissement'} (paramètres de TVA).
                  </p>
                ) : null}
              </div>
            ) : (
              <Skeleton className="h-32 w-full" />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
