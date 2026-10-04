/**
 * Books the opening balances (bilan d'ouverture) of a company that existed
 * before Kledg (rules in opening-lines.ts): one entry in the AN journal, on
 * the first day of the company's first fiscal year in Kledg, through the one
 * entry creation path (createEntryInTx). Draft by default, so a beginner can
 * check it in Écritures before validating it; validated on request.
 *
 * Serialized per fiscal year with an advisory lock: two submissions never
 * create two opening entries.
 */

import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { createEntryInTx, getEntry } from '@/lib/accounting/services/entry-lifecycle.service'
import { ensureJournal } from '@/lib/accounting/fiscal-year-closure/ledger'
import { OPENING_JOURNAL, openingReference } from '@/lib/accounting/fiscal-year-closure/constants'
import { centsToDecimal } from '@/lib/utils/money'
import { calendarDayOf } from '@/lib/utils/date'
import { checkOpeningLines, type OpeningLineInput } from './opening-lines'

export interface OpeningTarget {
  fiscalYear: { id: string; year: number; startDate: string; endDate: string; isClosed: boolean }
  /** The opening entry already booked in that year, if any. */
  existingEntry: { id: string; entryNumber: string; status: string } | null
}

/** The first fiscal year of the company in Kledg, where the opening balances go. */
export async function getOpeningTarget(companyId: string): Promise<OpeningTarget | null> {
  const fiscalYear = await prisma.fiscalYear.findFirst({
    where: { companyId },
    orderBy: { startDate: 'asc' },
    select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
  })
  if (!fiscalYear) return null
  const existingEntry = await prisma.accountingEntry.findFirst({
    where: { companyId, fiscalYearId: fiscalYear.id, journal: { code: OPENING_JOURNAL.code } },
    select: { id: true, entryNumber: true, status: true },
    orderBy: { createdAt: 'asc' },
  })
  return {
    fiscalYear: {
      id: fiscalYear.id,
      year: fiscalYear.year,
      startDate: calendarDayOf(fiscalYear.startDate) ?? '',
      endDate: calendarDayOf(fiscalYear.endDate) ?? '',
      isClosed: fiscalYear.isClosed,
    },
    existingEntry,
  }
}

export async function postOpeningBalances(input: {
  companyId: string
  lines: OpeningLineInput[]
  validate: boolean
}) {
  const check = checkOpeningLines(input.lines)
  if (check.errors.length > 0) throw new ValidationError(check.errors.join(' '))
  const lines = input.lines.filter((l) => l.debitCents !== 0 || l.creditCents !== 0)

  const target = await prisma.fiscalYear.findFirst({
    where: { companyId: input.companyId },
    orderBy: { startDate: 'asc' },
    select: { id: true, year: true, startDate: true, isClosed: true },
  })
  if (!target) throw new NotFoundError("Aucun exercice pour cette société : créez d'abord son premier exercice.")
  if (target.isClosed) {
    throw new ConflictError(`L'exercice ${target.year} est clôturé : ses à-nouveaux ne peuvent plus être saisis.`)
  }

  const entryId = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:opening-balances:${target.id}`}))`
      const existing = await tx.accountingEntry.count({
        where: { companyId: input.companyId, fiscalYearId: target.id, journal: { code: OPENING_JOURNAL.code } },
      })
      if (existing > 0) {
        throw new ConflictError(
          `L'exercice ${target.year} a déjà une écriture d'à-nouveaux (journal ${OPENING_JOURNAL.code}) : corrigez-la dans Écritures plutôt que d'en saisir une seconde.`,
        )
      }
      const codes = lines.map((l) => l.accountCode.trim())
      const accounts = await tx.account.findMany({
        where: { companyId: input.companyId, fiscalYearId: target.id, code: { in: codes } },
        select: { id: true, code: true, label: true },
      })
      const byCode = new Map(accounts.map((a) => [a.code, a]))
      const missing = codes.filter((code) => !byCode.has(code))
      if (missing.length > 0) {
        throw new ValidationError(
          `Compte${missing.length > 1 ? 's' : ''} absent${missing.length > 1 ? 's' : ''} du plan comptable de l'exercice ${target.year} : ${missing.join(', ')}. Créez-le${missing.length > 1 ? 's' : ''} dans Plan de comptes.`,
        )
      }
      const journal = await ensureJournal(tx, input.companyId, OPENING_JOURNAL)
      const entry = await createEntryInTx(tx, {
        companyId: input.companyId,
        journalId: journal.id,
        fiscalYearId: target.id,
        date: target.startDate,
        description: `À-nouveaux de l'exercice ${target.year} (bilan d'ouverture)`,
        reference: openingReference(target.year),
        status: input.validate ? 'validated' : 'draft',
        lines: lines.map((line) => {
          const account = byCode.get(line.accountCode.trim())!
          return {
            accountId: account.id,
            debit: centsToDecimal(line.debitCents),
            credit: centsToDecimal(line.creditCents),
            description: `À-nouveau ${account.code} ${account.label}`.trim(),
          }
        }),
      })
      return entry.id
    },
    { maxWait: 10_000, timeout: 30_000 },
  )
  return getEntry(entryId)
}
