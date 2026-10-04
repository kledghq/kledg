/**
 * Checks before closing a fiscal year. Errors block the closing; warnings
 * are shown to the user, who decides.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { endOfDay, formatTransactionDate, normalizeDate, startOfDay, todayUtc } from '@/lib/utils/date'
import { CLOSING_JOURNAL, OPENING_JOURNAL } from './constants'
import { GUARDED_FISCAL_YEAR_SELECT, isFiscalYearClosed } from '../entry-guards'
import { findUnpostedDepreciation } from '@/lib/fixed-assets/depreciation-entries'
import { parseCents } from '@/lib/utils/money'
import { plural, pluralWord } from '@/lib/utils/plural'

export interface ClosureValidationResult {
  canClose: boolean
  errors: string[]
  warnings: string[]
}

type Client = Prisma.TransactionClient | typeof prisma

const formatAmount = (cents: number) =>
  (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function validateFiscalYearClosure(
  companyId: string,
  fiscalYearId: string,
  client: Client = prisma,
  now: Date = new Date()
): Promise<ClosureValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  const fiscalYear = await client.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } })
  if (!fiscalYear) return { canClose: false, errors: ['Exercice comptable non trouvé'], warnings }
  if (isFiscalYearClosed(fiscalYear)) return { canClose: false, errors: ['Cet exercice est déjà clôturé'], warnings }

  // A closed year is locked for good: it can only be closed once it is over.
  if (todayUtc(now) <= normalizeDate(fiscalYear.endDate)) {
    errors.push(
      `L'exercice ${fiscalYear.year} ne peut être clôturé qu'après sa date de fin (${formatTransactionDate(fiscalYear.endDate)}).`
    )
  }

  // Years are closed in order: the opening balances of this year come from
  // the closing of the previous one.
  const previousOpen = await client.fiscalYear.findFirst({
    where: { companyId, isClosed: false, endDate: { lt: fiscalYear.startDate } },
    orderBy: { endDate: 'asc' },
    select: { year: true },
  })
  if (previousOpen) {
    errors.push(`L'exercice ${previousOpen.year} doit être clôturé avant l'exercice ${fiscalYear.year}.`)
  }

  const drafts = await client.accountingEntry.count({
    where: { companyId, fiscalYearId, status: 'draft' },
  })
  if (drafts > 0) {
    errors.push(`${plural(drafts, 'écriture')} en brouillon ${pluralWord(drafts, 'doit être validée ou supprimée', 'doivent être validées ou supprimées')} avant la clôture.`)
  }

  const outside = await client.accountingEntry.count({
    where: {
      companyId,
      fiscalYearId,
      OR: [{ date: { lt: startOfDay(fiscalYear.startDate) } }, { date: { gt: endOfDay(fiscalYear.endDate) } }],
    },
  })
  if (outside > 0) {
    errors.push(`${plural(outside, 'écriture')} de l'exercice ${pluralWord(outside, 'est datée', 'sont datées')} hors de ses dates de début et de fin.`)
  }

  const closing = await client.accountingEntry.count({
    where: { companyId, fiscalYearId, journal: { code: CLOSING_JOURNAL.code } },
  })
  if (closing > 0) {
    errors.push(
      `L'exercice contient déjà ${plural(closing, 'écriture')} du journal de clôture (${CLOSING_JOURNAL.code}) : ${pluralWord(closing, 'supprimez-la', 'supprimez-les')} avant de clôturer.`
    )
  }

  // Unbalanced entries would make the opening balances unbalanced.
  const unbalanced = await client.$queryRaw<Array<{ entryNumber: string; difference: Prisma.Decimal }>>`
    SELECT e."entryNumber", SUM(l."debit") - SUM(l."credit") AS difference
    FROM "accounting_entries" e
    JOIN "entry_lines" l ON l."accountingEntryId" = e."id"
    WHERE e."companyId" = ${companyId} AND e."fiscalYearId" = ${fiscalYearId} AND e."status" = 'validated'
    GROUP BY e."id", e."entryNumber"
    HAVING SUM(l."debit") <> SUM(l."credit")
    LIMIT 20
  `
  if (unbalanced.length > 0) {
    errors.push(
      `${pluralWord(unbalanced.length, 'Écriture déséquilibrée', 'Écritures déséquilibrées')} : ${unbalanced
        .map((u) => `n° ${u.entryNumber} (écart ${formatAmount((parseCents(u.difference) ?? 0))} €)`)
        .join(', ')}.`
    )
  }

  // The next year must still be open and without opening entries.
  const next = await client.fiscalYear.findFirst({
    where: { companyId, year: fiscalYear.year + 1 },
    select: GUARDED_FISCAL_YEAR_SELECT,
  })
  if (next && isFiscalYearClosed(next)) errors.push(`L'exercice suivant (${next.year}) est déjà clôturé.`)
  if (next) {
    const openings = await client.accountingEntry.count({
      where: { companyId, fiscalYearId: next.id, journal: { code: OPENING_JOURNAL.code } },
    })
    if (openings > 0) {
      errors.push(
        `L'exercice ${next.year} contient déjà ${plural(openings, 'écriture')} d'à-nouveaux (journal ${OPENING_JOURNAL.code}) : ${pluralWord(openings, 'supprimez-la', 'supprimez-les')} pour que la clôture reporte les soldes.`
      )
    }
  }

  // Class 8 accounts are outside the statements and are not carried forward.
  const special = await client.$queryRaw<Array<{ code: string; balance: Prisma.Decimal }>>`
    SELECT a."code", SUM(l."debit") - SUM(l."credit") AS balance
    FROM "entry_lines" l
    JOIN "accounts" a ON a."id" = l."accountId"
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    WHERE e."companyId" = ${companyId} AND e."fiscalYearId" = ${fiscalYearId} AND e."status" = 'validated'
      AND a."code" LIKE '8%'
    GROUP BY a."code"
    HAVING SUM(l."debit") <> SUM(l."credit")
  `
  for (const s of special) {
    warnings.push(
      `Le compte ${s.code} (classe 8) a un solde de ${formatAmount((parseCents(s.balance) ?? 0))} € : il n'est pas reporté sur l'exercice suivant.`
    )
  }

  const unposted = await findUnpostedDepreciation(companyId, fiscalYearId, client)
  if (unposted.length > 0) {
    const total = unposted.reduce((s, u) => s + u.amountCents, 0)
    warnings.push(
      `${plural(unposted.length, 'dotation')} aux amortissements (${formatAmount(total)} €) ${pluralWord(unposted.length, "n'est pas comptabilisée", 'ne sont pas comptabilisées')} pour cet exercice. Générez-les depuis le tableau des amortissements avant de clôturer si elles ne sont pas déjà passées manuellement.`
    )
  }

  return { canClose: errors.length === 0, errors, warnings }
}
