/**
 * Entries list of GET /api/entries: the entries of a company (optionally of
 * one fiscal year), newest first, with their journal, lines (and accounts) and
 * reversal links. The response shape is the one the entries page has always
 * read; this module only changes how it is loaded:
 *
 * - entries, lines and accounts are read in separate queries joined in
 *   memory. Nested relation loading sends the composite key of every line
 *   ((accountId, accountFiscalYearId) for its account) as bind parameters and
 *   fails beyond the PostgreSQL limit (Prisma P2029) on a year of about
 *   15,000 entries;
 * - stable order (date, then id, descending) and an optional cursor: with
 *   `limit`, the caller gets `nextCursor` (the id to pass as `cursor` for the
 *   next page), so a client can page through a large year;
 * - every filter of the entries page runs in the database (journal, status,
 *   number, text, period, amount), so a page holds only matching entries.
 *
 * The amount of an entry is the larger of its debit and credit totals (they
 * are equal once the entry balances), compared in the database on the
 * Decimal sums: no float rounding.
 */

import type { Account, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { addIsoDays, isIsoDate, isoDateToUtc } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'

const ENTRY_LIST_INCLUDE = {
  journal: true,
  reversalOf: { select: { id: true, entryNumber: true } },
  reversedBy: { select: { id: true, entryNumber: true } },
} satisfies Prisma.AccountingEntryInclude

/** Above this many entries, lines are selected through the entry filter instead of an id list. */
const MAX_ID_LIST = 5000

export const MAX_ENTRIES_PAGE = 10_000

/** Optional amount bound in euros ("1234.56" or "1234,56"), as cents. */
const amountBound = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (value === undefined || value.trim() === '') return null
    const cents = parseCents(value.trim())
    if (cents === null) {
      ctx.addIssue({ code: 'custom', message: `Montant invalide : ${value}. Saisissez un montant avec au plus deux décimales.` })
      return z.NEVER
    }
    return cents
  })

/** Optional calendar day (yyyy-mm-dd). */
const dayBound = z
  .string()
  .optional()
  .refine((value) => value === undefined || isIsoDate(value), {
    error: (issue) => `Date invalide : ${String(issue.input)}. Utilisez le format aaaa-mm-jj.`,
  })
  .transform((value) => value ?? null)

/**
 * Query string of GET /api/entries (the company comes from `companyId`), as
 * the ListEntriesQuery fields. Status "all" does not filter.
 */
export const ListEntriesQuerySchema = z
  .object({
    fiscalYearId: z.string().optional(),
    /** One page of 1 to 10,000 entries (an unreadable value counts as 1); without it, every entry. */
    limit: z
      .string()
      .optional()
      .transform((value) =>
        value === undefined ? undefined : Math.min(Math.max(Number.parseInt(value, 10) || 0, 1), MAX_ENTRIES_PAGE),
      ),
    cursor: z.string().optional(),
    journalId: z.string().optional(),
    status: z
      .enum(['draft', 'validated', 'all'], { error: 'Statut invalide : utilisez draft ou validated.' })
      .optional()
      .transform((value) => (value === 'draft' || value === 'validated' ? value : null)),
    number: z.string().optional(),
    search: z.string().optional(),
    startDate: dayBound,
    endDate: dayBound,
    minAmount: amountBound,
    maxAmount: amountBound,
  })
  .transform(({ minAmount, maxAmount, ...rest }) => ({ ...rest, minAmountCents: minAmount, maxAmountCents: maxAmount }))

export interface ListEntriesQuery {
  companyId: string
  fiscalYearId?: string | null
  /** Page size (1 to MAX_ENTRIES_PAGE); every entry when absent. */
  limit?: number
  /** Id of the last entry of the previous page. */
  cursor?: string | null
  journalId?: string | null
  status?: 'draft' | 'validated' | null
  /** Part of the entry number (case insensitive). */
  number?: string | null
  /** Text in the description or reference of the entry, or in a line label. */
  search?: string | null
  /** First and last calendar day (yyyy-mm-dd), both included. */
  startDate?: string | null
  endDate?: string | null
  /** Bounds of the entry amount, in cents, both included. */
  minAmountCents?: number | null
  maxAmountCents?: number | null
}

