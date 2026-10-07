/**
 * Confirmation of a simple mode line (docs/categories-simples.md): the bank
 * transaction gets its entry, through the reconciliation service like the
 * "Traiter la transaction" dialog (createEntryAndReconcile: the transaction
 * is claimed under its row lock, the entry created by createEntryInTx and
 * linked, all or nothing; a second confirmation is a 409).
 *
 * The lines:
 * - a category: the counterpart lines of posting.ts (charge or product, the
 *   recoverable or collected VAT) on the accounts of the fiscal year of the
 *   transaction date (ledger-accounts.ts), plus the bank line on 512
 *   (resolveBankLedgerAccount), in the BQ journal;
 * - a transaction rule the user accepts as suggested: the rule's own entry
 *   (prepareRuleEntry), exactly as "Appliquer la règle";
 * - an open sales invoice a credit pays (invoice-receipts.service.ts): the
 *   bank line and the customer line (411 of the invoice entry, with the
 *   customer's auxiliary account) for the amount received. Once the entry
 *   is validated, the payment is recorded on the invoice by the invoices
 *   module, which letters it when its payments cover it.
 *
 * Draft or validated: with accountant review (simple-mode-settings.service.ts)
 * the entry stays a draft "à valider"; without it, it is validated at once
 * (validateEntryInTx in the same transaction) when the user may validate
 * entries. The MCP tool always leaves a draft. Either way a
 * simple_mode_entries row records the category, the answers, the note and
 * the counterparty key, in the same transaction.
 *
 * Durable equipment: when the user answers that a purchase above 500 € HT
 * will be used more than a year, the entry books it to the fixed asset
 * account and the fixed asset is created in the same transaction, through
 * the fixed assets service (createFixedAssetInTx): the amount excluding the
 * recovered VAT (the debited asset line), the transaction date as
 * acquisition and depreciation start, linear depreciation over the usual
 * life of the category (asset-lifetimes.ts), the entry as its acquisition
 * entry. The simple_mode_entries row records the asset. Undoing the
 * reconciliation deletes the asset with the draft, or is refused when the
 * asset cannot be deleted (deleteFixedAssetsAcquiredByEntryInTx).
 *
 * Repeated identical choices teach a rule: when the last three
 * confirmations for a counterparty chose the same category, and that
 * category books the same way every time (no question that depends on the
 * purchase, no partial VAT recovery a rule cannot express), a transaction
 * rule is created, or the one simple mode created for it updated. Rules
 * created this way are suggestions (autoCreate off): the user still confirms.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, ValidationError } from '@/lib/accounting/errors'
import { writeAuditLog } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { vatDeductionOn, type VatDeductionOnDay } from '@/lib/vat-deduction/coefficient'
import { counterpartyOf } from '@/lib/reconciliation/prefill'
import {
  bankAccountMissingMessage,
  createEntryAndReconcile,
  fiscalYearPeriods,
  loadTransaction,
  MESSAGES as RECONCILIATION_MESSAGES,
  normalizeSide,
  resolveBankLedgerAccount,
  type GeneratedLine,
} from '@/lib/reconciliation/service'
import { bankLineOf, checkEntryDate } from '@/lib/reconciliation/validation'
import { prepareRuleEntry } from '@/lib/transactions/rule-executor'
import { createRule, updateRule, type RuleInput } from '@/lib/transactions/manage-rules.service'
import { counterpartyKey } from '@/lib/subscriptions/detect'
import { createFixedAssetInTx } from '@/lib/fixed-assets/create-fixed-asset.service'
import { centsToDecimal, toCents } from '@/lib/utils/money'
import { formatIsoDateFr, isoDateToUtc, toIsoDateUtc } from '@/lib/utils/date'
import { EXPLOITANT_MEAL_ANSWER, findCategory, type Posting, type SimpleCategory } from './categories'
import { mealRulesOn, nonDeductibleMealsAccount } from '@/lib/expense-reports/meal-rule.service'
import { mealSplitReason, NON_DEDUCTIBLE_MEALS_ACCOUNT } from '@/lib/expense-reports/exploitant-meals'
import { buildPostingLines, isExploitantMeal, resolvePosting, VAT_COLLECTED, VAT_DEDUCTIBLE, VAT_ON_ASSETS, type Answers, type CounterpartLine } from './posting'
import { resolveLedgerAccounts } from './ledger-accounts'
import { assetLifetimeFor, DEPRECIATION_EXPENSE_ACCOUNT } from './asset-lifetimes'
import { accountantReviewRequired } from './simple-mode-settings.service'
import { bankVatCentsOf, loadSuggestionSignals, suggestionFor } from './expenses-to-review.service'
import { displayNameOf } from './payees'
import { fitsSide, type Suggestion } from './suggest'
import { INVOICE_MESSAGES, invoiceToPay, recordValidatedInvoicePayments } from './invoice-receipts.service'

/** Identical consecutive choices for a counterparty that teach a rule. */
export const LEARN_AFTER = 3

