/**
 * Monthly bank statements of a company's Qonto accounts, read from the
 * Qonto API with the company's stored credentials only
 * (https://docs.qonto.com/api-reference/business-api/transactions-statements/statements/list-statements).
 *
 * A Qonto organization may hold accounts the company does not follow in
 * Kledg (unticked at connection, or followed through another connection):
 * only the statements of the accounts it syncs (shouldSync) are listed or
 * served, whatever account ids or IBANs the request names.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { qontoClientFor } from './get-credentials'
import { isQontoAccountId } from './account-id'
import type { QontoStatement } from './types'

export const STATEMENT_NOT_FOUND = 'Relevé non trouvé ou fichier non disponible'

const normalizeIban = (iban: string) => iban.replace(/\s/g, '').toUpperCase()

/**
 * The Qonto ids (and their IBANs) of the bank accounts the company syncs.
 * Qonto accounts are stored by IBAN, or by id when the IBAN is masked; the
 * id is in the account data Qonto returned at the last sync.
 */
export async function syncedQontoAccounts(companyId: string): Promise<Array<{ id: string; iban: string | null }>> {
  const accounts = await prisma.bankAccount.findMany({
    where: { shouldSync: true, bankConnection: { companyId, provider: 'QONTO' } },
    select: { externalAccountId: true, iban: true, providerData: true },
  })
  return accounts.flatMap((account) => {
    const data = account.providerData as { id?: unknown } | null
    const id = typeof data?.id === 'string' && data.id ? data.id : isQontoAccountId(account.externalAccountId) ? account.externalAccountId : null
    return id ? [{ id, iban: account.iban ? normalizeIban(account.iban) : null }] : []
  })
}

const SORT_BY = z.enum(['period:asc', 'period:desc'], { error: 'Tri invalide : period:asc ou period:desc.' })
const page = z.coerce.number().int().min(1).max(10_000)
/** Qonto pages hold at most 100 statements: a larger size is clamped. */
const pageSize = z.coerce
  .number()
  .int()
  .min(1)
  .max(10_000)
  .transform((n) => Math.min(n, 100))
/** A statement month as Qonto takes it (MM-YYYY). */
const period = z.string().max(20)
const list = z.array(z.string().max(200)).max(100)

export interface StatementFilters {
  page?: number
  perPage?: number
  sortBy?: 'period:asc' | 'period:desc'
  /** Every statement, through Qonto's pagination (page and perPage ignored). */
  getAll?: boolean
  bankAccountIds?: string[]
  ibans?: string[]
  periodFrom?: string
  periodTo?: string
}

/** A query string list: one value, or several separated by commas. */
const queryList = z
  .string()
  .max(2000)
  .transform((value) => value.split(',').map((v) => v.trim()).filter(Boolean))

/**
 * Query of GET /api/qonto/statements: page, perPage, sortBy, getAll=true,
 * bank_account_ids[] and ibans[] (one value, or a comma separated list),
 * period_from, period_to.
 */
export const StatementsQuerySchema = z
  .object({
    page: page.optional(),
    perPage: pageSize.optional(),
    sortBy: SORT_BY.optional(),
    getAll: z.string().optional(),
    'bank_account_ids[]': queryList.optional(),
    'ibans[]': queryList.optional(),
    period_from: period.optional(),
    period_to: period.optional(),
  })
  .transform(
    (q): StatementFilters => ({
      page: q.page,
      perPage: q.perPage,
      sortBy: q.sortBy,
      getAll: q.getAll === 'true',
      bankAccountIds: q['bank_account_ids[]'],
      ibans: q['ibans[]'],
      periodFrom: q.period_from,
      periodTo: q.period_to,
    }),
  )

/** Body of POST /api/qonto/statements: the same filters, in JSON. */
export const StatementsBodySchema = z.object({
  companyId: z.string().optional(),
  page: page.optional(),
  perPage: pageSize.optional(),
  sortBy: SORT_BY.optional(),
  getAll: z.boolean().optional(),
  bankAccountIds: list.optional(),
  ibans: list.optional(),
  periodFrom: period.optional(),
  periodTo: period.optional(),
})

/**
 * One page of statements (Qonto's response), or with `getAll` every
 * statement as `{ statements, meta: { total_count } }`. The account ids and
 * IBANs asked for are narrowed to the accounts the company syncs (all of
 * them when none is asked for); Qonto is always asked by account id.
 */
export async function listQontoStatements(companyId: string, filters: StatementFilters) {
  const synced = await syncedQontoAccounts(companyId)
  const askedIds = new Set(filters.bankAccountIds ?? [])
  const askedIbans = new Set((filters.ibans ?? []).map(normalizeIban))
  const filtered = askedIds.size > 0 || askedIbans.size > 0
  const accountIds = synced.filter((a) => !filtered || askedIds.has(a.id) || (a.iban !== null && askedIbans.has(a.iban))).map((a) => a.id)
  if (accountIds.length === 0) return { statements: [] as QontoStatement[], meta: { total_count: 0 } }

  const allowed = new Set(accountIds)
  const ofCompany = (statements: QontoStatement[]) => statements.filter((s) => allowed.has(s.bank_account_id))
  const client = await qontoClientFor(companyId)
  const common = {
    sortBy: filters.sortBy,
    bankAccountIds: accountIds,
    periodFrom: filters.periodFrom || undefined,
    periodTo: filters.periodTo || undefined,
  }
  if (filters.getAll) {
    const statements = ofCompany(await client.getAllStatements(common))
    return { statements, meta: { total_count: statements.length } }
  }
  const page = await client.getStatements({ ...common, page: filters.page, perPage: filters.perPage })
  return { ...page, statements: ofCompany(page.statements ?? []) }
}

/** A statement of an account the company syncs (Qonto's response), or a 404. */
export async function getCompanyQontoStatement(companyId: string, statementId: string): Promise<{ statement: QontoStatement }> {
  const synced = await syncedQontoAccounts(companyId)
  const response = await (await qontoClientFor(companyId)).getStatement(statementId)
  if (!response?.statement || !synced.some((a) => a.id === response.statement.bank_account_id)) throw new NotFoundError(STATEMENT_NOT_FOUND)
  return response
}
