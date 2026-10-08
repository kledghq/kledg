/**
 * State, conversions and wording of the assignment rule editor
 * (/[companyId]/rules/new and /[companyId]/rules/[id]). Pure functions: the
 * editor, its preview and the tests share them.
 *
 * The editor holds account ids (what the account pickers use) and converts
 * them to account codes when it saves or simulates: rules store codes
 * (lib/transactions/manage-rules.service.ts). The request bodies are the
 * ones the former dialog sent, field for field.
 */

import { logger } from '@/lib/logger'
import { bankVatInEuros } from '@/lib/banking/bank-vat'
import { toCents } from '@/lib/utils/money'

export interface Account {
  id: string
  code: string
  label: string
}

export interface Journal {
  id: string
  code: string
  label: string
}

/** A saved rule, as GET /api/transaction-rules lists it. */
export interface SavedRule {
  id: string
  name: string
  description: string | null
  enabled: boolean
  priority: number
  journalCode: string
  defaultVatAccountCode: string | null
  autoCreate: boolean
  usageCount?: number
  conditions: Array<{
    id: string
    conditionType: string
    operator: string
    value: string | null
    value2: string | null
  }>
  entryLines: Array<{
    id: string
    accountCode: string
    lineType: string
    amountType: string
    amountValue: number | null
    description: string | null
    order: number
    vatType: string | null
    vatRateSource?: string | null
    vatRate: number | null
    vatAccountCode: string | null
    vatAccount2Code: string | null
    vatOnDebit: boolean
  }>
}

export interface Condition {
  id: string
  conditionType: string
  operator: string
  value: string
  value2?: string
}

export type VatType = 'none' | 'collectible' | 'deductible' | 'intracom' | 'import' | 'exempt' | 'reverse_charge'
export type VatRateSource = 'fixed' | 'transaction'

export interface EntryLine {
  id: string
  accountId: string
  lineType: 'debit' | 'credit'
  amountType: 'full' | 'percentage' | 'fixed' | 'remaining' | 'ht' | 'ttc' | 'vat'
  amountValue?: number
  description?: string
  order: number
  vatType?: VatType
  /** 'fixed' = rate entered on the line, 'transaction' = VAT detected by the bank (e.g. Qonto). */
  vatRateSource?: VatRateSource
  vatRate?: number
  vatAccountId?: string
  vatAccount2Id?: string
  vatOnDebit?: boolean
}

/** Entry lines from a prefill may use lineType 'auto'; it becomes 'debit' in the editor. */
export type EntryLineInput = Omit<EntryLine, 'lineType'> & { lineType: 'debit' | 'credit' | 'auto' }

export interface RuleFormState {
  name: string
  description: string
  enabled: boolean
  priority: number
  journalCode: string
  defaultVatAccountId: string
  autoCreate: boolean
  conditions: Condition[]
  entryLines: EntryLine[]
}

function normalizeEntryLines(lines: EntryLineInput[]): EntryLine[] {
  return lines.map((l) => ({
    ...l,
    lineType: l.lineType === 'auto' ? 'debit' : l.lineType,
  }))
}

/** Prefill of a new rule (from a transaction, a subscription or the Démarrer checklist). */
export interface RulePrefill {
  name?: string
  description?: string
  journalCode?: string
  conditions?: Condition[]
  entryLines?: EntryLineInput[]
}

/** The form of a new rule: defaults of the former dialog, then the prefill. */
export function newRuleState(prefill: RulePrefill = {}): RuleFormState {
  return {
    name: prefill.name || '',
    description: prefill.description || '',
    enabled: true,
    priority: 0,
    journalCode: prefill.journalCode || 'BQ',
    defaultVatAccountId: '',
    autoCreate: false,
    conditions: prefill.conditions ?? [],
    entryLines: normalizeEntryLines(prefill.entryLines ?? []),
  }
}

