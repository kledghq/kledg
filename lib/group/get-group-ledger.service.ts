/**
 * Grand livre combiné of the group space (docs/vue-groupe.md): for the
 * holding's fiscal year, every account number used by the companies read,
 * with each company's debits, credits and balance and their sum
 * (aggregate.ts), then, for one account number, its lines in every company
 * in date order. Read only.
 *
 * An aggregation, not a consolidation: the books are added up at 100 %, the
 * intragroup flows stay on both sides (the vue combinée is where they are
 * eliminated), and an account number means the same thing in two companies
 * only as far as their charts agree (the PCG numbers do; sub-accounts are
 * each company's own). Same scope as the statements: validated entries of
 * the fiscal year matched to the holding's, closing entries excluded.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { GroupAccess } from '@/lib/management-fees/access'
import { CLOSING_JOURNAL } from '@/lib/accounting/fiscal-year-closure/constants'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import { calendarDayOf } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { GroupViewQuerySchema, periodRef, resolveHoldingFiscalYear, type PeriodRef } from './get-group-view.service'
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink } from './members'
import { GROUP_ENTRIES_READ, type UnreachableSubsidiary } from './perimeter'
import { matchFiscalYear } from './read-member'

const GROUP_LEDGER_NOTICE =
  'Grand livre combiné : les comptes des sociétés lues additionnés à 100 %, flux intragroupe compris. Une agrégation, pas une consolidation.'

/** Lines of one account shown at most, all companies together. */
const MAX_LEDGER_LINES = 1000

export const GroupLedgerQuerySchema = GroupViewQuerySchema.extend({
  /** Account numbers starting with these digits (a class, "6", or an account, "512"). */
  prefix: z.string().regex(/^\d{1,10}$/, 'Préfixe de compte attendu en chiffres').optional(),
  /** One account number: its lines in every company. */
  account: z.string().regex(/^\d{1,20}$/, 'Numéro de compte attendu en chiffres').optional(),
})
export type GroupLedgerQuery = z.infer<typeof GroupLedgerQuerySchema>

export interface LedgerAmounts {
  debitCents: number
  creditCents: number
  /** Debit minus credit. */
  balanceCents: number
}

export interface CombinedLedgerAccount {
  code: string
  label: string
  byCompany: Record<string, LedgerAmounts>
  total: LedgerAmounts
}

export interface CombinedLedgerLine {
  companyId: string
  date: string
  journal: string
  entryNumber: string
  label: string | null
  debitCents: number
  creditCents: number
}

export interface GroupLedgerReport {
  holding: { id: string; name: string }
  fiscalYear: PeriodRef
  notice: string
  companies: Array<GroupCompanyLink & { fiscalYear: PeriodRef | null }>
  accounts: CombinedLedgerAccount[]
  total: LedgerAmounts
  /** The account asked for, with its lines (MAX_LEDGER_LINES at most, the most recent kept). */
  detail: { code: string; lines: CombinedLedgerLine[]; truncated: boolean } | null
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

const amounts = (debitCents: number, creditCents: number): LedgerAmounts => ({ debitCents, creditCents, balanceCents: debitCents - creditCents })

/** Accounts of the companies by number, each company's amounts and the sum. Pure. */
export function combineLedger(lists: ReadonlyArray<{ companyId: string; accounts: ReadonlyArray<{ code: string; label?: string; debitCents: number; creditCents: number }> }>): CombinedLedgerAccount[] {
  const byCode = new Map<string, CombinedLedgerAccount>()
  for (const { companyId, accounts } of lists) {
    for (const a of accounts) {
      if (a.debitCents === 0 && a.creditCents === 0) continue
      const row = byCode.get(a.code) ?? { code: a.code, label: a.label ?? '', byCompany: {}, total: amounts(0, 0) }
      const own = row.byCompany[companyId] ?? amounts(0, 0)
      row.byCompany[companyId] = amounts(own.debitCents + a.debitCents, own.creditCents + a.creditCents)
      row.total = amounts(row.total.debitCents + a.debitCents, row.total.creditCents + a.creditCents)
      byCode.set(a.code, row)
    }
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))
}

export async function getGroupLedger(holdingId: string, query: GroupLedgerQuery, access: GroupAccess): Promise<GroupLedgerReport> {
  const fy = await resolveHoldingFiscalYear(holdingId, query.fiscalYearId)
  const read = await readGroupMembers(holdingId, access, async (ref) => {
    const year = await matchFiscalYear(ref.id, fy.startDate, fy.endDate)
    if (!year) return { year: null, accounts: [], lines: [] }
    const accounts = (await loadStatementAccounts(ref.id, year)).filter((a) => !query.prefix || a.code.startsWith(query.prefix))
    const lines = query.account
      ? await prisma.entryLine.findMany({
          where: {
            accountFiscalYearId: year.id,
            account: { code: query.account },
            accountingEntry: {
              companyId: ref.id,
              fiscalYearId: year.id,
              status: 'validated',
              journal: { code: { not: CLOSING_JOURNAL.code } },
              OR: [{ reference: null }, { NOT: { reference: { startsWith: 'CL-' } } }],
            },
          },
          select: {
            id: true,
            debit: true,
            credit: true,
            description: true,
            accountingEntry: { select: { date: true, entryNumber: true, description: true, journal: { select: { code: true } } } },
          },
          orderBy: [{ accountingEntry: { date: 'desc' } }, { id: 'desc' }],
          take: MAX_LEDGER_LINES + 1,
        })
      : []
    return { year, accounts, lines }
    // The lines of an account need entries:read in each company, like its Écritures d'un compte page (KLEDG-R3-AUTHZ-08);
    // the balances alone need reports:read, like its Grand livre.
  }, query.account ? GROUP_ENTRIES_READ : undefined)

  const accounts = combineLedger(read.members.map((m) => ({ companyId: m.ref.id, accounts: m.value.accounts })))
  let detail: GroupLedgerReport['detail'] = null
  if (query.account) {
    const all = read.members
      .flatMap((m) =>
        m.value.lines.map((l) => ({
          companyId: m.ref.id,
          date: calendarDayOf(l.accountingEntry.date) as string,
          journal: l.accountingEntry.journal.code,
          entryNumber: l.accountingEntry.entryNumber,
          label: l.description || l.accountingEntry.description,
          debitCents: parseCents(l.debit) ?? 0,
          creditCents: parseCents(l.credit) ?? 0,
        })),
      )
      .sort((a, b) => b.date.localeCompare(a.date) || a.entryNumber.localeCompare(b.entryNumber))
    detail = { code: query.account, lines: all.slice(0, MAX_LEDGER_LINES), truncated: all.length > MAX_LEDGER_LINES }
  }
  const warnings = perimeterWarnings(read.unreachable.length, read.truncated)
  for (const m of read.members) if (!m.value.year) warnings.push(`${m.ref.name} n’a pas d’exercice qui couvre cette période : ses comptes ne sont pas additionnés.`)
  return {
    holding: { id: read.holding.id, name: read.holding.name },
    fiscalYear: periodRef(fy),
    notice: GROUP_LEDGER_NOTICE,
    companies: read.members.map((m) => ({ ...linkOf(m.ref), fiscalYear: m.value.year ? periodRef(m.value.year) : null })),
    accounts,
    total: accounts.reduce((t, a) => amounts(t.debitCents + a.total.debitCents, t.creditCents + a.total.creditCents), amounts(0, 0)),
    detail,
    unreachable: read.unreachable,
    truncated: read.truncated,
    warnings,
  }
}
