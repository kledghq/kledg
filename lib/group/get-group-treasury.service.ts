/**
 * Trésorerie of the group space (docs/vue-groupe.md):
 * - the bank accounts of every company read, with the balance the bank last
 *   reported (bank_accounts.balance, kept by the syncs), per company and
 *   added up by currency;
 * - the books' cash (512) at the end of each month of the holding's fiscal
 *   year, per company and summed (the same series as the vue combinée);
 * - the current accounts and loans between the companies of the group
 *   (451, 455, 267, 168), each side as booked, paired with its counterpart
 *   when both companies are read, and the gap when they disagree.
 *
 * Accounts superseded by a direct connection (same IBAN) are left out, as on
 * each company's bank page. The IBAN is shown masked: four last characters.
 */

import { prisma } from '@/lib/prisma'
import type { GroupAccess } from '@/lib/management-fees/access'
import { getDashboardWindow } from '@/lib/reports/dashboard'
import { ledgerCashByMonth } from '@/lib/dashboard/ledger-cash'
import { compactIban } from '@/lib/banking/iban'
import { toCents } from '@/lib/utils/money'
import { computeEliminations, type BalancePair, type IntragroupObservation } from './combine'
import { periodRef, resolveHoldingFiscalYear, type GroupViewQuery, type PeriodRef } from './get-group-view.service'
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink } from './members'
import { readIfAllowed, type UnreachableSubsidiary } from './perimeter'
import { matchFiscalYear, readBalanceObservations } from './read-member'

export interface GroupBankAccount {
  id: string
  companyId: string
  name: string
  /** "FR76 •••• 1234": enough to recognise the account, never the full number. */
  maskedIban: string | null
  provider: string
  currency: string
  balanceCents: number
  lastSyncedAt: string | null
}

export interface TreasuryCompany {
  company: GroupCompanyLink
  accounts: GroupBankAccount[]
  /** Bank balances in euros, added up. */
  bankEurCents: number
  /** Balance of the 512 accounts at the end of the last month shown, null without a fiscal year on the period. */
  ledgerCents: number | null
}

export interface TreasuryMonth {
  month: string
  byCompany: Record<string, number>
  totalCents: number
}

export interface GroupTreasuryReport {
  holding: { id: string; name: string }
  fiscalYear: PeriodRef
  companies: TreasuryCompany[]
  /** Bank balances added up per currency ("EUR" first). */
  totalsByCurrency: Array<{ currency: string; balanceCents: number }>
  ledgerTotalCents: number
  months: TreasuryMonth[]
  /** Current accounts and loans between two companies read: receivable, payable, gap. */
  currentAccounts: BalancePair[]
  /** Every current account or loan line found, including those with a company not read. */
  currentAccountLines: IntragroupObservation[]
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

export function maskIban(iban: string | null): string | null {
  if (!iban) return null
  const compact = compactIban(iban)
  if (compact.length < 8) return null
  return `${compact.slice(0, 4)} •••• ${compact.slice(-4)}`
}

/** Bank balances added up by currency, euros first. */
export function totalsByCurrency(accounts: ReadonlyArray<Pick<GroupBankAccount, 'currency' | 'balanceCents'>>): Array<{ currency: string; balanceCents: number }> {
  const totals = new Map<string, number>()
  for (const a of accounts) totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balanceCents)
  return [...totals.entries()]
    .map(([currency, balanceCents]) => ({ currency, balanceCents }))
    .sort((a, b) => (a.currency === 'EUR' ? -1 : b.currency === 'EUR' ? 1 : a.currency.localeCompare(b.currency)))
}

const CURRENT_ACCOUNT_CATEGORIES = new Set(['current_account', 'loan'])

export async function getGroupTreasury(holdingId: string, query: GroupViewQuery, access: GroupAccess): Promise<GroupTreasuryReport> {
  const fy = await resolveHoldingFiscalYear(holdingId, query.fiscalYearId)
  const window = getDashboardWindow(fy, 12)
  const read = await readGroupMembers(holdingId, access, async (ref) => {
    const [accounts, year] = await Promise.all([
      prisma.bankAccount.findMany({
        where: { bankConnection: { companyId: ref.id }, supersededById: null },
        // Never the connection's credentials: the provider only.
        select: { id: true, name: true, displayName: true, iban: true, currency: true, balance: true, lastSyncedAt: true, bankConnection: { select: { provider: true } } },
        orderBy: { name: 'asc' },
        take: 100,
      }),
      matchFiscalYear(ref.id, fy.startDate, fy.endDate),
    ])
    const cash = year ? await ledgerCashByMonth({ companyId: ref.id, fiscalYearId: year.id, months: window.months }) : null
    return { accounts, year, cash }
  })
  const refs = read.members.map((m) => m.ref)
  // Current accounts and loans, in each company's own scope again, now that the group is known.
  const observations: IntragroupObservation[] = []
  for (const m of read.members) {
    if (!m.value.year) continue
    const year = m.value.year
    // The same check again: the access may have changed since the first read.
    const result = await readIfAllowed(access, m.ref.id, () => readBalanceObservations(m.ref.id, year.id, refs))
    if (result.ok) observations.push(...result.value.filter((o) => CURRENT_ACCOUNT_CATEGORIES.has(o.category)))
  }

  const companies: TreasuryCompany[] = read.members.map(({ ref, value }) => {
    const accounts: GroupBankAccount[] = value.accounts.map((a) => ({
      id: a.id,
      companyId: ref.id,
      name: a.displayName || a.name,
      maskedIban: maskIban(a.iban),
      provider: a.bankConnection.provider,
      currency: a.currency,
      balanceCents: toCents(a.balance) ?? 0,
      lastSyncedAt: a.lastSyncedAt ? a.lastSyncedAt.toISOString() : null,
    }))
    return {
      company: linkOf(ref),
      accounts,
      bankEurCents: accounts.filter((a) => a.currency === 'EUR').reduce((s, a) => s + a.balanceCents, 0),
      ledgerCents: value.cash ? (value.cash.points.at(-1)?.balanceCents ?? value.cash.openingCents) : null,
    }
  })
  const months: TreasuryMonth[] = window.months.map(({ year, month }, i) => {
    const byCompany: Record<string, number> = {}
    for (const m of read.members) if (m.value.cash) byCompany[m.ref.id] = m.value.cash.points[i]?.balanceCents ?? 0
    return { month: `${year}-${String(month + 1).padStart(2, '0')}`, byCompany, totalCents: Object.values(byCompany).reduce((s, c) => s + c, 0) }
  })
  const perimeter = new Set(read.members.filter((m) => m.value.year).map((m) => m.ref.id))
  const warnings = perimeterWarnings(read.unreachable.length, read.truncated)
  const stale = companies.flatMap((c) => c.accounts).filter((a) => a.lastSyncedAt === null).length
  if (stale > 0) warnings.push('Certains comptes bancaires n’ont jamais été synchronisés : leur solde est celui saisi ou importé, pas celui de la banque.')
  return {
    holding: { id: read.holding.id, name: read.holding.name },
    fiscalYear: periodRef(fy),
    companies,
    totalsByCurrency: totalsByCurrency(companies.flatMap((c) => c.accounts)),
    ledgerTotalCents: companies.reduce((s, c) => s + (c.ledgerCents ?? 0), 0),
    months,
    currentAccounts: computeEliminations(observations, perimeter).balances,
    currentAccountLines: observations,
    unreachable: read.unreachable,
    truncated: read.truncated,
    warnings,
  }
}