const answersSchema = z.record(z.string().max(40), z.string().max(40)).optional()

/** Body of POST /api/simple/expenses/[id]/confirm. Neither category, rule nor invoice: the suggestion as proposed. */
export const ConfirmExpenseBodySchema = z.object({
  categoryId: z.string().min(1).max(64).optional(),
  ruleId: z.string().min(1).max(64).optional(),
  /** Sales invoice a credit pays (money in). */
  invoiceId: z.string().min(1).max(64).optional(),
  answers: answersSchema,
  note: z.string().trim().max(1000, 'Note trop longue : 1 000 caractères au plus').optional(),
  /** false: never create or update a rule from this choice. */
  learn: z.boolean().optional(),
})
export type ConfirmExpenseInput = z.infer<typeof ConfirmExpenseBodySchema>

/** Body of POST /api/simple/expenses/confirm-all. */
export const ConfirmAllBodySchema = z.object({
  transactionIds: z.array(z.string().min(1).max(64)).min(1, 'Aucune dépense à confirmer').max(200),
})

export interface ConfirmActor {
  userId: string | null
  /** The user may validate entries (entries:validate). */
  canValidate: boolean
  /** web: the page; mcp: an assistant (always a draft). */
  source: 'web' | 'mcp'
}

export interface ConfirmResult {
  transactionId: string
  entryId: string
  entryNumber: string
  status: 'draft' | 'validated'
  /** The entry waits for the accountant. */
  needsReview: boolean
  categoryId: string | null
  ruleId: string | null
  lines: Array<{ accountCode: string; debitCents: number; creditCents: number }>
  /** VAT explanation for the accountant. */
  vatNote: string | null
  /** Meal alone of the exploitant at a company taxed at IR: the split and its reason (or why it could not be decided). */
  mealNote: string | null
  learnedRule: { id: string; name: string; created: boolean } | null
  /** Fixed asset created with the entry (durable equipment). */
  fixedAsset: { id: string; label: string; years: number; amountCents: number } | null
  /**
   * Sales invoice the credit pays: whether the payment is recorded on it
   * (validated entry) or waits for the accountant's validation, whether it
   * is lettered, what is left to pay, and why not yet when it is not.
   */
  invoice: { id: string; number: string; customerName: string; recorded: boolean; lettered: boolean; remainingCents: number | null; pending: string | null } | null
}

export const MESSAGES = {
  unknownCategory: 'Catégorie inconnue : choisissez-en une dans la liste.',
  nothingToConfirm: 'Kledg ne propose pas de catégorie pour cette opération : choisissez-la avec « Modifier ».',
  wrongSide: (label: string, side: 'debit' | 'credit') =>
    side === 'debit'
      ? `« ${label} » est une entrée d’argent, et cette opération une sortie : choisissez une catégorie de dépense.`
      : `« ${label} » est une dépense, et cette opération une entrée d’argent : choisissez une recette, ou le remboursement de cette dépense.`,
  journalMissing: "Le journal de banque (BQ) n'existe pas : demandez à votre comptable de le créer dans Journaux.",
} as const

interface Prepared {
  fiscalYearId: string
  journalId: string
  date: Date
  description: string
  lines: GeneratedLine[]
  categoryId: string | null
  ruleId: string | null
  answers: Answers | null
  vatNote: string | null
  /** Split of a meal of the exploitant, or why it could not be decided. */
  mealNote: string | null
  /** Category posting with its resolved account codes, for learning a rule. */
  learnable: { category: SimpleCategory; posting: Posting; codes: Map<string, string> } | null
  /** The fixed asset to create with the entry (durable equipment). */
  asset: PreparedAsset | null
  /** The sales invoice the credit pays. */
  invoice: { id: string; number: string; customerName: string } | null
}

