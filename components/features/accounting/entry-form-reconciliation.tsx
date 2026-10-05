'use client'

import * as React from 'react'
import { Lock, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AmountInput } from '@/components/ui/amount-input'
import { DateInput } from '@/components/ui/date-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AccountCombobox } from '@/components/features/accounting/account-combobox'
import { formatAmount } from '@/components/shared/amount'
import { centsToDecimal } from '@/lib/utils/money'
import {
  checkEntryDate,
  splitInclusiveAmount,
  validateReconciliation,
  vatOnBase,
  type Issue,
} from '@/lib/reconciliation/validation'
import type { ReconciliationContext } from '@/lib/reconciliation/types'

export interface ReconciliationAccount {
  id: string
  code: string
  label: string
  parentId?: string | null
}

interface Journal {
  id: string
  code: string
  label: string
}

interface FormLine {
  key: string
  /** Chosen account code ('' when none). Codes, not ids: they survive a change of fiscal year. */
  accountCode: string
  /** Account code prefixes to pick from once the accounts are loaded (templates, detected VAT). */
  hints?: string[]
  debitCents: number | null
  creditCents: number | null
  description: string
  /** Prefilled by the suggestion and not changed since. */
  suggested: boolean
}

export interface ReconciliationSaved {
  entryId: string
  entryNumber: string
  /** Entries created by a reconciliation are drafts: their number is given at validation. */
  status: 'draft' | 'validated'
}

/**
 * "Écriture créée en brouillon" (its number comes at validation, as in the
 * entries list), or "Écriture n° 42 créée" for a validated entry.
 */
export function savedEntryLabel(saved: Pick<ReconciliationSaved, 'entryNumber' | 'status'>): string {
  return saved.status === 'validated' ? `Écriture n° ${saved.entryNumber} créée` : 'Écriture créée en brouillon'
}

interface EntryFormReconciliationProps {
  context: ReconciliationContext
  journals: Journal[]
  /** Accounts of a fiscal year, undefined while loading. */
  accountsFor: (fiscalYearId: string) => ReconciliationAccount[] | undefined
  loadAccounts: (fiscalYearId: string) => void
  hasNext: boolean
  onSaved: (saved: ReconciliationSaved, goToNext: boolean) => void
  /** The transaction was reconciled meanwhile (409). */
  onConflict: (message: string) => void
  onCancel: () => void
}

let lineKey = 0
const newKey = () => `line-${++lineKey}`

/** Account matching the first hint: exact code, else the first detailed account under it. */
function findByHints(accounts: ReconciliationAccount[], hints: string[] | undefined) {
  for (const hint of hints ?? []) {
    const exact = accounts.find((a) => a.code === hint)
    if (exact) return exact
    const detailed = accounts
      .filter((a) => a.code.startsWith(hint) && a.code.length > hint.length)
      .sort((a, b) => a.code.localeCompare(b.code))[0]
    if (detailed) return detailed
  }
  return undefined
}

const line = (side: 'debit' | 'credit', cents: number, extra: Partial<FormLine> = {}): FormLine => ({
  key: newKey(),
  accountCode: '',
  debitCents: side === 'debit' ? cents : null,
  creditCents: side === 'credit' ? cents : null,
  description: '',
  suggested: false,
  ...extra,
})

/** First lines of the form: the suggestion, else the bank-detected VAT split, else one line for the full amount. */
function initialLines(context: ReconciliationContext): FormLine[] {
  const { transaction, suggestion } = context
  const counterSide = transaction.side === 'debit' ? 'debit' : 'credit'
  if (suggestion && suggestion.lines.length > 0) {
    return suggestion.lines.map((l) => ({
      key: newKey(),
      accountCode: l.accountCode,
      debitCents: l.debitCents || null,
      creditCents: l.creditCents || null,
      description: l.description ?? '',
      suggested: true,
    }))
  }
  const vat = transaction.vatAmountCents
  if (vat && vat < transaction.amountCents) {
    return [
      line(counterSide, transaction.amountCents - vat),
      line(counterSide, vat, { hints: counterSide === 'debit' ? ['44566'] : ['44571'], suggested: true }),
    ]
  }
  return [line(counterSide, transaction.amountCents)]
}

