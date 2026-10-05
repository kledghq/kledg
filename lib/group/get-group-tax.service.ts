/**
 * Fiscalité of the group space (docs/vue-groupe.md): the impôt sur les
 * sociétés of each company read, as its own worksheet computes it
 * (lib/corporate-tax, buildCorporateTax, with the user's rights for the
 * dividends of its subsidiaries), the régime mère-fille between the
 * companies of the group, and the simulation of an intégration fiscale
 * (tax-integration.ts).
 *
 * Each company is read in its own row level security scope after the
 * access check (perimeter.ts): a subsidiary not read is counted, never
 * read nor named, and stays out of the simulation, which says so.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import type { GroupAccess } from '@/lib/management-fees/access'
import { buildCorporateTax, type CorporateTaxView } from '@/lib/corporate-tax/load-corporate-tax.service'
import { PARENT_SUBSIDIARY_MIN_STAKE_BP } from '@/lib/corporate-tax/rules'
import { centsField } from '@/lib/api/zod-fields'
import { GroupViewQuerySchema, periodRef, resolveHoldingFiscalYear, type PeriodRef } from './get-group-view.service'
import { linkOf, perimeterWarnings, type GroupCompanyLink } from './members'
import { readIfAllowed, resolveGroup, type UnreachableSubsidiary } from './perimeter'
import { percentToBp } from './periods'
import { matchFiscalYear, readDividendObservations, readInvoiceObservations } from './read-member'
import { MANUAL_NEUTRALISATIONS, simulateTaxIntegration, type IntegrationCompanyInput, type IntegrationInput, type IntegrationSimulation, type ManualNeutralisationId } from './tax-integration'

const manualField = z.coerce.number({ error: 'Montant invalide' }).int({ error: 'Montant en centimes attendu' }).pipe(centsField()).optional()

/** ?fiscalYearId= and the amounts typed for the retraitements the books cannot show (cents, signed). */
export const GroupTaxQuerySchema = GroupViewQuerySchema.extend({
  provisions: manualField,
  asset_sales: manualField,
  waivers: manualField,
  financial_charges: manualField,
  other: manualField,
})
export type GroupTaxQuery = z.infer<typeof GroupTaxQuerySchema>

export interface GroupCompanyTax {
  company: GroupCompanyLink
  status: CorporateTaxView['status']
  regime: CorporateTaxView['regime']
  fiscalYear: PeriodRef | null
  /** Tax result before deficits (its worksheet), null without one. */
  resultBeforeDeficitsCents: number | null
  deficitsImputedCents: number | null
  taxableProfitCents: number | null
  corporateTaxCents: number | null
  reducedRateApplied: boolean | null
  socialContributionCents: number | null
  /** IS + contribution sociale - credits. */
  totalCents: number | null
  /** Positive: to pay with the relevé de solde; negative: to claim back. */
  balanceCents: number | null
  balanceDue: string | null
  /** The worksheet's checks all pass. */
  reliable: boolean
  checksToReview: number
}

export interface ParentSubsidiaryRow {
  parent: GroupCompanyLink
  subsidiary: GroupCompanyLink
  stakeBp: number
  /** 5 % of the capital at least (CGI art. 145). */
  eligible: boolean
  /** Dividends the parent recorded from it over the year (761). */
  dividendsCents: number
  /** Whether the parent's worksheet deducted them under the régime mère-fille. */
  applied: boolean
}

