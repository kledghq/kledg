/**
 * The group view of a holding for one of its fiscal years (vue groupe,
 * docs/vue-groupe.md): the key figures of each company of the group side by
 * side and added up, the intragroup flows found in the books, the combined
 * figures after eliminations, and the group's treasury month by month.
 *
 * An indicative combined view, never consolidated accounts: see combine.ts
 * for what is and is not done. Each company is read in its own scope after
 * the user's access to it was checked (perimeter.ts).
 */

import { z } from 'zod'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { prisma } from '@/lib/prisma'
import type { GroupAccess } from '@/lib/management-fees/access'
import { MAX_GROUP_SUBSIDIARIES } from '@/lib/management-fees/holding'
import { getDashboardWindow, resolveDashboardFiscalYear } from '@/lib/reports/dashboard'
import { FISCAL_YEAR_NOT_FOUND, NO_FISCAL_YEAR } from '@/lib/reports/financial-indicators/get-financial-indicators.service'
import { calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'
import { formatCentsFr } from '@/lib/utils/money'
import { plural } from '@/lib/utils/plural'
import { applyEliminations, computeEliminations, sumFigures, type Eliminations, type IntragroupObservation, type KeyFigures } from './combine'
import { readIfAllowed, resolveGroup, type GroupMemberRef, type UnreachableSubsidiary } from './perimeter'
import { samePeriod } from './periods'
import {
  matchFiscalYear,
  readBalanceObservations,
  readDividendObservations,
  readInvoiceObservations,
  readMemberBooks,
  readPendingManagementFees,
  type MemberBooks,
  type MemberFiscalYear,
} from './read-member'

/** ?fiscalYearId= of the holding; its current fiscal year by default. */
export const GroupViewQuerySchema = z.object({
  fiscalYearId: z.string().max(64).optional(),
})
export type GroupViewQuery = z.infer<typeof GroupViewQuerySchema>

export interface PeriodRef {
  id: string
  year: number
  startDate: string
  endDate: string
}

export interface GroupViewMember {
  id: string
  name: string
  /** For links into the company's own pages. */
  slug: string
  siren: string | null
  role: 'holding' | 'subsidiary'
  /** The holding's stake in basis points (6000 = 60 %), for a subsidiary. */
  ownershipBp: number | null
  /** The fiscal year read, null when none covers the period. */
  fiscalYear: PeriodRef | null
  /** Whether that fiscal year has the holding's exact dates. */
  samePeriod: boolean
  figures: KeyFigures | null
}

export interface TreasuryMonth {
  /** Calendar month, "2026-03". */
  month: string
  totalCents: number
  /** Balance of each company at the end of the month, by company id. */
  byCompany: Record<string, number>
}

export interface GroupView {
  holding: { id: string; name: string }
  fiscalYear: PeriodRef
  members: GroupViewMember[]
  unreachable: UnreachableSubsidiary[]
  /** Subsidiaries beyond the limit of the view, not read. */
  truncated: number
  combined: KeyFigures
  eliminations: Eliminations
  afterEliminations: KeyFigures
  /** Every intragroup line found, eliminated or not (inBooks false: not in the validated books yet). */
  flows: IntragroupObservation[]
  treasury: TreasuryMonth[]
  /** Titres de participation (261) of the holding, left in the combined assets (no elimination against equity). */
  titresParticipationCents: number
  warnings: string[]
}

export async function resolveHoldingFiscalYear(holdingId: string, fiscalYearId: string | undefined) {
  if (fiscalYearId) {
    const named = await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId: holdingId } })
    if (!named) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
    return named
  }
  const fy = await resolveDashboardFiscalYear(holdingId, null)
  if (!fy) throw new ValidationError(NO_FISCAL_YEAR)
  return fy
}

export function periodRef(fy: MemberFiscalYear): PeriodRef {
  return { id: fy.id, year: fy.year, startDate: calendarDayOf(fy.startDate) as string, endDate: calendarDayOf(fy.endDate) as string }
}

interface MemberRead {
  ref: GroupMemberRef
  books: MemberBooks | null
  observations: IntragroupObservation[]
}

