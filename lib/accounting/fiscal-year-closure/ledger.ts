/**
 * Database helpers of the fiscal year closing. Every function takes the
 * transaction client, so the closing reads and writes in one transaction.
 */

import type { Prisma } from '@prisma/client'
import { createEntryInTx } from '../services/entry-lifecycle.service'
import { journalByCode } from '../journal-by-code'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import { addUtcDays, lastDayOfMonth, utcDate } from '@/lib/utils/date'
import type { ClosingAccountBalance, ClosingLine } from './closing-entries'

export type Tx = Prisma.TransactionClient

/** Exact cents of a stored amount (lib/utils/money.ts). */
const cents = (value: Prisma.Decimal | number | string | null | undefined) => parseCents(value) ?? 0

/**
 * Balances (cents) of the accounts of a fiscal year from its validated
 * entries, by account code. With `excludeClosing`, the closing entries
 * (journal CL) are left out.
 */
export async function loadYearBalances(
  tx: Tx,
  companyId: string,
  fiscalYearId: string,
  options: { excludeJournalCodes?: string[] } = {}
): Promise<ClosingAccountBalance[]> {
  const sums = await tx.entryLine.groupBy({
    by: ['accountId'],
    where: {
      accountFiscalYearId: fiscalYearId,
      accountingEntry: {
        companyId,
        fiscalYearId,
        status: 'validated',
        ...(options.excludeJournalCodes?.length
          ? { journal: { code: { notIn: options.excludeJournalCodes } } }
          : {}),
      },
    },
    _sum: { debit: true, credit: true },
  })
  const accounts = await tx.account.findMany({
    where: { id: { in: sums.map((s) => s.accountId) } },
    select: { id: true, code: true, label: true },
  })
  const byId = new Map(accounts.map((a) => [a.id, a]))
  return sums.map((s) => ({
    code: byId.get(s.accountId)?.code ?? '',
    label: byId.get(s.accountId)?.label ?? '',
    debitCents: cents(s._sum.debit),
    creditCents: cents(s._sum.credit),
  }))
}

/** Gets or creates a journal of the company by code. */
export async function ensureJournal(tx: Tx, companyId: string, journal: { code: string; label: string }) {
  return journalByCode(tx, companyId, journal.code, { create: { label: journal.label } })
}

/**
 * Account ids of a fiscal year by code, creating the missing ones (with
 * their parents, copied from `source` accounts or from `labels`).
 */
export async function ensureAccounts(
  tx: Tx,
  companyId: string,
  fiscalYearId: string,
  codes: Array<{ code: string; label: string }>
): Promise<Map<string, string>> {
  const existing = await tx.account.findMany({
    where: { companyId, fiscalYearId },
    select: { id: true, code: true },
  })
  const ids = new Map(existing.map((a) => [a.code, a.id]))
  for (const { code, label } of codes) {
    if (ids.has(code)) continue
    // Parent: the longest existing code that prefixes this one.
    let parentId: string | null = null
    for (let length = code.length - 1; length > 0 && !parentId; length--) {
      parentId = ids.get(code.slice(0, length)) ?? null
    }
    const created = await tx.account.create({
      data: { companyId, fiscalYearId, code, label, parentId, isPCG: true },
      select: { id: true },
    })
    ids.set(code, created.id)
  }
  return ids
}

/**
 * Copies the chart of accounts of a fiscal year into the next one: the
 * accounts whose code the next year does not have yet, parents first.
 * Returns the number of accounts created.
 */
export async function copyChartOfAccounts(
  tx: Tx,
  companyId: string,
  fromFiscalYearId: string,
  toFiscalYearId: string
): Promise<number> {
  const [source, target] = await Promise.all([
    tx.account.findMany({
      where: { companyId, fiscalYearId: fromFiscalYearId },
      select: { id: true, code: true, label: true, isPCG: true, parentId: true },
    }),
    tx.account.findMany({ where: { companyId, fiscalYearId: toFiscalYearId }, select: { id: true, code: true } }),
  ])
  const sourceById = new Map(source.map((a) => [a.id, a]))
  const targetByCode = new Map(target.map((a) => [a.code, a.id]))
  const depth = (account: (typeof source)[number]): number => {
    let d = 0
    let current = account
    const seen = new Set<string>()
    while (current.parentId && sourceById.has(current.parentId) && !seen.has(current.id)) {
      seen.add(current.id)
      current = sourceById.get(current.parentId)!
      d += 1
    }
    return d
  }
  const missing = source.filter((a) => !targetByCode.has(a.code))
  const levels = new Map<number, typeof missing>()
  for (const account of missing) {
    const d = depth(account)
    levels.set(d, [...(levels.get(d) ?? []), account])
  }
  let created = 0
  for (const d of [...levels.keys()].sort((a, b) => a - b)) {
    const rows = levels.get(d)!.map((account) => {
      const parentCode = account.parentId ? sourceById.get(account.parentId)?.code : undefined
      return {
        companyId,
        fiscalYearId: toFiscalYearId,
        code: account.code,
        label: account.label,
        isPCG: account.isPCG,
        parentId: parentCode ? targetByCode.get(parentCode) ?? null : null,
      }
    })
    const inserted = await tx.account.createManyAndReturn({ data: rows, select: { id: true, code: true } })
    for (const a of inserted) targetByCode.set(a.code, a.id)
    created += inserted.length
  }
  return created
}

/**
 * Creates an entry and validates it through the shared entry life cycle
 * (lib/accounting/services/entry-lifecycle.service.ts): created as a draft
 * with its lines, then validated in the same transaction, which assigns the
 * definitive number under the fiscal year numbering lock and checks the
 * balance again (database triggers of migration 20261003180000). Account
 * codes are resolved in the fiscal year.
 */
export async function createValidatedEntry(
  tx: Tx,
  input: {
    companyId: string
    fiscalYearId: string
    journalId: string
    date: Date
    description: string
    reference: string
    lines: ClosingLine[]
    lineDescription: (line: ClosingLine) => string
    accountIds: Map<string, string>
  }
): Promise<{ id: string; entryNumber: string }> {
  const entry = await createEntryInTx(tx, {
    companyId: input.companyId,
    fiscalYearId: input.fiscalYearId,
    journalId: input.journalId,
    date: input.date,
    description: input.description,
    reference: input.reference,
    status: 'validated',
    lines: input.lines.map((line) => {
      const accountId = input.accountIds.get(line.code)
      if (!accountId) throw new Error(`Account ${line.code} missing in fiscal year ${input.fiscalYearId}`)
      return {
        accountId,
        debit: centsToDecimal(line.debitCents),
        credit: centsToDecimal(line.creditCents),
        description: input.lineDescription(line),
      }
    }),
  })
  const created = await tx.accountingEntry.findUniqueOrThrow({
    where: { id: entry.id },
    select: { id: true, entryNumber: true },
  })
  return created
}

/** Dates of the fiscal year after one ending on `endDate`: the next day to the same day a year later. */
export function nextFiscalYearDates(endDate: Date): { startDate: Date; endDate: Date } {
  const year = endDate.getUTCFullYear()
  const month = endDate.getUTCMonth() + 1
  const day = endDate.getUTCDate()
  const endsOnMonthEnd = day === lastDayOfMonth(year, month)
  const nextDay = endsOnMonthEnd ? lastDayOfMonth(year + 1, month) : Math.min(day, lastDayOfMonth(year + 1, month))
  return { startDate: addUtcDays(endDate, 1), endDate: utcDate(year + 1, month, nextDay) }
}
