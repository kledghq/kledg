/**
 * "Affecter le résultat": books the allocation of the previous year's
 * result, voted by the shareholders, in the open year that received it
 * (journal OD, on the date of the meeting). One validated entry through the
 * shared entry life cycle, in one transaction that locks the fiscal year:
 * running it twice, or twice at the same time, allocates once (the second
 * finds 120 / 129 at zero). Rules and sources: compute.ts.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { parseCents } from '@/lib/utils/money'
import { calendarDayOf, isoDateToUtc } from '@/lib/utils/date'
import { assertEntryWritableInFiscalYear } from '@/lib/accounting/entry-guards'
import { createValidatedEntry, ensureAccounts, ensureJournal } from '../fiscal-year-closure/ledger'
import { lockFiscalYearRow } from '../fiscal-year-closure/lock'
import {
  legalReserveApplies,
  planAllocation,
  type AllocationBalances,
  type AllocationChoice,
  type AllocationPlan,
} from './compute'

type Db = Prisma.TransactionClient | typeof prisma

const ACCOUNT_LABELS: Record<string, string> = {
  '110': 'Report à nouveau - solde créditeur',
  '119': 'Report à nouveau - solde débiteur',
  '120': "Résultat de l'exercice - bénéfice",
  '129': "Résultat de l'exercice - perte",
  '1061': 'Réserve légale',
  '1068': 'Autres réserves',
  '457': 'Associés - Dividendes à payer',
}

/** Balances of the accounts the allocation uses, in the fiscal year (validated entries). */
export async function allocationBalances(db: Db, companyId: string, fiscalYearId: string): Promise<AllocationBalances> {
  const rows = await db.$queryRaw<Array<{ code: string; debit: Prisma.Decimal; credit: Prisma.Decimal }>>`
    SELECT a."code", COALESCE(SUM(l."debit"), 0) AS debit, COALESCE(SUM(l."credit"), 0) AS credit
    FROM "entry_lines" l
    JOIN "accounts" a ON a."id" = l."accountId"
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    WHERE e."companyId" = ${companyId} AND e."fiscalYearId" = ${fiscalYearId} AND e."status" = 'validated'
      AND (a."code" LIKE '12%' OR a."code" LIKE '101%' OR a."code" LIKE '1061%' OR a."code" LIKE '11%')
    GROUP BY a."code"
  `
  const credit = (prefix: string) =>
    rows
      .filter((r) => r.code.startsWith(prefix))
      .reduce((s, r) => s + (parseCents(r.credit) ?? 0) - (parseCents(r.debit) ?? 0), 0)
  const result = credit('120') + credit('129') // 1209 (acomptes sur dividendes) is left out
  return {
    resultCents: result,
    legalReserveCents: Math.max(0, credit('1061')),
    capitalCents: Math.max(0, credit('101')),
    retainedEarningsCents: Math.max(0, credit('110')),
    priorLossesCents: Math.max(0, -credit('119')),
  }
}

export interface AllocationPreview {
  fiscalYear: { id: string; year: number; startDate: Date; endDate: Date }
  balances: AllocationBalances
  plan: AllocationPlan
}

/** What the allocation would book with these choices (dividends and other reserves in cents). */
export async function previewResultAllocation(
  companyId: string,
  fiscalYearId: string,
  choice: AllocationChoice = { dividendsCents: 0, otherReservesCents: 0 },
  db: Db = prisma
): Promise<AllocationPreview> {
  const fiscalYear = await db.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } })
  if (!fiscalYear) throw new NotFoundError('Exercice comptable introuvable')
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { legalType: true } })
  const balances = await allocationBalances(db, companyId, fiscalYearId)
  const plan = planAllocation(balances, choice, { legalReserveRequired: legalReserveApplies(company.legalType) })
  return {
    fiscalYear: { id: fiscalYear.id, year: fiscalYear.year, startDate: fiscalYear.startDate, endDate: fiscalYear.endDate },
    balances,
    plan,
  }
}

export async function allocateResult(
  companyId: string,
  fiscalYearId: string,
  input: AllocationChoice & { date: string; userId?: string | null }
): Promise<{ entryId: string; entryNumber: string; plan: AllocationPlan }> {
  const day = calendarDayOf(input.date)
  if (!day) throw new ValidationError("Date de l'assemblée invalide : utilisez le format AAAA-MM-JJ")
  return prisma.$transaction(
    async (tx) => {
      const fiscalYear = await lockFiscalYearRow(tx, fiscalYearId, companyId)
      if (!fiscalYear) throw new NotFoundError('Exercice comptable introuvable')
      assertEntryWritableInFiscalYear(fiscalYear, day, 'create')

      const { plan } = await previewResultAllocation(companyId, fiscalYearId, input, tx)
      if (plan.errors.length > 0) {
        const nothing = plan.resultCents === 0
        throw nothing ? new ConflictError(plan.errors[0]) : new ValidationError(plan.errors.join(' '))
      }

      const journal = await ensureJournal(tx, companyId, { code: 'OD', label: 'Opérations diverses' })
      const accountIds = await ensureAccounts(
        tx,
        companyId,
        fiscalYearId,
        plan.lines.map((l) => ({ code: l.code, label: ACCOUNT_LABELS[l.code] ?? l.code }))
      )
      const previousYear = fiscalYear.year - 1
      const entry = await createValidatedEntry(tx, {
        companyId,
        fiscalYearId,
        journalId: journal.id,
        date: isoDateToUtc(day),
        description: `Affectation du résultat de l'exercice ${previousYear}`,
        reference: `AFF-${previousYear}`,
        lines: plan.lines,
        lineDescription: (line) => `Affectation du résultat ${previousYear} - ${ACCOUNT_LABELS[line.code] ?? line.code}`,
        accountIds,
      })
      await tx.auditLog.create({
        data: {
          userId: input.userId ?? null,
          companyId,
          action: 'ALLOCATE_RESULT',
          level: 'INFO',
          message: `Résultat ${previousYear} affecté`,
          metadata: {
            fiscalYearId,
            entryId: entry.id,
            resultCents: plan.resultCents,
            legalReserveCents: plan.legalReserveCents,
            dividendsCents: plan.dividendsCents,
            otherReservesCents: plan.otherReservesCents,
            retainedEarningsCents: plan.retainedEarningsCents,
          },
        },
      })
      return { entryId: entry.id, entryNumber: entry.entryNumber, plan }
    },
    { maxWait: 10_000, timeout: 60_000 }
  )
}
