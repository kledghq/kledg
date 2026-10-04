/**
 * Resolution of what assistants name (account numbers, journal codes, days)
 * into the ids the services take, always within the granted company.
 * Accounts are per fiscal year: a code is looked up in the fiscal year that
 * contains the day of the operation.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { getFiscalYearForDate } from '@/lib/accounting/fiscal-year-utils'
import { isoDateToUtc } from '@/lib/utils/date'

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ')

/** Amount in euros: a number or a decimal string, two decimals at most. */
export const euros = z.union([z.number().min(0), z.string().regex(/^\d+(\.\d{1,2})?$/, 'Montant invalide')])

/** A fiscal year of the company (404 for an id of another company), shared with the API routes. */
export { FISCAL_YEAR_NOT_FOUND, ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'

/** The fiscal year containing a day (yyyy-mm-dd), or a French ValidationError. */
export async function fiscalYearOfDay(companyId: string, day: string): Promise<{ id: string; year: number }> {
  const fiscalYear = await getFiscalYearForDate(companyId, isoDateToUtc(day))
  if (!fiscalYear) throw new ValidationError(`Aucun exercice ne couvre le ${day}.`)
  return fiscalYear
}

/** Account ids by code in a fiscal year; every code must exist. */
export async function accountIdsByCode(companyId: string, fiscalYearId: string, codes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(codes)]
  const accounts = await prisma.account.findMany({
    where: { companyId, fiscalYearId, code: { in: unique } },
    select: { id: true, code: true },
  })
  const byCode = new Map(accounts.map((a) => [a.code, a.id]))
  const missing = unique.filter((c) => !byCode.has(c))
  if (missing.length) {
    throw new ValidationError(`Comptes introuvables dans l'exercice : ${missing.join(', ')}. Utilisez search_accounts ou create_account.`)
  }
  return byCode
}

/** Journal id by code (BQ, AC, OD...). */
export async function journalIdByCode(companyId: string, code: string): Promise<string> {
  const journal = await prisma.journal.findFirst({ where: { companyId, code: code.trim().toUpperCase() }, select: { id: true } })
  if (!journal) throw new ValidationError(`Journal ${code} introuvable. Utilisez list_journals ou create_journal.`)
  return journal.id
}
