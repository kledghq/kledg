/**
 * Reimbursement of an expense report, from the bank.
 *
 * A reimbursement is the line of a validated entry reconciled with a bank
 * transaction (the reconciliation entry, or an entry linked to a
 * transaction) on the claimant's account (421..., 455..., 467...), on the
 * debit side, of the same claimant (same auxiliary number) or without
 * auxiliary number (a reconciliation line often has none), not lettered.
 *
 * Invariants owned here:
 * - the report is reimbursed when its claimant line is lettered: the status
 *   is derived from the lettering (status.ts), never stored, so lettering
 *   the lines by hand in Lettrage reimburses it too, and unlettering them
 *   brings it back to comptabilisée;
 * - lettering goes through the lettering service (lib/lettering: validated
 *   entries, same account hence same fiscal year, balanced group to the
 *   cent, lock per account). Kledg has no partial lettering
 *   (docs/lettrage-et-tiers.md): the payments chosen must make exactly what
 *   the report owes, one transfer or several;
 * - the payment lines are taken from the company only, and each must be a
 *   reconciled bank line: an entry typed by hand is not a payment.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { idList } from '@/lib/api/zod-fields'
import { letterLines, type LetteredGroup } from '@/lib/lettering/lettering.service'
import { calendarDayOf } from '@/lib/utils/date'
import { formatCentsFr, parseCents } from '@/lib/utils/money'
import { REPORT_NOT_FOUND } from './manage-expense-reports.service'

/** Body of POST /api/expense-reports/[id]/reimbursement. */
export const ReimburseBodySchema = z.object({
  entryLineIds: idList(20, 'Choisissez le ou les virements de remboursement.'),
})

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

/** The report's entry and its claimant line (the credit on the claimant's account). */
async function loadClaimantLine(companyId: string, reportId: string) {
  const report = await prisma.expenseReport.findFirst({
    where: { id: reportId, companyId },
    select: {
      number: true,
      totalInclTax: true,
      claimant: { select: { auxiliaryAccountNumber: true } },
      entry: {
        select: {
          id: true,
          status: true,
          lines: {
            where: { credit: { gt: 0 } },
            select: { id: true, credit: true, letteringCode: true, auxiliaryAccountNumber: true, accountId: true, account: { select: { code: true } } },
          },
        },
      },
    },
  })
  if (!report) throw new NotFoundError(REPORT_NOT_FOUND)
  if (!report.entry) throw new ConflictError(`La note de frais ${report.number} n’est pas comptabilisée\u00a0: comptabilisez-la avant d’enregistrer son remboursement.`)
  const line = report.entry.lines.find((l) => l.auxiliaryAccountNumber === report.claimant.auxiliaryAccountNumber)
  if (!line) throw new ConflictError('L’écriture de cette note de frais n’a plus de ligne au compte du bénéficiaire\u00a0: vérifiez-la dans Écritures.')
  return { report, entry: report.entry, line, amountCents: cents(line.credit) }
}

/** Entries of the company reconciled with a bank transaction, among `entryIds`. */
async function reconciledEntries(companyId: string, entryIds: string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set()
  const [linked, created] = await Promise.all([
    prisma.bankTransaction.findMany({ where: { reconciledWith: { in: entryIds }, bankAccount: { bankConnection: { companyId } } }, select: { reconciledWith: true } }),
    prisma.accountingEntry.findMany({ where: { id: { in: entryIds }, companyId, sourceBankTransactionId: { not: null } }, select: { id: true } }),
  ])
  return new Set([...linked.map((t) => t.reconciledWith as string), ...created.map((e) => e.id)])
}

export interface ReimbursementCandidate {
  entryLineId: string
  entryId: string
  entryNumber: string
  date: string
  description: string
  amountCents: number
  /** Same amount as the report. */
  exact: boolean
}

