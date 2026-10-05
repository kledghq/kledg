/**
 * Posting of a validated expense report: one draft entry, created through
 * createEntryInTx (the one entry creation path: balance, accounts and
 * journal of the company, fiscal year open and containing the date).
 *
 * The entry, dated on the last day of the report's period (the day the
 * company owes the claimant), in the NDF journal when the company has one,
 * else in OD (opérations diverses):
 *
 * | Account | Debit | Credit |
 * | --- | --- | --- |
 * | Expense account of each line (6251, 6256, 6257, 6061...) | TTC minus the recoverable VAT | |
 * | 44566 TVA sur autres biens et services, per rate | recoverable VAT | |
 * | Claimant account (421, 455, 467 or its own), with its auxiliary number | | what the report owes |
 *
 * Meals of the exploitant (exploitant-meals.ts, BOI-BNC-BASE-40-60-60): at a
 * company taxed at the impôt sur le revenu, a meal alone (MEALS) of the
 * exploitant or an associé is split: the deductible part (the frais
 * supplémentaires) on the line's account, the rest on 62568 "Repas de
 * l'exploitant, part non déductible" (created in the year's chart when
 * missing), whose balance is added back on the return. A meal whose taker
 * is unknown is refused until the line says it.
 *
 * Invariants owned here:
 * - only a validated report posts, once: its row is locked and its entryId
 *   checked under the lock;
 * - the fiscal year is the one containing the entry date, and every line is
 *   dated in it (a charge belongs to the year it was incurred: independence
 *   of fiscal years); no year: 400, closed: 409;
 * - every account is resolved in that fiscal year's chart of the company
 *   (lib/invoices/ledger-accounts.ts), never taken as an id from a request;
 * - the amounts are the report's stored cents; the entry balances by
 *   construction (sum of charges + VAT = TTC) and createEntryInTx checks it
 *   again;
 * - unposting deletes the entry only while it is a draft; a validated entry
 *   is corrected by a contre-passation (PCG art. 1031-3).
 */