interface PreparedAsset {
  label: string
  comment: string
  acquisitionCents: number
  years: number
  assetAccountId: string
  depreciationAccountId: string
  expenseAccountId: string
}

/** The franchise and the share of deductible VAT recovered on the day (provisional coefficient de déduction). */
async function deductionFor(companyId: string, day: string): Promise<VatDeductionOnDay> {
  return vatDeductionOn(companyId, day)
}

/** A category books the same way every time, so a rule can repeat it. */
function canLearn(category: SimpleCategory, posting: Posting, franchise: boolean): boolean {
  // A refund reverses a charge and its VAT: rules book the charge side only
  if (category.kind === 'refund') return false
  if (category.question && !category.question.reusable) return false
  if (posting.vatRule === 'fuel' || posting.vatRule === 'gift') return false
  // A rule books the collected VAT of its rate: a company under the franchise collects none (CGI art. 293 B)
  if (franchise && category.kind === 'income' && posting.vatRateBp > 0) return false
  return true
}

async function prepareCategory(
  companyId: string,
  transaction: Awaited<ReturnType<typeof loadTransaction>>,
  category: SimpleCategory,
  answers: Answers,
): Promise<Prepared> {
  const day = toIsoDateUtc(transaction.date)
  const dateCheck = checkEntryDate(await fiscalYearPeriods(companyId), day)
  if (dateCheck.error !== null) throw new ValidationError(dateCheck.error)
  const fiscalYear = dateCheck.fiscalYear

  const amountCents = Math.abs(toCents(transaction.amount) ?? 0)
  const bankVatCents = bankVatCentsOf(transaction)
  const resolution = resolvePosting(category, answers, amountCents, bankVatCents)
  if (resolution.status === 'pending') {
    throw new ValidationError(`Répondez d'abord à la question : ${resolution.question.text}`).withDetails({ question: resolution.question })
  }
  if (resolution.status === 'invalid') throw new ValidationError(resolution.message)

  const side = normalizeSide(transaction.side)
  const mealQuestion = resolution.question?.id === EXPLOITANT_MEAL_ANSWER.questionId
  const [deduction, mealRule] = await Promise.all([
    deductionFor(companyId, day),
    mealQuestion ? mealRulesOn(companyId, [day]).then((rules) => rules.get(day)!) : null,
  ])
  // At IR, who ate changes what is deductible: the meal question has no default
  if (mealRule?.applies && !answers[EXPLOITANT_MEAL_ANSWER.questionId]) {
    throw new ValidationError(`Répondez d'abord à la question\u00a0: ${resolution.question!.text}`).withDetails({ question: resolution.question })
  }
  // A meal alone of the exploitant, at a company taxed at the impôt sur le revenu: only the frais supplémentaires are deductible
  const exploitantMeal = mealRule?.applies && isExploitantMeal(resolution.answers) ? { year: Number(day.slice(0, 4)) } : null
  const plan = buildPostingLines({ category, posting: resolution.posting, kind: resolution.kind, side, amountCents, bankVatCents, recoveryRatio: deduction.share, franchise: deduction.franchise, exploitantMeal })
  const nonDeductibleLine = plan.lines.find((l) => l.role === 'non-deductible')

  // Durable equipment: the asset line of the posting, with the category's depreciation accounts
  const lifetime = resolution.posting.account.startsWith('2') ? assetLifetimeFor(category.id) : null
  const assetLine = lifetime ? plan.lines.find((l) => l.role === 'base' && l.accountCode === resolution.posting.account && l.debitCents > 0) : undefined
  const depreciationCodes = lifetime && assetLine ? [lifetime.depreciationAccount, DEPRECIATION_EXPENSE_ACCOUNT] : []

  const accounts = await resolveLedgerAccounts(companyId, fiscalYear.id, [...plan.lines.filter((l) => l !== nonDeductibleLine).map((l) => l.accountCode), ...depreciationCodes])
  if (nonDeductibleLine) {
    // Never the parent 6256: the account of the add-back is created when the chart lacks it
    const deductible = accounts.get(resolution.posting.account)
    const account = await nonDeductibleMealsAccount(prisma, companyId, fiscalYear.id, deductible?.code ?? resolution.posting.account)
    accounts.set(nonDeductibleLine.accountCode, { ...account, label: NON_DEDUCTIBLE_MEALS_ACCOUNT.label })
  }
  // An exact account (the VAT credit 44567) is never replaced by its parent
  const missing = [...plan.lines.map((l) => l.accountCode), ...depreciationCodes].find(
    (code) => !accounts.get(code) || (category.exactAccount && code === category.posting.account && !accounts.get(code)!.code.startsWith(code)),
  )
  if (missing) {
    throw new ValidationError(
      `La catégorie « ${category.label} » n'a pas de compte dans le plan comptable de l'exercice ${fiscalYear.year} : demandez à votre comptable de compléter le plan de comptes.`,
    )
  }
  const bank = await resolveBankLedgerAccount(companyId, fiscalYear.id)
  if (!bank) throw new ValidationError(bankAccountMissingMessage(fiscalYear.year))
  const journal = await prisma.journal.findFirst({ where: { companyId, code: 'BQ' }, select: { id: true } })
  if (!journal) throw new ValidationError(MESSAGES.journalMissing)

  const name = displayNameOf(counterpartyOf(transaction), transaction.label)
  const description = transaction.label?.trim() || name
  const vatLabel = (line: CounterpartLine) =>
    line.accountCode === VAT_COLLECTED ? 'TVA collectée' : line.accountCode === VAT_ON_ASSETS ? 'TVA sur immobilisation' : line.accountCode === VAT_DEDUCTIBLE ? 'TVA déductible' : 'TVA'
  const lines: GeneratedLine[] = [
    { accountId: bank.id, ...bankLineOf({ amountCents, side }), description },
    ...plan.lines.map((line) => ({
      accountId: accounts.get(line.accountCode)!.id,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      description:
        line.role === 'vat' ? `${vatLabel(line)}, ${name}` : line.role === 'non-deductible' ? `${category.label}, ${name}, part non déductible (repas de l’exploitant)` : `${category.label}, ${name}`,
    })),
  ]
  const codes = new Map(plan.lines.map((l) => [l.accountCode, accounts.get(l.accountCode)!.code]))
  const asset: PreparedAsset | null =
    lifetime && assetLine
      ? {
          label: `${category.label} (${name})`,
          comment: `Créée par le mode simple à la confirmation du paiement du ${formatIsoDateFr(day)} (${description}).`,
          acquisitionCents: assetLine.debitCents,
          years: lifetime.years,
          assetAccountId: accounts.get(assetLine.accountCode)!.id,
          depreciationAccountId: accounts.get(lifetime.depreciationAccount)!.id,
          expenseAccountId: accounts.get(DEPRECIATION_EXPENSE_ACCOUNT)!.id,
        }
      : null
  return {
    fiscalYearId: fiscalYear.id,
    journalId: journal.id,
    date: isoDateToUtc(day),
    description,
    lines,
    categoryId: category.id,
    ruleId: null,
    answers: Object.keys(resolution.answers).length ? resolution.answers : null,
    vatNote: plan.vatNote,
    mealNote: plan.mealSplit ? mealSplitReason(plan.mealSplit) : mealRule?.unknown && isExploitantMeal(resolution.answers) ? mealRule.explanation : null,
    learnable: canLearn(category, resolution.posting, deduction.franchise) ? { category, posting: resolution.posting, codes } : null,
    asset,
    invoice: null,
  }
}

