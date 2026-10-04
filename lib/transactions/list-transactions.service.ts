/**
 * Bank transactions list of GET /api/transactions (transactions page,
 * reconciliation page). The response shape is unchanged; what this module
 * changes is how it is loaded:
 *
 * - transactions and their attachments in two queries joined in memory:
 *   nested relation loading sends every transaction id as a bind parameter
 *   and fails beyond the PostgreSQL limit (Prisma P2029) on a company with
 *   several years of bank history;
 * - the balance before the period in one aggregate (cents);
 * - the filter categories with SELECT DISTINCT instead of reading the
 *   provider payload of every transaction;
 * - rules loaded once and matched in memory;
 * - an optional page (`limit`, `cursor`): stable order (date, then id) and
 *   `nextCursor` in the response;
 * - every filter runs in the database, the provider categories included, so
 *   a page holds only matching transactions.
 *
 * Period bounds are calendar days (yyyy-mm-dd): the end day is included up to
 * its last millisecond. Each bound applies on its own, and inside the fiscal
 * year when one is given.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { findOwned } from '@/lib/api/resources'
import { logger } from '@/lib/logger'
import { endOfDay, isIsoDate, isoDateToUtc } from '@/lib/utils/date'
import { fromCents, toCents } from '@/lib/utils/money'
import { findMatchingRules, type RuleWithConditions } from './rule-matcher'
import type { EnrichedTransaction, TransactionMatchResult } from './types'

/** Above this many transactions, attachments are selected through the transaction filter instead of an id list. */
const MAX_ID_LIST = 5000

export const MAX_TRANSACTIONS_PAGE = 10_000

const dateParam = (name: string) =>
  z.string().refine((value) => !Number.isNaN(Date.parse(value)), `${name} doit être une date valide`).optional()
const amountParam = (name: string) =>
  z.string().refine((value) => value.trim() !== '' && Number.isFinite(Number(value)), `${name} doit être un montant`).optional()
const flag = z
  .string()
  .optional()
  .transform((value) => value === 'true')

/**
 * Query string of GET /api/transactions (the company comes from `companyId`).
 * Dates are passed as sent (yyyy-mm-dd or an ISO timestamp: the pages send
 * the bounds of the day they mean), refused when unreadable.
 */
export const ListTransactionsQuerySchema = z.object({
  bankAccountId: z.string().optional(),
  reconciled: z.enum(['true', 'false'], { error: 'reconciled doit être true ou false' }).optional(),
  startDate: dateParam('startDate'),
  endDate: dateParam('endDate'),
  fiscalYearId: z.string().optional(),
  minAmount: amountParam('minAmount'),
  maxAmount: amountParam('maxAmount'),
  hasAttachments: z.enum(['with', 'without'], { error: 'hasAttachments doit être with ou without' }).optional(),
  side: z.enum(['debit', 'credit'], { error: 'side doit être debit ou credit' }).optional(),
  searchText: z.string().optional(),
  /** Provider categories (providerData), as listed by `categories`. */
  cashflowCategory: z.string().optional(),
  cashflowSubcategory: z.string().optional(),
  category: z.string().optional(),
  operationType: z.string().optional(),
  includeSuggestions: flag,
  includeCategories: flag,
  categoriesOnly: flag,
  /** One page of 1 to 10,000 transactions (an unreadable value counts as 1); without it, every transaction. */
  limit: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Math.min(Math.max(Number.parseInt(value, 10) || 0, 1), MAX_TRANSACTIONS_PAGE),
    ),
  cursor: z.string().optional(),
})

export interface ListTransactionsQuery {
  companyId: string
  bankAccountId?: string | null
  reconciled?: string | null
  startDate?: string | null
  endDate?: string | null
  fiscalYearId?: string | null
  minAmount?: string | null
  maxAmount?: string | null
  hasAttachments?: string | null
  side?: string | null
  searchText?: string | null
  /** Provider categories (providerData), as listed by `categories`. */
  cashflowCategory?: string | null
  cashflowSubcategory?: string | null
  category?: string | null
  operationType?: string | null
  includeSuggestions?: boolean
  includeCategories?: boolean
  /** Only the categories (transactions: []): what the filters of the transactions page need. */
  categoriesOnly?: boolean
  limit?: number
  cursor?: string | null
}

interface ProviderData {
  id?: string
  logo?: { small?: string; medium?: string }
  clean_counterparty_name?: string
  category?: string
  cashflow_category?: { name?: string }
  cashflow_subcategory?: { name?: string }
  operation_type?: string
}

const TRANSACTION_INCLUDE = {
  bankAccount: {
    include: {
      // Never return the connection credentials (login, secretKeyEncrypted)
      bankConnection: { select: { id: true, companyId: true, provider: true, status: true } },
    },
  },
} satisfies Prisma.BankTransactionInclude

const ATTACHMENT_SELECT = {
  id: true,
  bankTransactionId: true,
  externalAttachmentId: true,
  fileName: true,
  fileContentType: true,
  fileSize: true,
} satisfies Prisma.AttachmentSelect