import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { assertEntryWritableInFiscalYear, fiscalYearContaining, GUARDED_FISCAL_YEAR_SELECT } from '@/lib/accounting/entry-guards'
import { createEntryInTx, deleteDraftEntryInTx } from '@/lib/accounting/services/entry-lifecycle.service'
import { writeAuditLog } from '@/lib/audit'
import { formatVatRate } from '@/lib/invoices/amounts'
import { accountByRoot, accountsByCode } from '@/lib/invoices/ledger-accounts'
import { calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { EXPENSE_CATEGORIES, type ExpenseCategory } from './categories'
import { lockExpenseReport, reportMealRule, REPORT_NOT_FOUND } from './manage-expense-reports.service'
import { nonDeductibleMealsAccount } from './meal-rule.service'
import { DEFAULT_CLAIMANT_ACCOUNT } from './status'

/** Journals tried in order: a dedicated NDF journal, else miscellaneous operations. */
export const EXPENSE_JOURNALS = ['NDF', 'OD'] as const

const PURPOSE = 'les notes de frais'

const DEDUCTIBLE_VAT = { root: '44566', label: 'TVA sur autres biens et services' }

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const

export interface PlannedLine {
  accountId: string
  debitCents: number
  creditCents: number
  description: string
  auxiliaryAccountNumber?: string
  auxiliaryAccountLabel?: string
}

export interface PostExpenseResult {
  reportId: string
  entryId: string
  entryNumber: string
  fiscalYear: number
  journal: string
}

export async function postExpenseReport(companyId: string, reportId: string, options: { source?: string } = {}): Promise<PostExpenseResult> {
  const result = await prisma.$transaction(async (tx) => {
    const locked = await lockExpenseReport(tx, companyId, reportId, null)
    if (locked.entryId) throw new ConflictError(`La note de frais ${locked.number} est déjà comptabilisée.`)
    if (locked.status !== 'VALIDATED') throw new ConflictError(`La note de frais ${locked.number} doit être validée avant d’être comptabilisée.`)
    const report = await tx.expenseReport.findUniqueOrThrow({
      where: { id: reportId },
      select: {
        number: true,
        label: true,
        periodEnd: true,
        totalInclTax: true,
        claimant: { select: { name: true, kind: true, accountCode: true, auxiliaryAccountNumber: true, personId: true } },
        lines: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            kind: true,
            date: true,
            label: true,
            supplierName: true,
            category: true,
            accountCode: true,
            amountInclTax: true,
            vatRateBp: true,
            recoverableVat: true,
            mealTaker: true,
          },
        },
      },
    })
    const totalCents = cents(report.totalInclTax)
    if (report.lines.length === 0 || totalCents <= 0) throw new ValidationError(`La note de frais ${report.number} ne porte aucun montant à rembourser.`)

    const day = calendarDayOf(report.periodEnd) as string
    const years = await tx.fiscalYear.findMany({ where: { companyId }, select: GUARDED_FISCAL_YEAR_SELECT, orderBy: { startDate: 'asc' } })
    const fiscalYear = fiscalYearContaining(years, day)
    if (!fiscalYear) {
      throw new ValidationError(`Aucun exercice ne contient le ${formatIsoDateFr(day)}, fin de la période de la note\u00a0: créez l’exercice avant de la comptabiliser.`)
    }
    assertEntryWritableInFiscalYear(fiscalYear, day, 'create')
    const outside = report.lines.find((line) => fiscalYearContaining([fiscalYear], calendarDayOf(line.date) as string) === undefined)
    if (outside) {
      throw new ValidationError(
        `Ligne ${outside.position} : la dépense du ${formatIsoDateFr(calendarDayOf(outside.date) as string)} relève d’un autre exercice que ${fiscalYear.year}\u00a0: faites-en une note de frais distincte.`,
      )
    }

    const journals = await tx.journal.findMany({ where: { companyId, code: { in: [...EXPENSE_JOURNALS] } }, select: { id: true, code: true } })
    const journal = EXPENSE_JOURNALS.map((code) => journals.find((j) => j.code === code)).find(Boolean)
    if (!journal) throw new ValidationError('Ni journal NDF ni journal OD\u00a0: créez l’un des deux dans Journaux pour comptabiliser les notes de frais.')

    // Accounts of that year's chart: a code typed on the line is taken as is, a category's default by its PCG root.
    const typed = report.lines.filter((l) => l.accountCode).map((l) => l.accountCode as string)
    const byCode = await accountsByCode(tx, companyId, fiscalYear, typed)
    const byRoot = new Map<string, { id: string; code: string }>()
    const lineAccount = async (line: (typeof report.lines)[number]) => {
      if (line.accountCode) return byCode.get(line.accountCode)!
      const definition = EXPENSE_CATEGORIES[line.category as ExpenseCategory]
      if (!definition?.account) throw new ValidationError(`Ligne ${line.position} : choisissez le compte de charge de la dépense.`)
      if (!byRoot.has(definition.account)) byRoot.set(definition.account, await accountByRoot(tx, companyId, fiscalYear, definition.account, definition.label, PURPOSE))
      return byRoot.get(definition.account)!
    }
    const claimantAccount = report.claimant.accountCode
      ? (await accountsByCode(tx, companyId, fiscalYear, [report.claimant.accountCode])).get(report.claimant.accountCode)!
      : await accountByRoot(tx, companyId, fiscalYear, DEFAULT_CLAIMANT_ACCOUNT[report.claimant.kind].root, DEFAULT_CLAIMANT_ACCOUNT[report.claimant.kind].label, PURPOSE)

    const meals = await reportMealRule(tx, companyId, report)
    const unanswered = report.lines.filter((_, i) => meals.lines[i]?.status === 'ask')
    if (unanswered.length > 0) {
      throw new ValidationError(
        `${unanswered.map((l) => `Ligne ${l.position}`).join(', ')} : indiquez qui a pris ce repas (l’exploitant ou un associé, ou un salarié). La société est imposée à l’impôt sur le revenu : le repas de l’exploitant n’est déductible que pour ses frais supplémentaires.`,
      )
    }

    const description = `Note de frais ${report.number} ${report.claimant.name}`.slice(0, 250)
    const planned: PlannedLine[] = []
    const vatByRate = new Map<number, number>()
    for (const [index, line] of report.lines.entries()) {
      const recoverable = cents(line.recoverableVat)
      const expense = cents(line.amountInclTax) - recoverable
      const lineDescription = [line.label, line.supplierName].filter(Boolean).join(', ')
      const split = meals.lines[index]?.status === 'split' ? meals.lines[index]!.split! : null
      if (split && split.nonDeductibleCents > 0) {
        const account = await lineAccount(line)
        if (split.deductibleCents > 0) planned.push({ accountId: account.id, debitCents: split.deductibleCents, creditCents: 0, description: lineDescription.slice(0, 250) })
        const nonDeductible = await nonDeductibleMealsAccount(tx, companyId, fiscalYear.id, account.code)
        planned.push({
          accountId: nonDeductible.id,
          debitCents: split.nonDeductibleCents,
          creditCents: 0,
          description: `${lineDescription}, part non déductible (repas de l’exploitant)`.slice(0, 250),
        })
      } else if (expense > 0) {
        planned.push({
          accountId: (await lineAccount(line)).id,
          debitCents: expense,
          creditCents: 0,
          description: lineDescription.slice(0, 250),
        })
      }
      if (recoverable > 0) vatByRate.set(line.vatRateBp, (vatByRate.get(line.vatRateBp) ?? 0) + recoverable)
    }
    if (vatByRate.size > 0) {
      const vatAccount = await accountByRoot(tx, companyId, fiscalYear, DEDUCTIBLE_VAT.root, DEDUCTIBLE_VAT.label, PURPOSE)
      for (const [rate, amount] of [...vatByRate.entries()].sort(([a], [b]) => b - a)) {
        planned.push({ accountId: vatAccount.id, debitCents: amount, creditCents: 0, description: `TVA déductible ${formatVatRate(rate)}, ${report.number}` })
      }
    }
    const debits = planned.reduce((sum, l) => sum + l.debitCents, 0)
    if (debits !== totalCents) {
      // Stored amounts always satisfy this (check constraints of the migration): a mismatch is a bug, never posted.
      throw new ConflictError(`Les lignes de la note de frais ${report.number} ne font pas son total\u00a0: enregistrez-la à nouveau avant de la comptabiliser.`)
    }
    planned.push({
      accountId: claimantAccount.id,
      debitCents: 0,
      creditCents: totalCents,
      description,
      auxiliaryAccountNumber: report.claimant.auxiliaryAccountNumber,
      auxiliaryAccountLabel: report.claimant.name.slice(0, 100),
    })

    const entry = await createEntryInTx(tx, {
      companyId,
      journalId: journal.id,
      fiscalYearId: fiscalYear.id,
      date: day,
      pieceDate: day,
      description,
      reference: report.number,
      status: 'draft',
      lines: planned.map((line) => ({
        accountId: line.accountId,
        debit: centsToDecimal(line.debitCents),
        credit: centsToDecimal(line.creditCents),
        description: line.description,
        auxiliaryAccountNumber: line.auxiliaryAccountNumber ?? null,
        auxiliaryAccountLabel: line.auxiliaryAccountLabel ?? null,
      })),
    })
    await tx.expenseReport.update({ where: { id: reportId }, data: { entryId: entry.id } })
    const created = await tx.accountingEntry.findUniqueOrThrow({ where: { id: entry.id }, select: { entryNumber: true } })
    return { entryId: entry.id, entryNumber: created.entryNumber, fiscalYear: fiscalYear.year, number: report.number, journal: journal.code }
  }, TX_OPTIONS)

  await writeAuditLog('info', `Expense report posted: ${result.number}`, {
    action: 'POST_EXPENSE_REPORT',
    companyId,
    metadata: { reportId, entryId: result.entryId, source: options.source ?? 'web' },
  })
  return { reportId, entryId: result.entryId, entryNumber: result.entryNumber, fiscalYear: result.fiscalYear, journal: result.journal }
}

