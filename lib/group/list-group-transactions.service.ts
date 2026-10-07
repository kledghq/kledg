/**
 * Transactions of the group space (docs/vue-groupe.md): the bank
 * transactions of every company read in one list, newest first, page by
 * page (merge-pages.ts), filterable by company, text, direction,
 * reconciliation and period. Read only: each row links to its company's
 * Transactions page, where it is reconciled.
 *
 * Every filter runs in the database of each company, in its own scope; a
 * company filter that names no company read answers 404, like any company
 * the user cannot reach, whether it exists or not.
 */

import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import type { GroupAccess } from '@/lib/management-fees/access'
import { normalizeBankSide } from '@/lib/banking/side'
import { calendarDayOf, endOfDay, isoDateToUtc } from '@/lib/utils/date'
import { toCents } from '@/lib/utils/money'
import { decodeCursor, mergePages, type PageKey } from './merge-pages'
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink } from './members'
import type { UnreachableSubsidiary } from './perimeter'

export const MAX_GROUP_TRANSACTIONS_PAGE = 200
export const DEFAULT_GROUP_TRANSACTIONS_PAGE = 50

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ')

export const GroupTransactionsQuerySchema = z.object({
  /** A company of the group (id or slug); every company read by default. */
  company: z.string().max(120).optional(),
  search: z.string().max(200).optional(),
  side: z.enum(['debit', 'credit'], { error: 'side doit être debit ou credit' }).optional(),
  reconciled: z.enum(['true', 'false'], { error: 'reconciled doit être true ou false' }).optional(),
  startDate: isoDay.optional(),
  endDate: isoDay.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_GROUP_TRANSACTIONS_PAGE).optional(),
  cursor: z.string().max(400).optional(),
})
export type GroupTransactionsQuery = z.infer<typeof GroupTransactionsQuerySchema>

export interface GroupTransaction {
  id: string
  companyId: string
  /** Day of the transaction (yyyy-mm-dd), and its exact instant for the cursor. */
  date: string
  at: string
  label: string | null
  counterpartyName: string | null
  reference: string | null
  /** Positive amount in cents; `side` says whether money left (debit) or came in (credit). */
  amountCents: number
  side: 'debit' | 'credit'
  reconciled: boolean
  bankAccountName: string
}

export interface GroupTransactionsPage {
  companies: GroupCompanyLink[]
  items: GroupTransaction[]
  nextCursor: string | null
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

export const INVALID_CURSOR = 'Curseur de pagination invalide\u00a0: rechargez la liste.'
export const COMPANY_NOT_IN_GROUP = 'Société introuvable dans ce groupe.'

function whereOf(companyId: string, query: GroupTransactionsQuery, after: PageKey | null): Prisma.BankTransactionWhereInput {
  const and: Prisma.BankTransactionWhereInput[] = [{ bankAccount: { bankConnection: { companyId } } }]
  if (query.side) and.push({ side: query.side })
  if (query.reconciled) and.push({ reconciled: query.reconciled === 'true' })
  if (query.startDate) and.push({ date: { gte: isoDateToUtc(query.startDate) } })
  if (query.endDate) and.push({ date: { lte: endOfDay(isoDateToUtc(query.endDate)) } })
  const search = query.search?.trim()
  if (search) {
    and.push({
      OR: [
        { label: { contains: search, mode: 'insensitive' } },
        { counterpartyName: { contains: search, mode: 'insensitive' } },
        { reference: { contains: search, mode: 'insensitive' } },
      ],
    })
  }
  if (after) {
    const at = new Date(after.date)
    and.push({ OR: [{ date: { lt: at } }, { date: at, id: { lt: after.id } }] })
  }
  return { AND: and }
}

export async function listGroupTransactions(holdingId: string, query: GroupTransactionsQuery, access: GroupAccess): Promise<GroupTransactionsPage> {
  const limit = query.limit ?? DEFAULT_GROUP_TRANSACTIONS_PAGE
  const after = decodeCursor(query.cursor)
  if (query.cursor && !after) throw new ValidationError(INVALID_CURSOR)
  if (query.startDate && query.endDate && query.startDate > query.endDate) throw new ValidationError('La date de début doit précéder la date de fin.')
  const only = query.company?.trim() || null

  const read = await readGroupMembers(holdingId, access, async (ref) => {
    if (only && only !== ref.id && only !== ref.slug) return []
    const rows = await prisma.bankTransaction.findMany({
      where: whereOf(ref.id, query, after),
      select: {
        id: true,
        date: true,
        label: true,
        counterpartyName: true,
        reference: true,
        amount: true,
        side: true,
        reconciled: true,
        bankAccount: { select: { name: true, displayName: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
    return rows.map(
      (t): GroupTransaction => ({
        id: t.id,
        companyId: ref.id,
        date: calendarDayOf(t.date) as string,
        at: t.date.toISOString(),
        label: t.label,
        counterpartyName: t.counterpartyName,
        reference: t.reference,
        amountCents: Math.abs(toCents(t.amount) ?? 0),
        side: normalizeBankSide(t.side),
        reconciled: t.reconciled,
        bankAccountName: t.bankAccount.displayName || t.bankAccount.name,
      }),
    )
  })
  if (only && !read.members.some((m) => m.ref.id === only || m.ref.slug === only)) throw new NotFoundError(COMPANY_NOT_IN_GROUP)
  const page = mergePages(
    read.members.map((m) => m.value),
    limit,
    (t) => ({ date: t.at, id: t.id }),
  )
  return {
    companies: read.members.map((m) => linkOf(m.ref)),
    ...page,
    unreachable: read.unreachable,
    truncated: read.truncated,
    warnings: perimeterWarnings(read.unreachable.length, read.truncated),
  }
}