/**
 * A credit that pays an open sales invoice: the bank line and the customer
 * line of the invoice (same account code, in the fiscal year of the payment,
 * with the customer's auxiliary account), so the invoices module accepts it
 * as the payment (recordInvoicePayment: same account, opposite side, same
 * tiers, at most what is left to pay).
 */
async function prepareInvoice(companyId: string, transaction: Awaited<ReturnType<typeof loadTransaction>>, invoiceId: string): Promise<Prepared> {
  const side = normalizeSide(transaction.side)
  if (side !== 'credit') throw new ValidationError(INVOICE_MESSAGES.moneyOut)
  const amountCents = Math.abs(toCents(transaction.amount) ?? 0)
  const invoice = await invoiceToPay(companyId, invoiceId, amountCents)

  const day = toIsoDateUtc(transaction.date)
  const dateCheck = checkEntryDate(await fiscalYearPeriods(companyId), day)
  if (dateCheck.error !== null) throw new ValidationError(dateCheck.error)
  const fiscalYear = dateCheck.fiscalYear
  const customerAccount = await prisma.account.findFirst({ where: { companyId, fiscalYearId: fiscalYear.id, code: invoice.customerAccountCode }, select: { id: true } })
  if (!customerAccount) {
    throw new ValidationError(
      `Le compte clients de la facture n° ${invoice.number} n'existe pas dans le plan comptable de l'exercice ${fiscalYear.year} : demandez à votre comptable de compléter le plan de comptes.`,
    )
  }
  const bank = await resolveBankLedgerAccount(companyId, fiscalYear.id)
  if (!bank) throw new ValidationError(bankAccountMissingMessage(fiscalYear.year))
  const journal = await prisma.journal.findFirst({ where: { companyId, code: 'BQ' }, select: { id: true } })
  if (!journal) throw new ValidationError(MESSAGES.journalMissing)

  const description = transaction.label?.trim() || displayNameOf(counterpartyOf(transaction), transaction.label)
  const lineDescription = `Facture n° ${invoice.number}, ${invoice.customerName}`
  return {
    fiscalYearId: fiscalYear.id,
    journalId: journal.id,
    date: isoDateToUtc(day),
    description,
    lines: [
      { accountId: bank.id, ...bankLineOf({ amountCents, side }), description },
      {
        accountId: customerAccount.id,
        debitCents: 0,
        creditCents: amountCents,
        description: lineDescription,
        auxiliaryAccountNumber: invoice.auxiliaryAccountNumber,
        auxiliaryAccountLabel: invoice.customerName,
      },
    ],
    categoryId: null,
    ruleId: null,
    answers: null,
    vatNote: null,
    mealNote: null,
    learnable: null,
    asset: null,
    invoice: { id: invoice.id, number: invoice.number, customerName: invoice.customerName },
  }
}

