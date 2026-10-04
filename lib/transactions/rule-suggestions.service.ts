/**
 * Rule suggestions from one bank transaction:
 * - the draft of a new assignment rule (règle d'affectation) prefilled from
 *   the transaction (GET /api/transactions/[id]/create-rule): suggested
 *   conditions, and the entry lines of the best matching rule with its
 *   account codes resolved to the accounts of the active fiscal year;
 * - the rules matching the transaction (GET /api/transactions/[id]/suggest).
 *
 * The transaction must belong to the company (404 otherwise). Bank
 * connection credentials are never selected.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { transactionOfCompany } from '@/lib/api/resources'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { extractConditionsFromTransaction, suggestRuleName } from './rule-builder'
import { findMatchingRules } from './rule-service'
import { RULE_INCLUDE } from './manage-rules.service'
import type { EnrichedTransaction } from './types'

export const TRANSACTION_NOT_FOUND_MESSAGE = 'Transaction introuvable'

/** Provider payload fields read here (Qonto names, plus the camelCase copies some imports stored). */
interface ProviderFields {
  logoUrl?: string
  counterpartyName?: string
  category?: string
  cashflowCategory?: string
  cashflowSubcategory?: string
  operationType?: string
  logo?: { small?: string; medium?: string }
  clean_counterparty_name?: string
  cashflow_category?: { name?: string }
  cashflow_subcategory?: { name?: string }
  operation_type?: string
}

const providerFields = (value: unknown): ProviderFields =>
  value && typeof value === 'object' ? (value as ProviderFields) : {}

/** Entry lines of the rule, account codes resolved to account ids of the active fiscal year ('' when missing). */
async function ruleLinesForForm(companyId: string, ruleId: string) {
  const rule = await prisma.transactionRule.findFirst({ where: { id: ruleId, companyId }, include: RULE_INCLUDE })
  if (!rule || rule.entryLines.length === 0) return []

  const activeFiscalYear = await getActiveFiscalYear(companyId)
  const codes = new Set<string>()
  for (const line of rule.entryLines) {
    if (line.accountCode) codes.add(line.accountCode)
    if (line.vatAccountCode) codes.add(line.vatAccountCode)
  }
  const accounts = activeFiscalYear
    ? await prisma.account.findMany({
        where: { companyId, fiscalYearId: activeFiscalYear.id, code: { in: Array.from(codes) } },
        select: { id: true, code: true },
      })
    : []
  const idOfCode = new Map(accounts.map((a) => [a.code, a.id] as const))

  return rule.entryLines.map((line) => ({
    accountId: idOfCode.get(line.accountCode) ?? '',
    lineType: line.lineType,
    amountType: line.amountType,
    amountValue: line.amountValue ? Number(line.amountValue) : null,
    description: line.description,
    order: line.order,
    vatType: line.vatType,
    vatRate: line.vatRate ? Number(line.vatRate) : null,
    vatAccountId: line.vatAccountCode ? (idOfCode.get(line.vatAccountCode) ?? null) : null,
    vatOnDebit: line.vatOnDebit,
  }))
}

/** The draft of a new rule built from a transaction of the company. */
export async function getRuleDraftFromTransaction(companyId: string, transactionId: string) {
  const transaction = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, ...transactionOfCompany(companyId) },
    include: { bankAccount: { select: { name: true, iban: true } } },
  })
  if (!transaction) throw new NotFoundError(TRANSACTION_NOT_FOUND_MESSAGE)

  const provider = providerFields(transaction.providerData)
  const enriched: EnrichedTransaction = {
    ...transaction,
    logoUrl: provider.logoUrl || transaction.logoUrl || null,
    counterpartyName: provider.counterpartyName || transaction.counterpartyName || null,
    category: provider.category || transaction.category || null,
    cashflowCategory: provider.cashflowCategory || transaction.cashflowCategory || null,
    cashflowSubcategory: provider.cashflowSubcategory || transaction.cashflowSubcategory || null,
    operationType: provider.operationType || transaction.operationType || null,
  }

  const matchingRules = await findMatchingRules(companyId, enriched)
  const suggestedEntryLines = matchingRules.length > 0 ? await ruleLinesForForm(companyId, matchingRules[0].ruleId) : []

  return {
    transaction: {
      id: transaction.id,
      label: transaction.label,
      reference: transaction.reference,
      amount: Number(transaction.amount),
      side: transaction.side,
      date: transaction.date,
    },
    suggestedName: suggestRuleName(enriched),
    suggestedConditions: extractConditionsFromTransaction(enriched),
    suggestedEntryLines,
    matchingRules: matchingRules.map((r) => ({ ruleId: r.ruleId, ruleName: r.ruleName, confidence: r.confidence })),
  }
}

/** The rules of the company matching one of its transactions, with the transaction as the rules see it. */
export async function getTransactionRuleSuggestions(companyId: string, transactionId: string) {
  const transaction = await prisma.bankTransaction.findFirst({
    where: { id: transactionId, ...transactionOfCompany(companyId) },
    include: {
      bankAccount: {
        include: {
          // Never return the connection credentials (login, secretKeyEncrypted)
          bankConnection: { select: { id: true, companyId: true, provider: true, status: true, company: true } },
        },
      },
    },
  })
  if (!transaction) throw new NotFoundError(TRANSACTION_NOT_FOUND_MESSAGE)

  const provider = providerFields(transaction.providerData)
  const enriched = {
    ...transaction,
    logoUrl: provider.logo?.small || provider.logo?.medium || null,
    counterpartyName: provider.clean_counterparty_name || null,
    category: provider.category || null,
    cashflowCategory: provider.cashflow_category?.name || null,
    cashflowSubcategory: provider.cashflow_subcategory?.name || null,
    operationType: provider.operation_type || null,
  }
  const matchingRules = await findMatchingRules(companyId, enriched)

  // Decimal columns as numbers for JSON
  const company = enriched.bankAccount.bankConnection.company
  return {
    transaction: {
      ...enriched,
      amount: Number(enriched.amount),
      bankAccount: {
        ...enriched.bankAccount,
        bankConnection: {
          ...enriched.bankAccount.bankConnection,
          company: company
            ? {
                ...company,
                shareNominalValue: company.shareNominalValue ? Number(company.shareNominalValue) : null,
                shareCapital: company.shareCapital ? Number(company.shareCapital) : null,
              }
            : null,
        },
      },
    },
    matchingRules,
  }
}