type Template = { label: string; build: (keepCode: string) => FormLine[] }

function templatesFor(context: ReconciliationContext): Template[] {
  const { amountCents, side, vatAmountCents } = context.transaction
  if (side === 'debit') {
    const purchase = (rate: number): Template => ({
      label: `Achat TVA ${String(rate).replace('.', ',')} %`,
      build: (keep) => {
        const { baseCents, vatCents } = splitInclusiveAmount(amountCents, rate)
        return [line('debit', baseCents, { accountCode: keep }), line('debit', vatCents, { hints: ['44566'] })]
      },
    })
    const selfAssessed = (label: string, deductible: string[], due: string[]): Template => ({
      label,
      build: (keep) => {
        const vat = vatOnBase(amountCents, 20)
        return [
          line('debit', amountCents, { accountCode: keep }),
          line('debit', vat, { hints: deductible }),
          line('credit', vat, { hints: due }),
        ]
      },
    })
    return [
      purchase(20),
      purchase(10),
      purchase(5.5),
      ...(vatAmountCents && vatAmountCents < amountCents
        ? [{
            label: 'TVA détectée par la banque',
            build: (keep: string) => [
              line('debit', amountCents - vatAmountCents, { accountCode: keep }),
              line('debit', vatAmountCents, { hints: ['44566'] }),
            ],
          }]
        : []),
      // Self-assessed VAT, 20 % on top of the amount paid (CGI art. 256 bis, 283-2)
      selfAssessed('Achat intracommunautaire', ['445662', '44566'], ['4452']),
      selfAssessed("Achat à l'import", ['445663', '44566'], ['445713', '44571']),
      { label: 'Sans TVA', build: (keep) => [line('debit', amountCents, { accountCode: keep })] },
    ]
  }
  const sale = (rate: number): Template => ({
    label: `Vente TVA ${String(rate).replace('.', ',')} %`,
    build: (keep) => {
      const { baseCents, vatCents } = splitInclusiveAmount(amountCents, rate)
      return [line('credit', baseCents, { accountCode: keep }), line('credit', vatCents, { hints: ['44571'] })]
    },
  })
  return [
    sale(20),
    sale(10),
    sale(5.5),
    { label: 'Encaissement client', build: () => [line('credit', amountCents, { hints: ['411'] })] },
    { label: 'Sans TVA', build: (keep) => [line('credit', amountCents, { accountCode: keep })] },
  ]
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function EntryFormReconciliation({
  context,
  journals,
  accountsFor,
  loadAccounts,
  hasNext,
  onSaved,
  onConflict,
  onCancel,
}: EntryFormReconciliationProps) {
  const { transaction } = context
  const [journalId, setJournalId] = React.useState(() => journals.find((j) => j.code === 'BQ')?.id ?? journals[0]?.id ?? '')
  const [date, setDate] = React.useState(transaction.date)
  const [description, setDescription] = React.useState(transaction.label ?? '')
  const [reference, setReference] = React.useState(transaction.reference ?? '')
  const [lines, setLines] = React.useState<FormLine[]>(() => initialLines(context))
  const [suggestionShown, setSuggestionShown] = React.useState(context.suggestion !== null)
  const [inputErrors, setInputErrors] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [serverError, setServerError] = React.useState<string | null>(null)
  // Errors appear once the user has worked on a line or tried to save, never on a fresh form
  const [touched, setTouched] = React.useState<ReadonlySet<string>>(() => new Set())
  const [attempted, setAttempted] = React.useState(false)
  const submittingRef = React.useRef(false)

  // Journals arrive after the dialog opens on a fresh page
  if (!journalId && journals.length > 0) setJournalId(journals.find((j) => j.code === 'BQ')?.id ?? journals[0].id)

  // Accounts of the fiscal year of the date (the transaction's year until the date is valid)
  const dateCheck = checkEntryDate(context.fiscalYears, date)
  const fiscalYearId = dateCheck.fiscalYear?.id ?? context.fiscalYearId
  const fiscalYear = context.fiscalYears.find((fy) => fy.id === fiscalYearId) ?? null
  React.useEffect(() => {
    if (fiscalYearId) loadAccounts(fiscalYearId)
  }, [fiscalYearId, loadAccounts])
  const accounts = React.useMemo(() => (fiscalYearId ? accountsFor(fiscalYearId) : []), [accountsFor, fiscalYearId])
  const accountsLoading = accounts === undefined
  const byCode = React.useMemo(() => new Map((accounts ?? []).map((a) => [a.code, a])), [accounts])

  const codeOf = (l: FormLine) => l.accountCode || findByHints(accounts ?? [], l.hints)?.code || ''

  const validation = validateReconciliation(
    {
      journalId,
      date,
      transaction: { amountCents: transaction.amountCents, side: transaction.side },
      lines: lines.map((l) => {
        const code = codeOf(l)
        return { accountId: byCode.get(code)?.id ?? '', accountCode: code, debitCents: l.debitCents, creditCents: l.creditCents }
      }),
    },
    { fiscalYears: context.fiscalYears, transactionVatCents: transaction.vatAmountCents },
  )

  const errorsAt = (path: string) => validation.errors.filter((e) => e.path === path).map((e) => e.message)
  const lineErrors = (index: number, l: FormLine): string[] => {
    const code = codeOf(l)
    const account =
      code && !accountsLoading && !byCode.has(code)
        ? [`Le compte ${code} n'existe pas dans l'exercice ${fiscalYear?.year ?? ''}\u00a0: choisissez-en un autre.`]
        : errorsAt(`lines.${index}.account`)
    const typed = [inputErrors[`${l.key}.debit`], inputErrors[`${l.key}.credit`]].filter((e): e is string => !!e)
    return [...account, ...(typed.length > 0 ? typed : errorsAt(`lines.${index}.amount`))]
  }
  const globalErrors: Issue[] = validation.errors.filter((e) => e.path === 'lines' || e.path === 'journalId')
  if (!context.bankAccount) {
    globalErrors.unshift({
      path: 'bank',
      message: "Aucun compte bancaire 512 dans l'exercice\u00a0: créez-le ou choisissez le compte bancaire par défaut dans les informations de la société.",
    })
  }
  const dateError = inputErrors.date ?? errorsAt('date')[0]

  const blocked =
    submitting ||
    accountsLoading ||
    !validation.valid ||
    !context.bankAccount ||
    Object.keys(inputErrors).length > 0 ||
    lines.some((l, i) => lineErrors(i, l).length > 0)

  // Nothing is judged while the accounts load: the suggestion is about to fill the lines
  const showLineErrors = (l: FormLine) => !accountsLoading && (attempted || touched.has(l.key))
  const shownGlobalErrors = accountsLoading
    ? []
    : globalErrors.filter((e) => e.path === 'bank' || attempted || touched.size > 0)
  const errorsHidden =
    !accountsLoading && !submitting && lines.some((l, i) => !showLineErrors(l) && lineErrors(i, l).length > 0)

  const setInputError = (key: string, error: string | null) =>
    setInputErrors((current) => {
      if ((current[key] ?? null) === error) return current
      const next = { ...current }
      if (error) next[key] = error
      else delete next[key]
      return next
    })

  const updateLine = (key: string, patch: Partial<FormLine>) => {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch, suggested: false } : l)))
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)))
  }

  const removeLine = (key: string) => {
    setLines((current) => current.filter((l) => l.key !== key))
    setInputError(`${key}.debit`, null)
    setInputError(`${key}.credit`, null)
  }

  const replaceLines = (next: FormLine[]) => {
    setInputErrors((current): Record<string, string> => (current.date ? { date: current.date } : {}))
    setLines(next)
  }

  /** Puts what is missing on the last line, so the entry balances against the bank amount. */
  const balanceOnLastLine = () => {
    const last = lines[lines.length - 1]
    if (!last) return
    const net = (last.debitCents ?? 0) - (last.creditCents ?? 0) - validation.totals.differenceCents
    updateLine(last.key, { debitCents: net > 0 ? net : null, creditCents: net < 0 ? -net : null })
  }

  const firstChosenCode = lines.map((l) => l.accountCode).find((code) => code && !code.startsWith('445')) ?? ''

  async function submit(goToNext: boolean) {
    if (submittingRef.current) return
    if (blocked) {
      // A save attempt (shortcut) on an incomplete entry shows what is missing
      if (!accountsLoading && !submitting) setAttempted(true)
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setServerError(null)
    try {
      const response = await fetch(`/api/transactions/${transaction.id}/reconcile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          journalId,
          date,
          description: description.trim() || null,
          reference: reference.trim() || null,
          lines: lines.map((l) => ({
            accountId: byCode.get(codeOf(l))?.id ?? '',
            debit: l.debitCents ? centsToDecimal(l.debitCents) : null,
            credit: l.creditCents ? centsToDecimal(l.creditCents) : null,
            description: l.description.trim() || null,
          })),
        }),
      })
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
        entryId?: string
        entryNumber?: string
        status?: ReconciliationSaved['status']
      }
      if (response.status === 201 && data.entryId) {
        // Stay disabled: the dialog moves on to the next transaction or closes
        onSaved({ entryId: data.entryId, entryNumber: data.entryNumber ?? '', status: data.status ?? 'draft' }, goToNext)
        return
      }
      if (response.status === 409) {
        onConflict(data.error ?? 'Cette transaction est déjà rapprochée.')
        return
      }
      setServerError(data.error ?? "Erreur lors de l'enregistrement de l'écriture.")
    } catch {
      setServerError('Connexion impossible\u00a0: vérifiez votre réseau puis réessayez.')
    }
    submittingRef.current = false
    setSubmitting(false)
  }

  // Ctrl/Cmd+Entrée saves (and moves on) wherever the focus is in the dialog
  const submitRef = React.useRef(submit)
  React.useEffect(() => {
    submitRef.current = submit
  })
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.defaultPrevented) {
        event.preventDefault()
        void submitRef.current(hasNext)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hasNext])

  const shortcut = isMac() ? '⌘ Entrée' : 'Ctrl+Entrée'
  const { bankLine } = validation

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="reconcile-journal">Journal</Label>
          <Select value={journalId} onValueChange={setJournalId}>
            <SelectTrigger id="reconcile-journal" aria-invalid={errorsAt('journalId').length > 0 || undefined}>
              <SelectValue placeholder="Choisir un journal" />
            </SelectTrigger>
            <SelectContent>
              {journals.map((journal) => (
                <SelectItem key={journal.id} value={journal.id}>
                  {journal.code} - {journal.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reconcile-date">Date</Label>
          <DateInput
            id="reconcile-date"
            value={date}
            onValueChange={setDate}
            onErrorChange={(error) => setInputError('date', error)}
          />
          {dateError && <p className="text-sm text-destructive">{dateError}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reconcile-description">Libellé de l&apos;écriture</Label>
          <Input
            id="reconcile-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Transaction bancaire"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reconcile-reference">Référence</Label>
          <Input
            id="reconcile-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Pièce justificative"
          />
        </div>
      </div>

      {suggestionShown && context.suggestion && (
        <Alert className="border-primary/30 bg-primary/5">
          <Sparkles className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {context.suggestion.title}
              {context.suggestion.vatRatePercent != null &&
                `, TVA ${String(context.suggestion.vatRatePercent).replace('.', ',')} %`}
              . Vérifiez les lignes avant d&apos;enregistrer.
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setSuggestionShown(false)
                replaceLines([line(transaction.side === 'debit' ? 'debit' : 'credit', transaction.amountCents)])
              }}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Ignorer la suggestion
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Modèles&nbsp;:</span>
        {templatesFor(context).map((template) => (
          <Button
            key={template.label}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => replaceLines(template.build(firstChosenCode))}
          >
            {template.label}
          </Button>
        ))}
      </div>

      <div className="rounded-md border">
        <div className="hidden grid-cols-[minmax(0,5fr)_minmax(0,3fr)_8rem_8rem_2.25rem] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Compte</span>
          <span>Libellé</span>
          <span className="text-right">Débit</span>
          <span className="text-right">Crédit</span>
          <span />
        </div>

        {/* Locked bank line: account, amount and side come from the bank transaction */}
        <div
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-b bg-muted/40 px-3 py-2 text-sm md:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_8rem_8rem_2.25rem] md:items-center"
          aria-label="Ligne bancaire verrouillée"
        >
          <div className="col-span-3 flex min-w-0 items-center gap-2 md:col-span-1">
            <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {context.bankAccount ? (
              <span className="truncate">
                <span className="font-mono font-medium">{context.bankAccount.code}</span> - {context.bankAccount.label}
              </span>
            ) : (
              <span className="text-destructive">Compte bancaire introuvable</span>
            )}
          </div>
          <span className="col-span-3 truncate text-muted-foreground md:col-span-1">{description || transaction.label || 'Transaction bancaire'}</span>
          <span className="text-right tabular-nums">
            {bankLine.debitCents ? (
              <>
                <span className="text-muted-foreground mr-1 text-xs md:hidden">Débit</span>
                {formatAmount(bankLine.debitCents / 100)}
              </>
            ) : (
              ''
            )}
          </span>
          <span className="text-right tabular-nums">
            {bankLine.creditCents ? (
              <>
                <span className="text-muted-foreground mr-1 text-xs md:hidden">Crédit</span>
                {formatAmount(bankLine.creditCents / 100)}
              </>
            ) : (
              ''
            )}
          </span>
          <span className="sr-only">Ligne fixée par la transaction bancaire</span>
        </div>

        {lines.map((l, index) => {
          const code = codeOf(l)
          const errors = showLineErrors(l) ? lineErrors(index, l) : []
          return (
            <div key={l.key} className="border-b px-3 py-2 last:border-b-0">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 md:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_8rem_8rem_2.25rem] md:items-start">
                <div className="col-span-3 min-w-0 space-y-1 md:col-span-1">
                  <div
                    className={cn(
                      'min-w-0 rounded-md',
                      errors.length > 0 && !code && 'ring-1 ring-destructive',
                    )}
                  >
                    <AccountCombobox
                      label={`Compte de la ligne ${index + 1}`}
                      accounts={accounts ?? []}
                      value={byCode.get(code)?.id ?? ''}
                      onValueChange={(id) =>
                        updateLine(l.key, { accountCode: (accounts ?? []).find((a) => a.id === id)?.code ?? '', hints: undefined })
                      }
                      placeholder={accountsLoading ? 'Chargement des comptes...' : 'Choisir un compte'}
                      className="w-full min-w-0"
                    />
                  </div>
                  {l.suggested && (
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      Suggestion
                    </Badge>
                  )}
                </div>
                <Input
                  className="col-span-3 md:col-span-1"
                  aria-label={`Libellé de la ligne ${index + 1}`}
                  value={l.description}
                  onChange={(e) => updateLine(l.key, { description: e.target.value })}
                  placeholder={description || 'Libellé'}
                />
                {/* Phones: Débit and Crédit side by side under the account, each named */}
                <div className="min-w-0 space-y-1">
                  <span aria-hidden className="text-muted-foreground block text-xs md:hidden">
                    Débit
                  </span>
                  <AmountInput
                    aria-label={`Débit de la ligne ${index + 1}`}
                    placeholder="0,00"
                    value={l.debitCents}
                    onValueChange={(cents) =>
                      updateLine(l.key, cents ? { debitCents: cents, creditCents: null } : { debitCents: cents })
                    }
                    onErrorChange={(error) => setInputError(`${l.key}.debit`, error)}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <span aria-hidden className="text-muted-foreground block text-xs md:hidden">
                    Crédit
                  </span>
                  <AmountInput
                    aria-label={`Crédit de la ligne ${index + 1}`}
                    placeholder="0,00"
                    value={l.creditCents}
                    onValueChange={(cents) =>
                      updateLine(l.key, cents ? { creditCents: cents, debitCents: null } : { creditCents: cents })
                    }
                    onErrorChange={(error) => setInputError(`${l.key}.credit`, error)}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Supprimer la ligne ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => removeLine(l.key)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {errors.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-sm text-destructive">
                  {errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 border-t bg-muted/20 px-3 py-2 text-sm font-medium md:grid-cols-[minmax(0,5fr)_minmax(0,3fr)_8rem_8rem_2.25rem] md:items-center">
          <div className="col-span-3 flex flex-wrap gap-2 md:col-span-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setLines((current) => [...current, line(transaction.side === 'debit' ? 'debit' : 'credit', 0, { debitCents: null, creditCents: null })])}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Ajouter une ligne
            </Button>
            {validation.totals.differenceCents !== 0 && lines.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={balanceOnLastLine}>
                Équilibrer sur la dernière ligne
              </Button>
            )}
          </div>
          <span className="col-span-3 text-muted-foreground md:col-span-1">Total</span>
          <span className="text-right tabular-nums">
            <span className="text-muted-foreground mr-1 text-xs font-normal md:hidden">Débit</span>
            {formatAmount(validation.totals.debitCents / 100)}
          </span>
          <span className="text-right tabular-nums">
            <span className="text-muted-foreground mr-1 text-xs font-normal md:hidden">Crédit</span>
            {formatAmount(validation.totals.creditCents / 100)}
          </span>
          <span />
        </div>
      </div>

      {(shownGlobalErrors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-2">
          {shownGlobalErrors.map((issue) => (
            <Alert key={issue.message} variant="destructive">
              <AlertDescription>{issue.message}</AlertDescription>
            </Alert>
          ))}
          {validation.warnings.map((issue) => (
            <Alert key={issue.message}>
              <AlertDescription>{issue.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      {/* Phones: the actions stay at the bottom of the dialog while the lines scroll. */}
      <div className="max-sm:bg-background flex flex-wrap items-center justify-end gap-2 max-sm:sticky max-sm:-bottom-6 max-sm:z-10 max-sm:-mx-6 max-sm:border-t max-sm:px-6 max-sm:py-3">
        {accountsLoading && (
          <span className="mr-auto flex items-center text-sm text-muted-foreground" role="status">
            <Loader2 aria-hidden className="mr-2 size-3.5 animate-spin" />
            Chargement du plan comptable...
          </span>
        )}
        {errorsHidden && (
          // Own row: next to the three buttons it pushed "Enregistrer et suivant" to a line of its own
          <Button type="button" variant="link" size="sm" className="text-muted-foreground basis-full justify-start whitespace-normal text-left" onClick={() => setAttempted(true)}>
            Choisissez un compte et un montant sur chaque ligne pour enregistrer&nbsp;: afficher les erreurs
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Annuler
        </Button>
        <Button type="button" variant={hasNext ? 'outline' : 'default'} disabled={blocked} loading={submitting} onClick={() => submit(false)}>
          Enregistrer
        </Button>
        {hasNext && (
          <Button type="button" disabled={blocked} loading={submitting} onClick={() => submit(true)} title={`Raccourci\u00a0: ${shortcut}`}>
            Enregistrer et suivant
            <kbd className="ml-2 hidden rounded border border-primary-foreground/30 px-1 text-[10px] font-normal sm:inline">
              {shortcut}
            </kbd>
          </Button>
        )}
      </div>
    </div>
  )
}
