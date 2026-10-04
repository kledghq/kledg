/**
 * The fee of each subsidiary of a convention for a period, from the books:
 * the holding's pooled charges (cost plus) or the fixed amount, the
 * subsidiaries' revenue (REVENUE key), then the pricing engine
 * (lib/management-fees/compute.ts). Used by the preview route, the invoice
 * generation and the MCP tool, so the three agree to the cent.
 *
 * Reads only. The holding's ledger is read in the request's scope (the
 * holding); each subsidiary is read in its own scope after checking the
 * user's reports:read there (lib/management-fees/access.ts).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ValidationError } from '@/lib/accounting/errors'
import { dayToDate } from '@/lib/accounting/entry-date'
import { calendarDay } from '@/lib/api/zod-fields'
import { calendarDayOf, formatIsoDateFr, isoDateToUtc, utcDaysInclusive } from '@/lib/utils/date'
import { inCompany, type GroupAccess } from './access'
import { computeManagementFees, eligibleDays, type ComputeResult, type ComputeSubsidiary } from './compute'
import { assertSubsidiaryOf } from './holding'
import { loadCostPool, loadRevenue, type CostPool } from './ledger'
import { loadConvention, type Convention } from './manage-conventions.service'
import { formatRateBp, USUAL_MARKUP_RANGE_BP } from './rules'

/** A period of at most a year and a day: fees are invoiced monthly, quarterly or yearly. */
const MAX_PERIOD_DAYS = 366

/** ?periodStart=&periodEnd= (ISO days). */
export const PeriodQuerySchema = z.object({
  periodStart: calendarDay('Date de début de période invalide'),
  periodEnd: calendarDay('Date de fin de période invalide'),
})
export type PeriodQuery = z.infer<typeof PeriodQuerySchema>

export interface SubsidiaryIdentity {
  id: string
  name: string
  siren: string
  vatNumber: string | null
}

export interface ManagementFeeComputation {
  convention: Convention
  period: { start: string; end: string; days: number }
  /** Null for a fixed amount. */
  costPool: CostPool | null
  result: ComputeResult
  subsidiaries: SubsidiaryIdentity[]
  /** Points the user should check before invoicing (French). */
  warnings: string[]
  /** Billings of the convention whose period overlaps this one. */
  billed: Array<{ subsidiaryId: string; periodStart: string; periodEnd: string; salesInvoiceNumber: string | null }>
}

function assertPeriod(convention: Convention, period: PeriodQuery): number {
  const { periodStart: start, periodEnd: end } = period
  if (end < start) throw new ValidationError('La fin de la période ne peut pas précéder son début.')
  const days = utcDaysInclusive(isoDateToUtc(start), isoDateToUtc(end))
  if (days > MAX_PERIOD_DAYS) throw new ValidationError('Une période de facturation couvre une année au plus.')
  if (start < convention.startDate || (convention.endDate && end > convention.endDate)) {
    throw new ValidationError(
      `La période sort de la durée de la convention (${convention.endDate ? `du ${formatIsoDateFr(convention.startDate)} au ${formatIsoDateFr(convention.endDate)}` : `à partir du ${formatIsoDateFr(convention.startDate)}`}).`,
    )
  }
  return days
}

/** The fee of each subsidiary of the holding's convention over the period. */
export async function computeConventionFees(holdingId: string, conventionId: string, period: PeriodQuery, access: GroupAccess): Promise<ManagementFeeComputation> {
  const convention = await loadConvention(holdingId, conventionId)
  const days = assertPeriod(convention, period)
  const { periodStart: start, periodEnd: end } = period
  const warnings: string[] = []

  const costPool =
    convention.pricing === 'COST_PLUS' ? await loadCostPool(holdingId, start, end, convention.costAccountPrefixes, convention.excludedAccountPrefixes) : null
  if (costPool && costPool.coveredDays < days) {
    warnings.push('Une partie de la période n’est couverte par aucun exercice de la holding : ses charges n’y sont pas comptées.')
  }
  if (convention.pricing === 'COST_PLUS' && (convention.markupBp < USUAL_MARKUP_RANGE_BP.min || convention.markupBp > USUAL_MARKUP_RANGE_BP.max)) {
    warnings.push(
      `Marge de ${formatRateBp(convention.markupBp)} : les services de gestion sont usuellement refacturés avec une marge de 5 à 10 %. Documentez ce taux (prix de pleine concurrence).`,
    )
  }

  const identities: SubsidiaryIdentity[] = []
  const inputs: ComputeSubsidiary[] = []
  for (const party of convention.subsidiaries) {
    const read = await inCompany(access, party.subsidiaryId, { reports: ['read'] }, async () => {
      const subsidiary = await assertSubsidiaryOf(holdingId, party.subsidiaryId)
      const window = eligibleDays(start, end, party.startDate, party.endDate)
      const revenue = convention.allocationKey === 'REVENUE' && window.days > 0 ? await loadRevenue(party.subsidiaryId, window.start, window.end) : null
      return { subsidiary, window, revenue }
    })
    if (read.revenue && read.revenue.coveredDays < read.window.days) {
      warnings.push(`Une partie de la période n’est couverte par aucun exercice de ${read.subsidiary.name} : son chiffre d’affaires y est compté pour zéro.`)
    }
    identities.push(read.subsidiary)
    inputs.push({
      subsidiaryId: party.subsidiaryId,
      name: read.subsidiary.name,
      sharePercentBp: party.sharePercentBp,
      eligibleDays: read.window.days,
      revenueCents: read.revenue?.cents ?? null,
    })
  }

  const result = computeManagementFees({
    pricing: convention.pricing,
    markupBp: convention.markupBp,
    costShareBp: convention.costShareBp,
    fixedAmountCents: convention.fixedAmountCents,
    allocationKey: convention.allocationKey,
    vatRateBp: convention.vatRateBp,
    costPoolCents: costPool?.totalCents ?? 0,
    subsidiaries: inputs,
  })

  const billed = await prisma.managementFeeBilling.findMany({
    where: { companyId: holdingId, conventionId, periodStart: { lte: dayToDate(end) }, periodEnd: { gte: dayToDate(start) } },
    select: { subsidiaryId: true, periodStart: true, periodEnd: true, salesInvoice: { select: { number: true } } },
    orderBy: { periodStart: 'asc' },
    take: 500,
  })

  return {
    convention,
    period: { start, end, days },
    costPool,
    result,
    subsidiaries: identities,
    warnings,
    billed: billed.map((b) => ({
      subsidiaryId: b.subsidiaryId,
      periodStart: calendarDayOf(b.periodStart) as string,
      periodEnd: calendarDayOf(b.periodEnd) as string,
      salesInvoiceNumber: b.salesInvoice?.number ?? null,
    })),
  }
}