async function prepareRule(companyId: string, transactionId: string, ruleId: string, categoryId: string | null): Promise<Prepared> {
  const prepared = await prepareRuleEntry(ruleId, transactionId, companyId)
  if (!prepared.ok) {
    if (prepared.status === 409) throw new ConflictError(prepared.error)
    throw new ValidationError(prepared.error)
  }
  return {
    fiscalYearId: prepared.fiscalYearId,
    journalId: prepared.journalId,
    date: prepared.date,
    description: prepared.description,
    lines: prepared.lines,
    categoryId,
    ruleId,
    answers: null,
    vatNote: null,
    mealNote: null,
    learnable: null,
    asset: null,
    invoice: null,
  }
}

/** The rule's entry lines for a category posting, on the chart's actual codes. */
function learnedRuleLines(learnable: NonNullable<Prepared['learnable']>): RuleInput['entryLines'] {
  const { category, posting, codes } = learnable
  const account = codes.get(posting.account) ?? posting.account
  const recovers = posting.vatRateBp > 0 && (posting.vatRule === 'standard' || category.kind === 'income')
  if (category.kind === 'other' || !recovers) {
    return [{ accountCode: account, lineType: 'auto', amountType: 'full', order: 0 }]
  }
  const vatAccount = category.kind === 'income' ? VAT_COLLECTED : posting.account.startsWith('2') ? VAT_ON_ASSETS : VAT_DEDUCTIBLE
  return [
    {
      accountCode: account,
      lineType: 'auto',
      amountType: 'full',
      order: 0,
      vatType: category.kind === 'income' ? 'collectible' : 'deductible',
      // The VAT the bank read when there is one, else the category's rate
      vatRateSource: 'transaction',
      vatRate: posting.vatRateBp / 100,
      vatAccountCode: codes.get(vatAccount) ?? vatAccount,
    },
  ]
}

const sameLines = (a: RuleInput['entryLines'], b: Array<{ accountCode: string; vatRate: { toString(): string } | null; vatAccountCode: string | null }>) =>
  (a ?? []).length === b.length &&
  (a ?? []).every((line, i) => line.accountCode === b[i].accountCode && (line.vatAccountCode ?? null) === b[i].vatAccountCode && Number(line.vatRate ?? 0) === Number(b[i].vatRate?.toString() ?? 0))