async function candidatesOf(companyId: string, accountId: string, aux: string, excludeEntryId: string, ids?: string[]) {
  const rows = await prisma.entryLine.findMany({
    where: {
      ...(ids ? { id: { in: ids } } : {}),
      accountId,
      letteringCode: null,
      debit: { gt: 0 },
      accountingEntry: { companyId, status: 'validated', id: { not: excludeEntryId } },
      OR: [{ auxiliaryAccountNumber: null }, { auxiliaryAccountNumber: '' }, { auxiliaryAccountNumber: aux }],
    },
    select: { id: true, debit: true, description: true, accountingEntry: { select: { id: true, entryNumber: true, date: true, description: true } } },
    orderBy: [{ accountingEntry: { date: 'asc' } }, { id: 'asc' }],
    take: 500,
  })
  const reconciled = await reconciledEntries(companyId, [...new Set(rows.map((r) => r.accountingEntry.id))])
  return rows.filter((r) => reconciled.has(r.accountingEntry.id))
}

/** Bank payments that may reimburse the report: exact amounts first, then by date. */
export async function listReimbursementCandidates(companyId: string, reportId: string): Promise<{ amountCents: number; lettered: boolean; candidates: ReimbursementCandidate[] }> {
  const { report, entry, line, amountCents } = await loadClaimantLine(companyId, reportId)
  if (line.letteringCode) return { amountCents, lettered: true, candidates: [] }
  const rows = await candidatesOf(companyId, line.accountId, report.claimant.auxiliaryAccountNumber, entry.id)
  const candidates = rows
    .map((r) => ({
      entryLineId: r.id,
      entryId: r.accountingEntry.id,
      entryNumber: r.accountingEntry.entryNumber,
      date: calendarDayOf(r.accountingEntry.date) as string,
      description: r.description || r.accountingEntry.description || '',
      amountCents: cents(r.debit),
      exact: cents(r.debit) === amountCents,
    }))
    .filter((c) => c.amountCents <= amountCents)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.date.localeCompare(b.date))
    .slice(0, 50)
  return { amountCents, lettered: false, candidates }
}

/**
 * Letters the claimant line of the report with the bank payments chosen:
 * the report becomes remboursée. 400 when they do not make the amount
 * owed, 409 when the report's entry is still a draft or a line was lettered
 * meanwhile (the lettering service rechecks everything under its lock).
 */
export async function reimburseExpenseReport(
  companyId: string,
  reportId: string,
  entryLineIds: string[],
  options: { now?: Date; source?: string } = {},
): Promise<LetteredGroup> {
  const { report, entry, line, amountCents } = await loadClaimantLine(companyId, reportId)
  if (line.letteringCode) throw new ConflictError(`La note de frais ${report.number} est déjà remboursée (lettrage ${line.letteringCode}).`)
  if (entry.status !== 'validated') throw new ConflictError('Validez l’écriture de la note de frais dans Écritures avant de la lettrer avec son remboursement.')
  const unique = [...new Set(entryLineIds)]
  const payments = await candidatesOf(companyId, line.accountId, report.claimant.auxiliaryAccountNumber, entry.id, unique)
  if (payments.length !== unique.length) {
    const elsewhere = await prisma.entryLine.count({ where: { id: { in: unique }, accountingEntry: { companyId }, account: { code: line.account.code }, accountId: { not: line.accountId } } })
    if (elsewhere > 0) throw new ValidationError('Ce remboursement est sur un autre exercice que la note de frais\u00a0: lettrez-le avec les à-nouveaux dans Lettrage.')
    throw new ValidationError(
      `Un remboursement n’est pas un virement rapproché du compte ${line.account.code}, au débit, de ce bénéficiaire et non lettré\u00a0: rapprochez d’abord la transaction bancaire.`,
    )
  }
  const paid = payments.reduce((sum, p) => sum + cents(p.debit), 0)
  if (paid !== amountCents) {
    throw new ValidationError(`Les virements choisis font ${formatCentsFr(paid)}, la note de frais ${formatCentsFr(amountCents)}\u00a0: Kledg ne lettre que des montants égaux.`)
  }
  return letterLines(companyId, { accountId: line.accountId, lineIds: [line.id, ...unique] }, { now: options.now, source: options.source ?? 'expense-report' })
}
