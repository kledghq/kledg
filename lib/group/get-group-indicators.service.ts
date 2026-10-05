/**
 * Financial indicators of every company of the group, N and N-1, and of the
 * group as an aggregate (Comparaison and Ratios of the group space,
 * docs/vue-groupe.md).
 *
 * Per company: the same computation as its own page SIG et ratios
 * (lib/reports/financial-indicators), on the fiscal year matched to the
 * holding's (periods.ts) and the one before it. Aggregate: the same rules on
 * the account totals and VAT flows of the companies read, added up by
 * account (aggregate.ts), over the holding's days. Intragroup flows are not
 * eliminated in the aggregate: it says so.
 */

import { prisma } from '@/lib/prisma'
import type { GroupAccess } from '@/lib/management-fees/access'
import { computeFinancialIndicators, type FinancialIndicators, type VatFlows } from '@/lib/reports/financial-indicators/indicators'
import { indicatorDays, loadIndicatorInputs, referenceDay } from '@/lib/reports/financial-indicators/get-financial-indicators.service'
import type { AccountTotals } from '@/lib/reports/statements/allocation'
import { todayUtc } from '@/lib/utils/date'
import { aggregateAccountTotals, sumVatFlows } from './aggregate'
import { periodRef, resolveHoldingFiscalYear, type GroupViewQuery, type PeriodRef } from './get-group-view.service'
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink } from './members'
import type { UnreachableSubsidiary } from './perimeter'
import { samePeriod } from './periods'
import { matchFiscalYear, type MemberFiscalYear } from './read-member'

export const AGGREGATE_NOTICE =
  'Agrégat du groupe : comptes des sociétés lues additionnés à 100 %, flux intragroupe non éliminés. Ce ne sont pas des comptes consolidés.'

export interface MemberIndicators {
  company: GroupCompanyLink
  fiscalYear: PeriodRef | null
  previousFiscalYear: PeriodRef | null
  samePeriod: boolean
  current: FinancialIndicators | null
  previous: FinancialIndicators | null
}

export interface GroupIndicatorsReport {
  holding: { id: string; name: string }
  fiscalYear: PeriodRef
  members: MemberIndicators[]
  /** The aggregate of the companies with a fiscal year on the period (N), and of those with one before it (N-1). */
  combined: { current: FinancialIndicators | null; previous: FinancialIndicators | null }
  notice: string
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

interface YearInputs {
  accounts: AccountTotals[]
  vat: VatFlows
  indicators: FinancialIndicators
}

async function inputsOf(companyId: string, year: MemberFiscalYear, asOf: Date): Promise<YearInputs> {
  const { accounts, vat } = await loadIndicatorInputs(companyId, year)
  return { accounts, vat, indicators: computeFinancialIndicators({ accounts, vat, days: indicatorDays(year, asOf) }) }
}

/** The indicators of the sum of the inputs, over `days`; null without any input. */
export function aggregateIndicators(inputs: ReadonlyArray<{ accounts: readonly AccountTotals[]; vat: VatFlows }>, days: number): FinancialIndicators | null {
  if (inputs.length === 0) return null
  return computeFinancialIndicators({ accounts: aggregateAccountTotals(inputs.map((i) => i.accounts)), vat: sumVatFlows(inputs.map((i) => i.vat)), days })
}

export async function getGroupIndicators(holdingId: string, query: GroupViewQuery, access: GroupAccess, now: Date = new Date()): Promise<GroupIndicatorsReport> {
  const fy = await resolveHoldingFiscalYear(holdingId, query.fiscalYearId)
  const read = await readGroupMembers(holdingId, access, async (ref) => {
    const year = await matchFiscalYear(ref.id, fy.startDate, fy.endDate)
    if (!year) return { year: null, previousYear: null, current: null, previous: null }
    const before = await prisma.fiscalYear.findFirst({
      where: { companyId: ref.id, startDate: { lt: year.startDate } },
      orderBy: { startDate: 'desc' },
      select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
    })
    const [current, previous] = await Promise.all([
      inputsOf(ref.id, year, referenceDay(year, now)),
      before ? inputsOf(ref.id, before, todayUtc(before.endDate)) : Promise.resolve(null),
    ])
    return { year, previousYear: before, current, previous }
  })

  const members: MemberIndicators[] = read.members.map(({ ref, value }) => ({
    company: linkOf(ref),
    fiscalYear: value.year ? periodRef(value.year) : null,
    previousFiscalYear: value.previousYear ? periodRef(value.previousYear) : null,
    samePeriod: value.year ? samePeriod(value.year, fy.startDate, fy.endDate) : false,
    current: value.current?.indicators ?? null,
    previous: value.previous?.indicators ?? null,
  }))
  const currents = read.members.flatMap((m) => (m.value.current ? [m.value.current] : []))
  const previous = read.members.flatMap((m) => (m.value.previous ? [m.value.previous] : []))
  const daysNow = indicatorDays(fy, referenceDay(fy, now))
  const previousDays = previous.length > 0 ? Math.max(...previous.map((p) => p.indicators.delais.days)) : 1

  const warnings = perimeterWarnings(read.unreachable.length, read.truncated)
  for (const m of members) {
    if (!m.fiscalYear) warnings.push(`${m.company.name} n’a pas d’exercice qui couvre cette période : elle n’est pas dans l’agrégat.`)
    else if (!m.samePeriod) warnings.push(`${m.company.name} : l’exercice lu n’a pas les dates de celui de la holding. Ses chiffres sont additionnés tels quels.`)
  }

  return {
    holding: { id: read.holding.id, name: read.holding.name },
    fiscalYear: periodRef(fy),
    members,
    combined: { current: aggregateIndicators(currents, daysNow), previous: aggregateIndicators(previous, previousDays) },
    notice: AGGREGATE_NOTICE,
    unreachable: read.unreachable,
    truncated: read.truncated,
    warnings,
  }
}