/**
 * After a confirmation: when the last LEARN_AFTER choices for the
 * counterparty are this category, create the rule (or update the one simple
 * mode created for it). Failures are logged, never undo the confirmation.
 */
async function learnRule(
  companyId: string,
  originId: string,
  key: string,
  transaction: Awaited<ReturnType<typeof loadTransaction>>,
  learnable: NonNullable<Prepared['learnable']>,
): Promise<ConfirmResult['learnedRule']> {
  const latest = await prisma.simpleModeEntry.findMany({
    where: { companyId, counterpartyKey: key },
    select: { categoryId: true, learnedRuleId: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const streak = latest.slice(0, LEARN_AFTER)
  if (streak.length < LEARN_AFTER || streak.some((row) => row.categoryId !== learnable.category.id)) return null

  const entryLines = learnedRuleLines(learnable)
  const side = normalizeSide(transaction.side)
  const counterparty = counterpartyOf(transaction)
  const name = displayNameOf(counterparty, transaction.label)
  const input: RuleInput = {
    name: `${name} (mode simple)`,
    description: `Créée par le mode simple après ${LEARN_AFTER} choix identiques : ${learnable.category.label}.`,
    journalCode: 'BQ',
    autoCreate: false,
    conditions: [
      counterparty ? { conditionType: 'counterparty', operator: 'equals', value: counterparty } : { conditionType: 'label', operator: 'contains', value: key.toLowerCase() },
      { conditionType: 'side', operator: 'equals', value: side },
    ],
    entryLines,
  }

  const previousRuleId = latest.find((row) => row.learnedRuleId)?.learnedRuleId ?? null
  const previous = previousRuleId
    ? await prisma.transactionRule.findFirst({ where: { id: previousRuleId, companyId }, include: { entryLines: { orderBy: { order: 'asc' } } } })
    : null
  let rule: { id: string; name: string; created: boolean }
  if (previous) {
    if (sameLines(entryLines, previous.entryLines)) return null
    const updated = await updateRule(companyId, previous.id, { ...input, name: previous.name, enabled: previous.enabled, priority: previous.priority })
    rule = { id: updated.id, name: updated.name, created: false }
  } else {
    const created = await createRule(companyId, input)
    rule = { id: created.id, name: created.name, created: true }
  }
  await prisma.simpleModeEntry.update({ where: { id: originId }, data: { learnedRuleId: rule.id } })
  await writeAuditLog('info', `Simple mode ${rule.created ? 'created' : 'updated'} a transaction rule: ${rule.name}`, {
    action: rule.created ? 'SIMPLE_MODE_RULE_CREATED' : 'SIMPLE_MODE_RULE_UPDATED',
    companyId,
    metadata: { ruleId: rule.id, categoryId: learnable.category.id, counterpartyKey: key },
  })
  return rule
}

interface Choice {
  categoryId: string | null
  ruleId: string | null
  invoiceId: string | null
  answers: Answers
}

/** Which invoice, category or rule the request confirms: the one given, else the suggestion. */
function choice(input: ConfirmExpenseInput, suggestion: Suggestion | null): Choice {
  if (input.invoiceId) return { categoryId: null, ruleId: null, invoiceId: input.invoiceId, answers: {} }
  if (input.ruleId) return { categoryId: input.categoryId ?? null, ruleId: input.ruleId, invoiceId: null, answers: {} }
  if (input.categoryId) return { categoryId: input.categoryId, ruleId: null, invoiceId: null, answers: input.answers ?? {} }
  if (suggestion?.invoice) return { categoryId: null, ruleId: null, invoiceId: suggestion.invoice.invoiceId, answers: {} }
  if (!suggestion || (!suggestion.categoryId && !suggestion.ruleId)) throw new ValidationError(MESSAGES.nothingToConfirm)
  if (suggestion.ruleId) return { categoryId: suggestion.categoryId, ruleId: suggestion.ruleId, invoiceId: null, answers: {} }
  return { categoryId: suggestion.categoryId, ruleId: null, invoiceId: null, answers: { ...suggestion.answers, ...(input.answers ?? {}) } }
}

/** Confirms one transaction of the company (see the module header). */
export async function confirmExpense(companyId: string, transactionId: string, input: ConfirmExpenseInput, actor: ConfirmActor): Promise<ConfirmResult> {
  const transaction = await loadTransaction(companyId, transactionId)
  if (transaction.reconciled) throw new ConflictError(RECONCILIATION_MESSAGES.alreadyReconciled)

  let suggestion: Suggestion | null = null
  if (!input.categoryId && !input.ruleId && !input.invoiceId) {
    const withAccount = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: transaction.id }, include: { bankAccount: { select: { name: true, iban: true } } } })
    suggestion = suggestionFor(withAccount, await loadSuggestionSignals(companyId))
  }
  const chosen = choice(input, suggestion)
  if (chosen.ruleId) {
    const rule = await prisma.transactionRule.findFirst({ where: { id: chosen.ruleId, companyId }, select: { id: true } })
    if (!rule) throw new ValidationError('Règle introuvable')
  }
  const category = chosen.categoryId ? findCategory(chosen.categoryId) : null
  if (chosen.categoryId && !category) throw new ValidationError(MESSAGES.unknownCategory)
  const side = normalizeSide(transaction.side)
  if (category && !chosen.ruleId && !fitsSide(category, side)) throw new ValidationError(MESSAGES.wrongSide(category.label, side))

  const prepared = chosen.invoiceId
    ? await prepareInvoice(companyId, transaction, chosen.invoiceId)
    : chosen.ruleId
      ? await prepareRule(companyId, transactionId, chosen.ruleId, category?.id ?? null)
      : await prepareCategory(companyId, transaction, category!, chosen.answers)

  const needsReview = await accountantReviewRequired(companyId)
  const status = actor.source === 'web' && !needsReview && actor.canValidate ? 'validated' : 'draft'
  const key = counterpartyKey(counterpartyOf(transaction), transaction.label) || transaction.label?.trim().toUpperCase() || transaction.id
  let originId = ''
  let fixedAsset = null as ConfirmResult['fixedAsset']
  const entry = await createEntryAndReconcile({
    companyId,
    transactionId,
    journalId: prepared.journalId,
    fiscalYearId: prepared.fiscalYearId,
    date: prepared.date,
    description: prepared.description,
    reference: transaction.reference,
    lines: prepared.lines,
    status,
    afterCreate: async (db, entryId) => {
      const asset = prepared.asset
      if (asset) {
        const created = await createFixedAssetInTx(
          db,
          companyId,
          {
            label: asset.label,
            comment: asset.comment,
            acquisitionDate: prepared.date,
            acquisitionValue: centsToDecimal(asset.acquisitionCents),
            depreciationMethod: 'linear',
            depreciationDuration: asset.years,
            // Put into service the day it is paid (PCG art. 214-13)
            depreciationStartDate: prepared.date,
            assetAccountId: asset.assetAccountId,
            depreciationAccountId: asset.depreciationAccountId,
            expenseAccountId: asset.expenseAccountId,
            isFullyPaid: true,
          },
          { acquisitionEntryId: entryId },
        )
        fixedAsset = { id: created.fixedAsset.id, label: created.fixedAsset.label, years: asset.years, amountCents: asset.acquisitionCents }
      }
      const origin = await db.simpleModeEntry.create({
        data: {
          companyId,
          entryId,
          bankTransactionId: transactionId,
          categoryId: prepared.categoryId,
          ruleId: prepared.ruleId,
          answers: prepared.answers ?? undefined,
          note: input.note?.trim() || null,
          counterpartyKey: key,
          needsReview,
          source: actor.source,
          createdById: actor.userId,
          fixedAssetId: fixedAsset?.id ?? null,
          invoiceId: prepared.invoice?.id ?? null,
        },
        select: { id: true },
      })
      originId = origin.id
    },
  })

  // A validated payment is recorded on its invoice now; a draft one when the accountant validates it
  let invoice: ConfirmResult['invoice'] = null
  if (prepared.invoice) {
    const recorded = entry.status === 'validated' ? (await recordValidatedInvoicePayments(companyId, [entry.id]))[0] : undefined
    invoice = {
      ...prepared.invoice,
      recorded: recorded?.recorded ?? false,
      lettered: recorded?.lettered ?? false,
      remainingCents: recorded?.remainingCents ?? null,
      pending: recorded ? recorded.pending : 'Le paiement sera enregistré sur la facture quand votre comptable aura validé l’écriture.',
    }
  }

  if (prepared.ruleId) {
    await prisma.transactionRule.updateMany({ where: { id: prepared.ruleId, companyId }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } })
  }

  let learnedRule: ConfirmResult['learnedRule'] = null
  if (input.learn !== false && prepared.learnable) {
    try {
      learnedRule = await learnRule(companyId, originId, key, transaction, prepared.learnable)
    } catch (error) {
      logger.warn('Simple mode could not learn a rule', { companyId, transactionId, error })
    }
  }

  const accountCodes = await prisma.account.findMany({ where: { id: { in: prepared.lines.map((l) => l.accountId) }, companyId }, select: { id: true, code: true } })
  const codeOf = new Map(accountCodes.map((a) => [a.id, a.code]))
  await writeAuditLog('info', `Simple mode expense confirmed: ${prepared.description}`, {
    action: 'SIMPLE_MODE_CONFIRM',
    companyId,
    metadata: {
      transactionId,
      entryId: entry.id,
      entryNumber: entry.entryNumber,
      status: entry.status,
      categoryId: prepared.categoryId,
      ruleId: prepared.ruleId,
      invoiceId: prepared.invoice?.id ?? null,
      needsReview,
      source: actor.source,
      fixedAssetId: fixedAsset?.id ?? null,
    },
  })
  return {
    transactionId,
    entryId: entry.id,
    entryNumber: entry.entryNumber,
    status: entry.status,
    needsReview,
    categoryId: prepared.categoryId,
    ruleId: prepared.ruleId,
    lines: prepared.lines.map((l) => ({ accountCode: codeOf.get(l.accountId) ?? '', debitCents: l.debitCents, creditCents: l.creditCents })),
    vatNote: prepared.vatNote,
    mealNote: prepared.mealNote,
    learnedRule,
    fixedAsset,
    invoice,
  }
}