export async function getGroupView(holdingId: string, query: GroupViewQuery, access: GroupAccess): Promise<GroupView> {
  const fy = await resolveHoldingFiscalYear(holdingId, query.fiscalYearId)
  const perimeter = await resolveGroup(holdingId, access)
  const months = getDashboardWindow(fy, 12).months
  const refs = [perimeter.holding, ...perimeter.subsidiaries]

  const reads: MemberRead[] = []
  const unreachable = [...perimeter.unreachable]
  for (const ref of refs) {
    // The holding was checked by the route; the subsidiaries again here, in case an access changed meanwhile.
    const read = await readIfAllowed(access, ref.id, async (): Promise<MemberRead> => {
      const year = await matchFiscalYear(ref.id, fy.startDate, fy.endDate)
      if (!year) return { ref, books: null, observations: [] }
      const [books, balances, dividends, invoices, pending] = await Promise.all([
        readMemberBooks(ref.id, year, months),
        readBalanceObservations(ref.id, year.id, refs),
        readDividendObservations(ref.id, year.id, refs),
        readInvoiceObservations(ref.id, year.id, refs),
        ref.role === 'holding' ? readPendingManagementFees(ref.id, year, refs) : Promise.resolve([]),
      ])
      return { ref, books, observations: [...invoices, ...pending, ...dividends, ...balances] }
    })
    if (read.ok) reads.push(read.value)
    else unreachable.push(read.unreachable)
  }

  const members: GroupViewMember[] = reads.map(({ ref, books }) => ({
    id: ref.id,
    name: ref.name,
    slug: ref.slug,
    siren: ref.siren,
    role: ref.role,
    ownershipBp: ref.stake?.percentBp ?? null,
    fiscalYear: books ? periodRef(books.fiscalYear) : null,
    samePeriod: books ? samePeriod(books.fiscalYear, fy.startDate, fy.endDate) : false,
    figures: books?.figures ?? null,
  }))
  const withBooks = reads.filter((r): r is MemberRead & { books: MemberBooks } => r.books !== null)
  const perimeterIds = new Set(withBooks.map((r) => r.ref.id))
  const flows = reads.flatMap((r) => r.observations)
  const combined = sumFigures(withBooks.map((r) => r.books.figures))
  const eliminations = computeEliminations(flows, perimeterIds)

  const treasury: TreasuryMonth[] = months.map(({ year, month }, i) => {
    const byCompany: Record<string, number> = {}
    for (const r of withBooks) byCompany[r.ref.id] = r.books.treasury[i]?.balanceCents ?? 0
    return {
      month: `${year}-${String(month + 1).padStart(2, '0')}`,
      totalCents: Object.values(byCompany).reduce((sum, cents) => sum + cents, 0),
      byCompany,
    }
  })

  const holdingBooks = withBooks.find((r) => r.ref.role === 'holding')?.books
  const titresParticipationCents = holdingBooks
    ? holdingBooks.accounts.filter((a) => a.code.startsWith('261')).reduce((sum, a) => sum + a.debitCents - a.creditCents, 0)
    : 0

  const warnings: string[] = []
  for (const m of members) {
    if (!m.fiscalYear) warnings.push(`${m.name} n’a pas d’exercice qui couvre cette période\u00a0: ses chiffres ne sont pas additionnés.`)
    else if (!m.samePeriod) {
      warnings.push(
        `${m.name}\u00a0: l’exercice lu va du ${formatIsoDateFr(m.fiscalYear.startDate)} au ${formatIsoDateFr(m.fiscalYear.endDate)}, à d’autres dates que celui de la holding. Ses chiffres sont additionnés tels quels.`,
      )
    }
  }
  if (unreachable.length === 1) {
    warnings.push('Une filiale n’est pas lue, faute d’accès\u00a0: ses chiffres et ses flux avec le groupe ne sont pas dans la vue combinée.')
  } else if (unreachable.length > 1) {
    warnings.push(`${unreachable.length} filiales ne sont pas lues, faute d’accès\u00a0: leurs chiffres et leurs flux avec le groupe ne sont pas dans la vue combinée.`)
  }
  if (perimeter.truncated > 0) {
    warnings.push(`${plural(perimeter.truncated, 'autre filiale n’est pas lue', 'autres filiales ne sont pas lues')}\u00a0: la vue groupe lit au plus ${MAX_GROUP_SUBSIDIARIES} filiales.`)
  }
  const gaps = eliminations.operations.filter((p) => p.gapCents !== 0).length + eliminations.balances.filter((b) => b.gapCents !== 0).length
  if (gaps > 0) {
    warnings.push(
      `${plural(gaps, 'flux intragroupe n’est pas enregistré', 'flux intragroupe ne sont pas enregistrés')} pour le même montant par les deux sociétés\u00a0: voyez les écarts dans les flux intragroupe.`,
    )
  }
  if (titresParticipationCents !== 0) {
    warnings.push(
      `Les titres de participation de la holding (${formatCentsFr(titresParticipationCents)}) restent à l’actif de la vue combinée\u00a0: ils ne sont pas éliminés contre les capitaux propres des filiales, comme le ferait une consolidation.`,
    )
  }

  return {
    holding: { id: perimeter.holding.id, name: perimeter.holding.name },
    fiscalYear: periodRef(fy),
    members,
    unreachable,
    truncated: perimeter.truncated,
    combined,
    eliminations,
    afterEliminations: applyEliminations(combined, eliminations.effect),
    flows,
    treasury,
    titresParticipationCents,
    warnings,
  }
}
