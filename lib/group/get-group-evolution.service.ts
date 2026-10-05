/**
 * Évolution of the group space (docs/vue-groupe.md): month by month over the
 * holding's fiscal year, the produits (class 7), charges (class 6), result
 * and cash (512 at the end of the month) of every company read, and their
 * sum. Same sources as each company's dashboard (lib/reports/dashboard.ts
 * monthlyClassTotals, lib/dashboard/ledger-cash.ts): validated entries,
 * closing entries excluded, cents.
 *
 * Produits and charges are read by calendar month, whatever the fiscal year
 * of the company; the cash needs the fiscal year matched to the holding's
 * (null for a company without one). An aggregate: the flows between the
 * companies are in both.
 */

import type { GroupAccess } from '@/lib/management-fees/access'
import { ledgerCashByMonth } from '@/lib/dashboard/ledger-cash'
import { getDashboardWindow, monthlyClassTotals } from '@/lib/reports/dashboard'
import { periodRef, resolveHoldingFiscalYear, type GroupViewQuery, type PeriodRef } from './get-group-view.service'
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink } from './members'
import type { UnreachableSubsidiary } from './perimeter'
import { matchFiscalYear } from './read-member'

export interface MonthFigures {
  produitsCents: number
  chargesCents: number
  resultatCents: number
  /** Balance of the 512 accounts at the end of the month; null without a fiscal year on the period. */
  tresorerieCents: number | null
}

export interface EvolutionMonth {
  /** Calendar month, "2026-03". */
  month: string
  byCompany: Record<string, MonthFigures>
  total: MonthFigures
}

export interface GroupEvolutionReport {
  holding: { id: string; name: string }
  fiscalYear: PeriodRef
  companies: GroupCompanyLink[]
  months: EvolutionMonth[]
  /** Sum over the months shown. */
  totals: { byCompany: Record<string, Omit<MonthFigures, 'tresorerieCents'>>; total: Omit<MonthFigures, 'tresorerieCents'> }
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

/** Sum of the figures of the companies for one month; the cash of the companies that have one. */
export function sumMonth(list: ReadonlyArray<MonthFigures>): MonthFigures {
  const withCash = list.filter((f) => f.tresorerieCents !== null)
  return {
    produitsCents: list.reduce((s, f) => s + f.produitsCents, 0),
    chargesCents: list.reduce((s, f) => s + f.chargesCents, 0),
    resultatCents: list.reduce((s, f) => s + f.resultatCents, 0),
    tresorerieCents: withCash.length === 0 ? null : withCash.reduce((s, f) => s + (f.tresorerieCents ?? 0), 0),
  }
}

export async function getGroupEvolution(holdingId: string, query: GroupViewQuery, access: GroupAccess): Promise<GroupEvolutionReport> {
  const fy = await resolveHoldingFiscalYear(holdingId, query.fiscalYearId)
  const window = getDashboardWindow(fy, 12)
  const read = await readGroupMembers(holdingId, access, async (ref) => {
    const [totals, year] = await Promise.all([monthlyClassTotals(ref.id, window.start, window.end), matchFiscalYear(ref.id, fy.startDate, fy.endDate)])
    const cash = year ? await ledgerCashByMonth({ companyId: ref.id, fiscalYearId: year.id, months: window.months }) : null
    return window.months.map(({ year: y, month: m }, i): MonthFigures => {
      const t = totals.get(`${y}-${m}`)
      const produitsCents = t?.revenueCents ?? 0
      const chargesCents = t?.expensesCents ?? 0
      return { produitsCents, chargesCents, resultatCents: produitsCents - chargesCents, tresorerieCents: cash ? (cash.points[i]?.balanceCents ?? 0) : null }
    })
  })

  const months: EvolutionMonth[] = window.months.map(({ year, month }, i) => {
    const byCompany: Record<string, MonthFigures> = {}
    for (const m of read.members) byCompany[m.ref.id] = m.value[i]
    return { month: `${year}-${String(month + 1).padStart(2, '0')}`, byCompany, total: sumMonth(Object.values(byCompany)) }
  })
  const flow = (list: ReadonlyArray<MonthFigures>) => {
    const { produitsCents, chargesCents, resultatCents } = sumMonth(list)
    return { produitsCents, chargesCents, resultatCents }
  }
  const byCompany = Object.fromEntries(read.members.map((m) => [m.ref.id, flow(m.value)]))
  return {
    holding: { id: read.holding.id, name: read.holding.name },
    fiscalYear: periodRef(fy),
    companies: read.members.map((m) => linkOf(m.ref)),
    months,
    totals: { byCompany, total: flow(months.map((m) => m.total)) },
    unreachable: read.unreachable,
    truncated: read.truncated,
    warnings: perimeterWarnings(read.unreachable.length, read.truncated),
  }
}