export interface ConfirmAllResult {
  confirmed: ConfirmResult[]
  /** Lines left for the user: not high confidence, a question to answer, or refused. */
  skipped: Array<{ transactionId: string; reason: string }>
}

/**
 * "Tout confirmer": confirms the given transactions whose suggestion is of
 * high confidence with nothing to answer, recomputed on the server; the
 * others are skipped with the reason. One transaction each: a refusal never
 * blocks the others.
 */
export async function confirmHighConfidenceExpenses(companyId: string, transactionIds: readonly string[], actor: ConfirmActor): Promise<ConfirmAllResult> {
  const ids = [...new Set(transactionIds)]
  const rows = await prisma.bankTransaction.findMany({
    where: { id: { in: ids }, bankAccount: { bankConnection: { companyId } } },
    include: { bankAccount: { select: { name: true, iban: true } } },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const signals = await loadSuggestionSignals(companyId)
  const confirmed: ConfirmResult[] = []
  const skipped: ConfirmAllResult['skipped'] = []
  for (const id of ids) {
    const row = byId.get(id)
    if (!row) {
      skipped.push({ transactionId: id, reason: RECONCILIATION_MESSAGES.transactionNotFound })
      continue
    }
    if (row.reconciled) {
      skipped.push({ transactionId: id, reason: RECONCILIATION_MESSAGES.alreadyReconciled })
      continue
    }
    const suggestion = suggestionFor(row, signals)
    if (!suggestion.bulkConfirmable) {
      skipped.push({ transactionId: id, reason: suggestion.pendingQuestion ? 'Une question attend votre réponse.' : 'Kledg n’est pas assez sûr de la catégorie : vérifiez-la.' })
      continue
    }
    try {
      confirmed.push(
        await confirmExpense(
          companyId,
          id,
          suggestion.invoice
            ? { invoiceId: suggestion.invoice.invoiceId }
            : suggestion.ruleId
              ? { ruleId: suggestion.ruleId, categoryId: suggestion.categoryId ?? undefined }
              : { categoryId: suggestion.categoryId ?? undefined, answers: suggestion.answers },
          actor,
        ),
      )
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ConflictError) skipped.push({ transactionId: id, reason: error.message })
      else throw error
    }
  }
  return { confirmed, skipped }
}