/** Start of a period bound: a calendar day (midnight UTC) or an ISO timestamp. */
function periodStart(value: string): Date {
  return isIsoDate(value) ? isoDateToUtc(value) : new Date(value)
}

/** End of a period bound: the last millisecond of a calendar day, or an ISO timestamp. */
function periodEnd(value: string): Date {
  return isIsoDate(value) ? endOfDay(isoDateToUtc(value)) : new Date(value)
}

/** Filters on the provider payload (JSON paths), one per selected category. */
function providerFilters(query: ListTransactionsQuery): Prisma.BankTransactionWhereInput[] {
  const filters: Array<[string[], string | null | undefined]> = [
    [['cashflow_category', 'name'], query.cashflowCategory],
    [['cashflow_subcategory', 'name'], query.cashflowSubcategory],
    [['category'], query.category],
    [['operation_type'], query.operationType],
  ]
  return filters
    .filter((filter): filter is [string[], string] => Boolean(filter[1]))
    .map(([path, value]) => ({ providerData: { path, equals: value } }))
}

async function categoriesOf(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ kind: string; value: string }>>`
    SELECT DISTINCT kind, value FROM (
      SELECT 'cashflowCategories' AS kind, t."providerData" -> 'cashflow_category' ->> 'name' AS value
        FROM "bank_transactions" t JOIN "bank_accounts" a ON a."id" = t."bankAccountId" JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
        WHERE c."companyId" = ${companyId}
      UNION ALL
      SELECT 'cashflowSubcategories', t."providerData" -> 'cashflow_subcategory' ->> 'name'
        FROM "bank_transactions" t JOIN "bank_accounts" a ON a."id" = t."bankAccountId" JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
        WHERE c."companyId" = ${companyId}
      UNION ALL
      SELECT 'categories', t."providerData" ->> 'category'
        FROM "bank_transactions" t JOIN "bank_accounts" a ON a."id" = t."bankAccountId" JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
        WHERE c."companyId" = ${companyId}
      UNION ALL
      SELECT 'operationTypes', t."providerData" ->> 'operation_type'
        FROM "bank_transactions" t JOIN "bank_accounts" a ON a."id" = t."bankAccountId" JOIN "bank_connections" c ON c."id" = a."bankConnectionId"
        WHERE c."companyId" = ${companyId}
    ) v
    WHERE value IS NOT NULL AND value <> ''
  `
  const pick = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.value).sort()
  return {
    cashflowCategories: pick('cashflowCategories'),
    cashflowSubcategories: pick('cashflowSubcategories'),
    categories: pick('categories'),
    operationTypes: pick('operationTypes'),
  }
}