export interface GroupTaxReport {
  holding: { id: string; name: string }
  fiscalYear: PeriodRef
  companies: GroupCompanyTax[]
  parentSubsidiary: ParentSubsidiaryRow[]
  integration: IntegrationSimulation
  /** What the simulation started from, so the page can add typed retraitements without reloading. */
  integrationInput: IntegrationInput
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

interface CompanyRead {
  view: CorporateTaxView | null
  year: PeriodRef | null
  holders: Array<{ holderId: string; bp: number }>
  dividends: Array<{ payerId: string; cents: number }>
  fees: Array<{ buyerId: string; cents: number; charge: boolean }>
}

export async function getGroupTax(holdingId: string, query: GroupTaxQuery, access: GroupAccess, now?: Date): Promise<GroupTaxReport> {
  const fy = await resolveHoldingFiscalYear(holdingId, query.fiscalYearId)
  const perimeter = await resolveGroup(holdingId, access)
  const refs = [perimeter.holding, ...perimeter.subsidiaries]
  const readIds = new Set(refs.map((r) => r.id))
  const unreachable = [...perimeter.unreachable]
  const reads: Array<{ ref: (typeof refs)[number]; value: CompanyRead }> = []
  let holdingShareholders: Array<{ type: string; companyShareholderId: string | null; bp: number }> = []

  for (const ref of refs) {
    const read = await readIfAllowed(access, ref.id, async (): Promise<CompanyRead> => {
      const [year, shareholders] = await Promise.all([
        matchFiscalYear(ref.id, fy.startDate, fy.endDate),
        prisma.shareholder.findMany({ where: { companyId: ref.id }, select: { type: true, companyShareholderId: true, sharePercentage: true }, take: 500 }),
      ])
      if (ref.role === 'holding') holdingShareholders = shareholders.map((s) => ({ type: s.type, companyShareholderId: s.companyShareholderId, bp: percentToBp(s.sharePercentage.toString()) }))
      const holders = shareholders.flatMap((s) => (s.companyShareholderId && readIds.has(s.companyShareholderId) ? [{ holderId: s.companyShareholderId, bp: percentToBp(s.sharePercentage.toString()) }] : []))
      if (!year) return { view: null, year: null, holders, dividends: [], fees: [] }
      const [built, dividends, invoices] = await Promise.all([
        buildCorporateTax(ref.id, { fiscalYearId: year.id }, { access, now }),
        readDividendObservations(ref.id, year.id, refs),
        readInvoiceObservations(ref.id, year.id, refs),
      ])
      return {
        view: built.view,
        year: periodRef(year),
        holders,
        dividends: dividends.map((d) => ({ payerId: d.counterpartyId, cents: d.cents })),
        fees: invoices.filter((o) => o.category === 'management_fee').map((o) => ({ buyerId: o.counterpartyId, cents: o.cents, charge: o.accountCode.startsWith('6') })),
      }
    })
    if (read.ok) reads.push({ ref, value: read.value })
    else unreachable.push(read.unreachable)
  }

  const linkById = new Map(reads.map((r) => [r.ref.id, linkOf(r.ref)]))
  const companies: GroupCompanyTax[] = reads.map(({ ref, value }) => {
    const c = value.view?.computation ?? null
    return {
      company: linkOf(ref),
      status: value.view?.status ?? 'no-fiscal-year',
      regime: value.view?.regime ?? null,
      fiscalYear: value.year,
      resultBeforeDeficitsCents: c?.resultBeforeDeficitsCents ?? null,
      deficitsImputedCents: c?.deficits.imputedCents ?? null,
      taxableProfitCents: c?.taxableProfitCents ?? null,
      corporateTaxCents: c?.corporateTaxCents ?? null,
      reducedRateApplied: c ? c.reducedRate.applied : null,
      socialContributionCents: c?.socialContribution.cents ?? null,
      totalCents: c?.totalCents ?? null,
      balanceCents: value.view?.balance?.balanceCents ?? null,
      balanceDue: value.view?.balance?.deadline?.date ?? null,
      reliable: value.view?.reliable ?? false,
      checksToReview: value.view?.checks.filter((x) => x.severity === 'blocking' || x.severity === 'warning').length ?? 0,
    }
  })

  // Régime mère-fille between the companies read (CGI art. 145: 5 % of the capital).
  const parentSubsidiary: ParentSubsidiaryRow[] = []
  for (const { ref, value } of reads) {
    const byHolder = new Map<string, number>()
    for (const h of value.holders) byHolder.set(h.holderId, (byHolder.get(h.holderId) ?? 0) + h.bp)
    for (const [holderId, stakeBp] of byHolder) {
      const parentRead = reads.find((r) => r.ref.id === holderId)
      if (!parentRead) continue
      const dividendsCents = parentRead.value.dividends.filter((d) => d.payerId === ref.id).reduce((s, d) => s + d.cents, 0)
      parentSubsidiary.push({
        parent: linkById.get(holderId)!,
        subsidiary: linkOf(ref),
        stakeBp,
        eligible: stakeBp >= PARENT_SUBSIDIARY_MIN_STAKE_BP,
        dividendsCents,
        applied: (parentRead.value.view?.parentSubsidiary ?? []).some((q) => q.subsidiaryId === ref.id),
      })
    }
  }

  // The simulation's input, from the same worksheets.
  const integrationCompanies: IntegrationCompanyInput[] = reads.map(({ ref, value }) => {
    const v = value.view
    const c = v?.computation ?? null
    return {
      id: ref.id,
      name: ref.name,
      role: ref.role,
      status: v?.status ?? 'no-fiscal-year',
      fiscalYear: value.year && v?.duration ? { startDate: value.year.startDate, endDate: value.year.endDate, months: v.duration.months } : value.year ? { startDate: value.year.startDate, endDate: value.year.endDate, months: null } : null,
      resultBeforeDeficitsCents: c?.resultBeforeDeficitsCents ?? 0,
      deficitsOpeningCents: c ? (c.deficits.known ? c.deficits.openingCents : null) : null,
      turnoverCents: c?.eligibility.turnoverAnnualCents ?? 0,
      separateTaxCents: c?.corporateTaxCents ?? 0,
      separateSocialCents: c?.socialContribution.cents ?? 0,
      capitalPaidUp: v?.answers.capitalPaidUp.value ?? null,
      naturalPersons75: v?.answers.naturalPersons75.value ?? null,
    }
  })
  const totalBp = holdingShareholders.reduce((s, h) => s + h.bp, 0)
  const companyHolds95 = holdingShareholders.some((h) => h.type !== 'PHYSICAL' && h.bp >= 9_500)
  const fees = new Map<string, { sellerId: string; buyerId: string; revenueCents: number; chargeCents: number }>()
  for (const { ref, value } of reads) {
    for (const f of value.fees) {
      const sellerId = f.charge ? f.buyerId : ref.id
      const buyerId = f.charge ? ref.id : f.buyerId
      const key = `${sellerId}\u0000${buyerId}`
      const row = fees.get(key) ?? { sellerId, buyerId, revenueCents: 0, chargeCents: 0 }
      if (f.charge) row.chargeCents += f.cents
      else row.revenueCents += f.cents
      fees.set(key, row)
    }
  }
  const manual: IntegrationInput['manual'] = {}
  for (const m of MANUAL_NEUTRALISATIONS) {
    const value = query[m.id as ManualNeutralisationId]
    if (value !== undefined) manual[m.id] = value
  }
  const integrationInput: IntegrationInput = {
    holdingId,
    companies: integrationCompanies,
    holdings: reads.flatMap(({ ref, value }) => value.holders.map((h) => ({ holderId: h.holderId, companyId: ref.id, bp: h.bp }))),
    parentHeldByCompany: companyHolds95 ? true : totalBp === 10_000 ? false : null,
    dividends: reads.flatMap(({ ref, value }) =>
      value.dividends.map((d) => ({
        receiverId: ref.id,
        payerId: d.payerId,
        cents: d.cents,
        parentRegime: (value.view?.parentSubsidiary ?? []).some((q) => q.subsidiaryId === d.payerId),
      })),
    ),
    managementFees: [...fees.values()],
    manual,
    unreachable: unreachable.length + perimeter.truncated,
  }

  const warnings = perimeterWarnings(unreachable.length, perimeter.truncated)
  return {
    holding: { id: perimeter.holding.id, name: perimeter.holding.name },
    fiscalYear: periodRef(fy),
    companies,
    parentSubsidiary,
    integration: simulateTaxIntegration(integrationInput),
    integrationInput,
    unreachable,
    truncated: perimeter.truncated,
    warnings,
  }
}