/** The form of a saved rule, account codes resolved to the ids of the chart ('' when missing). */
export function savedRuleState(rule: SavedRule, accounts: Account[]): RuleFormState {
  const codeToId = new Map(accounts.map((a) => [a.code, a.id]))
  const resolveCode = (code: string | null | undefined) => (code ? (codeToId.get(code) ?? '') : '')
  return {
    name: rule.name,
    description: rule.description || '',
    enabled: rule.enabled,
    priority: rule.priority,
    journalCode: rule.journalCode,
    defaultVatAccountId: resolveCode(rule.defaultVatAccountCode),
    autoCreate: rule.autoCreate,
    conditions: rule.conditions.map((c) => ({
      id: c.id,
      conditionType: c.conditionType || 'label',
      operator: c.operator || 'contains',
      value: c.value || '',
      value2: c.value2 || '',
    })),
    entryLines: rule.entryLines.map((l) => ({
      id: l.id,
      accountId: resolveCode(l.accountCode),
      lineType: (l.lineType === 'auto' ? 'debit' : l.lineType) as EntryLine['lineType'],
      amountType: l.amountType as EntryLine['amountType'],
      amountValue: l.amountValue ? Number(l.amountValue) : undefined,
      description: l.description || undefined,
      order: l.order,
      vatType: (l.vatType || 'none') as VatType,
      vatRateSource: l.vatRateSource === 'transaction' ? 'transaction' : 'fixed',
      vatRate: l.vatRate ? Number(l.vatRate) : undefined,
      vatAccountId: resolveCode(l.vatAccountCode) || undefined,
      vatAccount2Id: resolveCode(l.vatAccount2Code) || undefined,
      vatOnDebit: l.vatOnDebit,
    })),
  }
}

function codeLookup(accounts: Account[]) {
  const idToCode = new Map(accounts.map((a) => [a.id, a.code]))
  return (id: string | undefined | null) => (id ? (idToCode.get(id) ?? null) : null)
}

/** Entry lines as the API takes them (POST/PUT /api/transaction-rules and the simulate endpoint). */
function entryLinesPayload(lines: EntryLine[], accounts: Account[]) {
  const codeOf = codeLookup(accounts)
  return lines.map((l) => ({
    accountCode: codeOf(l.accountId) ?? '',
    lineType: l.lineType,
    amountType: l.amountType,
    amountValue: l.amountValue || null,
    description: l.description || null,
    order: l.order,
    vatType: l.vatType || null,
    vatRateSource: l.vatRateSource ?? 'fixed',
    vatRate: l.vatRate || null,
    vatAccountCode: codeOf(l.vatAccountId),
    vatAccount2Code: codeOf(l.vatAccount2Id),
    vatOnDebit: l.vatOnDebit || false,
  }))
}

/** Body of POST /api/transaction-rules and PUT /api/transaction-rules/[id]. */
export function savePayload(state: RuleFormState, companyId: string, accounts: Account[]) {
  const codeOf = codeLookup(accounts)
  return {
    companyId,
    name: state.name,
    description: state.description || null,
    enabled: state.enabled,
    priority: state.priority,
    journalCode: state.journalCode,
    defaultVatAccountCode: codeOf(state.defaultVatAccountId),
    autoCreate: state.autoCreate,
    conditions: state.conditions.map((c) => ({
      conditionType: c.conditionType,
      operator: c.operator,
      value: c.value || null,
      value2: c.value2 || null,
    })),
    entryLines: entryLinesPayload(state.entryLines, accounts),
  }
}

/** `ruleData` of POST /api/transaction-rules/simulate. */
export function simulationRuleData(state: Pick<RuleFormState, 'entryLines' | 'defaultVatAccountId'>, accounts: Account[]) {
  return {
    entryLines: entryLinesPayload(state.entryLines, accounts),
    defaultVatAccountCode: codeLookup(accounts)(state.defaultVatAccountId),
  }
}

/**
 * The reason a rule cannot be saved yet, in the words of the former dialog,
 * or null. `unbalanced` is true when the preview of a rule that books its
 * own bank line (51x) does not balance.
 */
export function saveBlocker(state: RuleFormState, companyId: string, accounts: Account[], unbalanced: boolean): string | null {
  if (!companyId || !state.name) return 'Le nom est requis'
  if (state.conditions.length === 0) return 'Au moins une condition est requise'
  if (state.entryLines.length === 0) return "Au moins une ligne d'écriture est requise"
  if (unbalanced) return "La simulation doit être équilibrée avant d'enregistrer la règle"
  const codeOf = codeLookup(accounts)
  if (state.entryLines.some((l) => !codeOf(l.accountId))) return 'Chaque ligne doit être associée à un compte du plan comptable'
  return null
}