export async function listTransactions(query: ListTransactionsQuery) {
  const { companyId, bankAccountId, reconciled, startDate, endDate, minAmount, maxAmount, hasAttachments, side, searchText } = query

  // If fiscalYearId is provided, get the fiscal year dates (the year must belong to the company)
  let fiscalYearStartDate: Date | null = null
  let fiscalYearEndDate: Date | null = null
  if (query.fiscalYearId) {
    const fiscalYear = await findOwned(
      prisma.fiscalYear.findFirst({
        where: { id: query.fiscalYearId, companyId },
        select: { startDate: true, endDate: true },
      }),
      'Exercice introuvable',
    )
    fiscalYearStartDate = fiscalYear.startDate
    fiscalYearEndDate = fiscalYear.endDate
  }

  const categories = query.includeCategories || query.categoriesOnly ? categoriesOf(companyId) : null
  if (query.categoriesOnly) return { transactions: [], categories: await categories }

  // The period applies inside the fiscal year: the later start and the earlier end win
  const later = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b))
  const earlier = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b))
  const effectiveStartDate = later(fiscalYearStartDate, startDate ? periodStart(startDate) : null)
  const effectiveEndDate = earlier(fiscalYearEndDate, endDate ? periodEnd(endDate) : null)
  const providers = providerFilters(query)

  const whereBase: Prisma.BankTransactionWhereInput = {
    bankAccount: { bankConnection: { companyId } },
    ...(bankAccountId && bankAccountId !== 'all' && { bankAccountId }),
    ...(reconciled === 'true' && { reconciled: true }),
    ...(reconciled === 'false' && { reconciled: false }),
    ...((minAmount || maxAmount) && {
      amount: {
        ...(minAmount && { gte: new Prisma.Decimal(minAmount) }),
        ...(maxAmount && { lte: new Prisma.Decimal(maxAmount) }),
      },
    }),
    ...(hasAttachments === 'with' && { attachments: { some: {} } }),
    ...(hasAttachments === 'without' && { attachments: { none: {} } }),
    ...(side === 'debit' && { side: 'debit' }),
    ...(side === 'credit' && { side: 'credit' }),
    ...(searchText && {
      OR: [
        { counterpartyName: { contains: searchText, mode: 'insensitive' } },
        { label: { contains: searchText, mode: 'insensitive' } },
        { reference: { contains: searchText, mode: 'insensitive' } },
      ],
    }),
    ...(providers.length > 0 && { AND: providers }),
  }

  const where: Prisma.BankTransactionWhereInput = {
    ...whereBase,
    ...((effectiveStartDate || effectiveEndDate) && {
      date: {
        ...(effectiveStartDate && { gte: effectiveStartDate }),
        ...(effectiveEndDate && { lte: effectiveEndDate }),
      },
    }),
  }

  // Balance before the period: credits minus debits of the earlier transactions (same filters)
  const balanceBeforePromise = effectiveStartDate
    ? prisma.bankTransaction
        .groupBy({ by: ['side'], where: { ...whereBase, date: { lt: effectiveStartDate } }, _sum: { amount: true } })
        .then((groups) => {
          const cents = (s: string) => toCents(groups.find((g) => g.side === s)?._sum.amount ?? 0) ?? 0
          return fromCents(cents('credit') - cents('debit'))
        })
    : Promise.resolve(undefined)

  // The cursor transaction must be one of the listed transactions.
  const cursor = query.cursor
    ? await prisma.bankTransaction.findFirst({ where: { ...where, id: query.cursor }, select: { id: true, date: true } })
    : null
  const pageWhere: Prisma.BankTransactionWhereInput = cursor
    ? { AND: [where, { OR: [{ date: { gt: cursor.date } }, { date: cursor.date, id: { gt: cursor.id } }] }] }
    : where
  const rows = await prisma.bankTransaction.findMany({
    where: pageWhere,
    include: TRANSACTION_INCLUDE,
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
    take: query.limit === undefined ? undefined : query.limit + 1,
  })
  const hasMore = query.limit !== undefined && rows.length > query.limit
  const transactions = hasMore ? rows.slice(0, query.limit) : rows

  const attachments =
    transactions.length === 0
      ? []
      : await prisma.attachment.findMany({
          where:
            transactions.length <= MAX_ID_LIST || cursor || query.limit !== undefined
              ? { bankTransactionId: { in: transactions.map((t) => t.id) } }
              : { bankTransaction: where },
          select: ATTACHMENT_SELECT,
          orderBy: { createdAt: 'asc' },
        })
  const attachmentsByTransaction = new Map<string, typeof attachments>()
  for (const attachment of attachments) {
    if (!attachment.bankTransactionId) continue
    const list = attachmentsByTransaction.get(attachment.bankTransactionId)
    if (list) list.push(attachment)
    else attachmentsByTransaction.set(attachment.bankTransactionId, [attachment])
  }

  // Enriched fields from providerData, Decimal converted to numbers for JSON
  const enriched = transactions.map((transaction) => {
    const providerData = transaction.providerData as ProviderData | null
    const own = attachmentsByTransaction.get(transaction.id) ?? []
    const attachmentList = own.map((a) => ({
      id: a.externalAttachmentId || a.id,
      fileName: a.fileName,
      fileContentType: a.fileContentType,
      fileSize: a.fileSize,
    }))
    return {
      ...transaction,
      amount: Number(transaction.amount),
      logoUrl: providerData?.logo?.small || providerData?.logo?.medium || null,
      counterpartyName: providerData?.clean_counterparty_name || null,
      category: providerData?.category || null,
      cashflowCategory: providerData?.cashflow_category?.name || null,
      cashflowSubcategory: providerData?.cashflow_subcategory?.name || null,
      operationType: providerData?.operation_type || null,
      status: transaction.status ?? null,
      attachmentsCount: own.length,
      attachments: attachmentList,
      attachment: attachmentList[0] ?? null,
      transactionUuid: providerData?.id || null,
      bankAccount: { ...transaction.bankAccount, balance: Number(transaction.bankAccount.balance) },
    }
  })

  const balanceBefore = await balanceBeforePromise
  const page = { ...(hasMore && { nextCursor: transactions[transactions.length - 1].id }) }

  if (query.includeSuggestions) {
    // Rules loaded once for the company, matched in memory for every transaction
    let rules: RuleWithConditions[] = []
    try {
      rules = await prisma.transactionRule.findMany({
        where: { companyId, enabled: true },
        include: { conditions: true, entryLines: { orderBy: { order: 'asc' } } },
        orderBy: { priority: 'desc' },
      })
    } catch (error) {
      logger.error('Error loading transaction rules:', error)
    }
    return {
      transactions: enriched.map((transaction) => {
        let matchingRules: TransactionMatchResult[] = []
        try {
          matchingRules = findMatchingRules(rules, transaction as unknown as EnrichedTransaction)
        } catch (error) {
          logger.error(`Error matching rules for transaction ${transaction.id}:`, error)
        }
        return { ...transaction, matchingRules }
      }),
      ...(balanceBefore !== undefined && { balanceBefore }),
      ...page,
    }
  }

  return {
    transactions: enriched,
    ...(categories && { categories: await categories }),
    ...(balanceBefore !== undefined && { balanceBefore }),
    ...page,
  }
}
