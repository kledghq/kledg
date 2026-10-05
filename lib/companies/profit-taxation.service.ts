/**
 * Loads what profitTaxationOf (profit-taxation.ts) needs for a company: its
 * legal form, its corporate tax regime history and field, and the type of
 * its associés, in three queries whatever the number of days asked.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { calendarDayOf } from '@/lib/utils/date'
import { corporateTaxRegimeOn, profitTaxationOf, type ProfitTaxation } from './profit-taxation'

type Db = Prisma.TransactionClient | typeof prisma

/** A resolver of the taxation of the profits of the company on any day (yyyy-mm-dd), loaded once. */
export async function loadProfitTaxationResolver(companyId: string, db: Db = prisma): Promise<(day: string) => ProfitTaxation> {
  const [company, history, shareholders] = await Promise.all([
    db.company.findFirst({ where: { id: companyId }, select: { legalType: true, corporateTaxRegime: true } }),
    db.taxRegimeHistory.findMany({
      where: { companyId, regimeType: 'corporateTax' },
      select: { regime: true, startDate: true, endDate: true, establishmentId: true },
    }),
    db.shareholder.findMany({ where: { companyId }, select: { type: true }, take: 50 }),
  ])
  const rows = history.map((r) => ({
    regime: r.regime,
    startDate: calendarDayOf(r.startDate) as string,
    endDate: r.endDate ? (calendarDayOf(r.endDate) as string) : null,
    establishmentId: r.establishmentId,
  }))
  return (day) =>
    profitTaxationOf({
      legalType: company?.legalType ?? null,
      regime: corporateTaxRegimeOn(day, rows, company?.corporateTaxRegime ?? null),
      shareholders,
    })
}

/** The taxation of the profits of the company on each day asked (yyyy-mm-dd). */
export async function loadProfitTaxation(companyId: string, days: readonly string[], db: Db = prisma): Promise<Map<string, ProfitTaxation>> {
  const resolve = await loadProfitTaxationResolver(companyId, db)
  return new Map([...new Set(days)].map((day) => [day, resolve(day)]))
}