/** True when a line of the rule is on a bank account (51x): the rule writes its own bank line. */
export function hasBankLine(lines: EntryLine[], accounts: Account[]): boolean {
  const codeOf = codeLookup(accounts)
  return lines.some((l) => codeOf(l.accountId)?.startsWith('51') ?? false)
}

// Priority: the highest wins when several rules match (pickRule in
// lib/transactions/rule-matcher.ts). New rules start at 0, which stays
// "Normale"; any integer is accepted by the API.
export const PRIORITY_PRESETS = [
  { id: 'high', label: 'Haute', value: 10 },
  { id: 'normal', label: 'Normale', value: 0 },
  { id: 'low', label: 'Basse', value: -10 },
] as const

export type PriorityPreset = (typeof PRIORITY_PRESETS)[number]['id']

/** The preset of a priority, or null for a value set by hand (Avancé). */
export function priorityPresetOf(priority: number): PriorityPreset | null {
  return PRIORITY_PRESETS.find((p) => p.value === priority)?.id ?? null
}

export function priorityOfPreset(preset: PriorityPreset): number {
  return PRIORITY_PRESETS.find((p) => p.id === preset)!.value
}

export const CONDITION_TYPES: Array<{ value: string; label: string }> = [
  { value: 'label', label: 'Libellé' },
  { value: 'reference', label: 'Référence' },
  { value: 'counterparty', label: 'Contrepartie' },
  { value: 'category', label: 'Catégorie' },
  { value: 'cashflowCategory', label: 'Catégorie de flux' },
  { value: 'cashflowSubcategory', label: 'Sous-catégorie' },
  { value: 'operationType', label: "Type d'opération" },
  { value: 'side', label: 'Sens (débit/crédit)' },
  { value: 'status', label: 'Statut' },
  { value: 'attachment', label: 'Justificatif' },
  { value: 'amount', label: 'Montant' },
]

/** Condition types compared with "equals" only, their value picked in a list. */
export const LIST_CONDITION_TYPES = ['side', 'operationType', 'status', 'attachment']

const AMOUNT_OPERATORS = [
  { value: 'equals', label: 'Égal à' },
  { value: 'gt', label: 'Supérieur à' },
  { value: 'gte', label: 'Supérieur ou égal à' },
  { value: 'lt', label: 'Inférieur à' },
  { value: 'lte', label: 'Inférieur ou égal à' },
  { value: 'between', label: 'Entre' },
]

const TEXT_OPERATORS = [
  { value: 'equals', label: 'Égal à' },
  { value: 'contains', label: 'Contient' },
  { value: 'startsWith', label: 'Commence par' },
  { value: 'regex', label: 'Expression régulière' },
]

export const CONDITION_VALUE_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  side: [
    { value: 'debit', label: 'Débit' },
    { value: 'credit', label: 'Crédit' },
  ],
  status: [
    { value: 'completed', label: 'Complétée' },
    { value: 'pending', label: 'En attente' },
    { value: 'declined', label: 'Refusée' },
  ],
  attachment: [
    { value: 'yes', label: 'Avec justificatif' },
    { value: 'no', label: 'Sans justificatif' },
  ],
  operationType: [
    { value: 'card', label: 'Carte' },
    { value: 'transfer', label: 'Virement' },
    { value: 'direct_debit', label: 'Prélèvement' },
    { value: 'sepa', label: 'SEPA' },
    { value: 'check', label: 'Chèque' },
  ],
}

export function operatorsOf(conditionType: string) {
  if (conditionType === 'amount') return AMOUNT_OPERATORS
  if (LIST_CONDITION_TYPES.includes(conditionType)) return AMOUNT_OPERATORS.slice(0, 1)
  return TEXT_OPERATORS
}

export function conditionPlaceholder(conditionType: string): string {
  switch (conditionType) {
    case 'label':
      return 'Ex : Qonto, Stripe...'
    case 'reference':
      return 'Ex : REF-12345...'
    case 'counterparty':
      return 'Ex : Insify, Microsoft...'
    case 'category':
      return 'Ex : insurance, software...'
    case 'cashflowCategory':
      return 'Ex : Dépenses administratives...'
    case 'cashflowSubcategory':
      return "Ex : Frais d'assurance..."
    case 'amount':
      return 'Montant (€)'
    default:
      return 'Valeur'
  }
}