/** Deletes the draft entry of a report: the report is validated again, not posted. */
export async function unpostExpenseReport(companyId: string, reportId: string): Promise<{ reportId: string }> {
  const number = await prisma.$transaction(async (tx) => {
    const locked = await lockExpenseReport(tx, companyId, reportId, null)
    if (!locked.entryId) throw new ConflictError(`La note de frais ${locked.number} n’est pas comptabilisée.`)
    const entry = await tx.accountingEntry.findFirst({ where: { id: locked.entryId, companyId }, select: { status: true, entryNumber: true } })
    if (!entry) throw new NotFoundError(REPORT_NOT_FOUND)
    if (entry.status === 'validated') {
      throw new ConflictError(`L’écriture n° ${entry.entryNumber} de cette note de frais est validée (PCG art. 1031-3)\u00a0: contre-passez-la depuis Écritures pour l’annuler.`)
    }
    await tx.expenseReport.update({ where: { id: reportId }, data: { entryId: null } })
    await deleteDraftEntryInTx(tx, companyId, locked.entryId)
    return locked.number
  }, TX_OPTIONS)
  await writeAuditLog('info', `Expense report unposted: ${number}`, { action: 'UNPOST_EXPENSE_REPORT', companyId, metadata: { reportId } })
  return { reportId }
}