/** The filters of the query as a Prisma condition (the company is set by the caller). */
function filtersOf(query: ListEntriesQuery): Prisma.AccountingEntryWhereInput[] {
  const filters: Prisma.AccountingEntryWhereInput[] = []
  if (query.journalId) filters.push({ journalId: query.journalId })
  if (query.status) filters.push({ status: query.status })
  const number = query.number?.trim()
  if (number) filters.push({ entryNumber: { contains: number, mode: 'insensitive' } })
  const search = query.search?.trim()
  if (search) {
    filters.push({
      OR: [
        { description: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
        { lines: { some: { description: { contains: search, mode: 'insensitive' } } } },
      ],
    })
  }
  // Entry dates are calendar days stored at midnight UTC
  if (isIsoDate(query.startDate)) filters.push({ date: { gte: isoDateToUtc(query.startDate) } })
  if (isIsoDate(query.endDate)) filters.push({ date: { lt: isoDateToUtc(addIsoDays(query.endDate, 1)) } })
  return filters
}

const hasAmountFilter = (query: ListEntriesQuery) =>
  typeof query.minAmountCents === 'number' || typeof query.maxAmountCents === 'number'

/**
 * Ids of the entries matching `where` whose amount (larger of the debit and
 * credit totals) lies within the bounds. The sums are compared by the
 * database (GROUP BY ... HAVING) on the Decimal columns.
 */
async function idsWithinAmount(where: Prisma.AccountingEntryWhereInput, query: ListEntriesQuery): Promise<string[]> {
  const min = typeof query.minAmountCents === 'number' ? centsToDecimal(query.minAmountCents) : null
  const max = typeof query.maxAmountCents === 'number' ? centsToDecimal(query.maxAmountCents) : null
  const having: Prisma.EntryLineScalarWhereWithAggregatesInput[] = []
  // max(debit, credit) >= min  <=>  debit >= min OR credit >= min
  if (min !== null) having.push({ OR: [{ debit: { _sum: { gte: min } } }, { credit: { _sum: { gte: min } } }] })
  // max(debit, credit) <= max  <=>  debit <= max AND credit <= max
  if (max !== null) having.push({ debit: { _sum: { lte: max } } }, { credit: { _sum: { lte: max } } })
  const groups = await prisma.entryLine.groupBy({
    by: ['accountingEntryId'],
    where: { accountingEntry: where },
    having: { AND: having },
  })
  return groups.map((group) => group.accountingEntryId)
}

/**
 * The page of entries among `ids` (too many for one bind parameter list):
 * dates read in chunks, ordered like the list (date, then id, descending).
 */
async function pageOfManyIds(ids: string[], take: number | undefined) {
  const rows: Array<{ id: string; date: Date }> = []
  for (let i = 0; i < ids.length; i += MAX_ID_LIST) {
    rows.push(...(await prisma.accountingEntry.findMany({ where: { id: { in: ids.slice(i, i + MAX_ID_LIST) } }, select: { id: true, date: true } })))
  }
  rows.sort((a, b) => b.date.getTime() - a.date.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  const pageIds = (take === undefined ? rows : rows.slice(0, take)).map((row) => row.id)
  const order = new Map(pageIds.map((id, index) => [id, index]))
  const entries = []
  for (let i = 0; i < pageIds.length; i += MAX_ID_LIST) {
    entries.push(...(await prisma.accountingEntry.findMany({ where: { id: { in: pageIds.slice(i, i + MAX_ID_LIST) } }, include: ENTRY_LIST_INCLUDE })))
  }
  return entries.sort((a, b) => order.get(a.id)! - order.get(b.id)!)
}

export async function listEntries(query: ListEntriesQuery) {
  const { companyId, limit } = query
  const where: Prisma.AccountingEntryWhereInput = { companyId }

  // Filter by fiscal year id (includes opening entries), only if it belongs to the company
  if (query.fiscalYearId) {
    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: { id: query.fiscalYearId, companyId },
      select: { id: true },
    })
    if (fiscalYear) where.fiscalYearId = fiscalYear.id
  }
  const filters = filtersOf(query)
  if (filters.length > 0) where.AND = filters

  // The cursor entry must be one of the listed entries (same company and filter).
  const cursor = query.cursor
    ? await prisma.accountingEntry.findFirst({ where: { ...where, id: query.cursor }, select: { id: true, date: true } })
    : null
  const pageWhere: Prisma.AccountingEntryWhereInput = cursor
    ? { AND: [where, { OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lt: cursor.id } }] }] }
    : where

  const take = limit === undefined ? undefined : limit + 1
  const orderBy: Prisma.AccountingEntryOrderByWithRelationInput[] = [{ date: 'desc' }, { id: 'desc' }]
  let rows
  if (hasAmountFilter(query)) {
    // Amounts are sums over lines: select the matching ids first, then load the page
    const ids = await idsWithinAmount(pageWhere, query)
    rows =
      ids.length <= MAX_ID_LIST
        ? await prisma.accountingEntry.findMany({ where: { id: { in: ids } }, include: ENTRY_LIST_INCLUDE, orderBy, take })
        : await pageOfManyIds(ids, take)
  } else {
    rows = await prisma.accountingEntry.findMany({ where: pageWhere, include: ENTRY_LIST_INCLUDE, orderBy, take })
  }
  const hasMore = limit !== undefined && rows.length > limit
  const entries = hasMore ? rows.slice(0, limit) : rows

  const byFilter = entries.length > MAX_ID_LIST && !cursor && limit === undefined && !hasAmountFilter(query)
  const lines = byFilter ? await prisma.entryLine.findMany({ where: { accountingEntry: where } }) : []
  for (let i = 0; !byFilter && i < entries.length; i += MAX_ID_LIST) {
    const ids = entries.slice(i, i + MAX_ID_LIST).map((e) => e.id)
    lines.push(...(await prisma.entryLine.findMany({ where: { accountingEntryId: { in: ids } } })))
  }
  // Accounts read once by id: including them per line sends an (id, fiscal
  // year) pair per line as bind parameters (the composite relation key).
  const accountIds = [...new Set(lines.map((line) => line.accountId))]
  const accounts = new Map<string, Account>()
  for (let i = 0; i < accountIds.length; i += MAX_ID_LIST) {
    const chunk = await prisma.account.findMany({ where: { id: { in: accountIds.slice(i, i + MAX_ID_LIST) } } })
    for (const account of chunk) accounts.set(account.id, account)
  }
  const linesByEntry = new Map<string, Array<(typeof lines)[number] & { account: Account }>>()
  for (const raw of lines) {
    const line = { ...raw, account: accounts.get(raw.accountId)! }
    const list = linesByEntry.get(line.accountingEntryId)
    if (list) list.push(line)
    else linesByEntry.set(line.accountingEntryId, [line])
  }

  return {
    entries: entries.map((entry) => ({ ...entry, lines: linesByEntry.get(entry.id) ?? [] })),
    nextCursor: hasMore ? entries[entries.length - 1].id : null,
  }
}