/** A condition as a sentence: Libellé contient « Adobe ». Null while its value is empty. */
export function describeCondition(condition: Condition): string | null {
  const type = CONDITION_TYPES.find((t) => t.value === condition.conditionType)?.label ?? condition.conditionType
  const operator = operatorsOf(condition.conditionType).find((o) => o.value === condition.operator)?.label
  if (!condition.value) return null
  const options = CONDITION_VALUE_OPTIONS[condition.conditionType]
  const value = options?.find((o) => o.value === condition.value)?.label ?? condition.value
  const subject = type.replace(' (débit/crédit)', '')
  if (condition.operator === 'between') {
    return `${subject} entre ${quoted(condition.value, condition.conditionType)} et ${quoted(condition.value2 || '', condition.conditionType)}`
  }
  return `${subject} ${(operator ?? condition.operator).toLowerCase()} ${quoted(value, condition.conditionType)}`
}

function quoted(value: string, conditionType: string): string {
  return conditionType === 'amount' ? `${value.replace('.', ',')} €` : `« ${value} »`
}

export const VAT_TYPES: Array<{ value: VatType; label: string }> = [
  { value: 'none', label: 'Aucune' },
  { value: 'collectible', label: 'Collectée' },
  { value: 'deductible', label: 'Déductible' },
  { value: 'intracom', label: 'Intracommunautaire' },
  { value: 'import', label: 'Import' },
  { value: 'exempt', label: 'Exonérée' },
  { value: 'reverse_charge', label: 'Autoliquidation' },
]

export const hasVat = (line: Pick<EntryLine, 'vatType'>) => !!line.vatType && line.vatType !== 'none'

/** VAT booked on a debit and a credit account (self-assessed): intracommunity and import purchases. */
export const isSelfAssessed = (line: Pick<EntryLine, 'vatType'>) => line.vatType === 'intracom' || line.vatType === 'import'

/**
 * Rate source of a line that starts carrying VAT. Bank detection when a
 * connected bank provides the VAT of its transactions (Qonto), except for
 * self-assessed VAT: the bank sees no VAT on an intracommunity or import
 * purchase (the supplier invoices without it), so the rate is entered.
 */
export function defaultVatRateSource(vatType: VatType, bankProvidesVat: boolean): VatRateSource {
  if (!bankProvidesVat) return 'fixed'
  return vatType === 'intracom' || vatType === 'import' ? 'fixed' : 'transaction'
}

/** Banks whose synchronised transactions carry the detected VAT (lib/banking/providers/qonto.ts). */
export const VAT_DETECTING_PROVIDERS = ['QONTO']

/** A bank transaction as GET /api/transactions lists it (the fields the preview reads). */
export interface PreviewTransaction {
  id: string
  date: string
  label: string | null
  reference: string | null
  side: string
  amount: number
  counterpartyName: string | null
  vatRate?: number | string | null
  vatAmount?: number | string | null
  providerData?: unknown
  [key: string]: unknown
}

/**
 * VAT detected by the bank on a transaction, read as the rule executor
 * reads it (lib/banking/bank-vat.ts, one rule for every module): the stored
 * columns first, then the provider payload, only what can be trusted on the
 * amount paid. Null when the bank detected nothing usable.
 */
export function transactionVatOf(tx: PreviewTransaction): { vatRate: number | null; vatAmount: number | null } | null {
  return bankVatInEuros(tx, Math.abs(toCents(tx.amount) ?? 0))
}

/** Parses a JSON array passed in the URL by "Créer une règle à partir de cette transaction". */
export function parseJsonArray(raw: string | null): Array<Record<string, unknown>> {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      : []
  } catch (error) {
    logger.error('Error parsing rule prefill:', error)
    return []
  }
}

export const toConditions = (items: Array<Record<string, unknown>>): Condition[] =>
  items.map((c, idx) => ({ ...c, id: `temp-${idx}` }) as Condition)

export const toEntryLines = (items: Array<Record<string, unknown>>): EntryLineInput[] =>
  items.map((l, idx) => ({ ...l, id: `temp-${idx}`, order: idx }) as EntryLineInput)
