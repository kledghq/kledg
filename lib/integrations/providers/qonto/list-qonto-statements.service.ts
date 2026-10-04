/**
 * Monthly bank statements of a company's Qonto accounts, read from the
 * Qonto API with the company's stored credentials only
 * (https://docs.qonto.com/api-reference/business-api/transactions-statements/statements/list-statements).
 */

import { z } from 'zod'
import { qontoClientFor } from './get-credentials'

const SORT_BY = z.enum(['period:asc', 'period:desc'], { error: 'Tri invalide : period:asc ou period:desc.' })
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
 * statement as `{ statements, meta: { total_count } }`.
 */
export async function listQontoStatements(companyId: string, filters: StatementFilters) {
  const client = await qontoClientFor(companyId)
  const nonEmpty = (values?: string[]) => (values && values.length > 0 ? values : undefined)
  const common = {
    sortBy: filters.sortBy,
    bankAccountIds: nonEmpty(filters.bankAccountIds),
    ibans: nonEmpty(filters.ibans),
    periodFrom: filters.periodFrom || undefined,
    periodTo: filters.periodTo || undefined,
  }
  if (filters.getAll) {
    const statements = await client.getAllStatements(common)
    return { statements, meta: { total_count: statements.length } }
  }
  return client.getStatements({ ...common, page: filters.page, perPage: filters.perPage })
}
