/**
 * The local taxes of a company for a calendar year (docs/impots-locaux.md):
 * the CFE from the avis the user entered (Kledg cannot compute it), its
 * acompte and balance, the expected charge for the budget, the CVAE
 * computed from the value added of the books with the manual adjustments,
 * the plafonnement estimate, the deadlines of both taxes with their status,
 * and the CFE drafts. Kledg prepares; the user pays on impots.gouv.fr.
 *
 * Every query is scoped by the company the caller resolved.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { computeDeadlines } from '@/lib/deadlines/engine'
import { loadDeadlineContext, type CompanyContext } from '@/lib/deadlines/load-deadlines.service'
import { trackDeadlines } from '@/lib/declarations/load-declaration-statuses.service'
import type { TrackedDeadline } from '@/lib/declarations/status'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { cfeMinimumExempt, cfeSchedule, cfeYearSituation, expectedCfeCharge, type CfeAvis, type CfeSchedule, type CfeYearSituation, type ExpectedCfeCharge } from './cfe'
import {
  computeCvae,
  cvaeAcomptes,
  cvaeMaxRateLabel,
  cvaeYearStatus,
  plafonnementEstimate,
  CVAE_DECLARATION_THRESHOLD_CENTS,
  CVAE_PAYMENT_THRESHOLD_CENTS,
  type CvaeComputation,
  type CvaeYearStatus,
} from './cvae'
import { annualize, cvaePeriodOf, type CvaePeriod } from './period'
import { LOCAL_TAX_SOURCES, type LocalTaxSource } from './sources'
import { sumValueAdded, valueAddedFromBooks, type ValueAddedFromBooks } from './value-added'

export const LocalTaxesQuerySchema = z.object({
  year: z.coerce.number({ error: 'Année invalide' }).int('Année invalide').min(2010, 'Année invalide').max(2100, 'Année invalide').optional(),
})
export type LocalTaxesQuery = z.infer<typeof LocalTaxesQuerySchema>

export const CvaeAdjustmentSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().trim().min(1, 'Le libellé est requis').max(200),
  /** Signed: positive adds to the value added, negative deducts. */
  amountCents: z.number().int().min(-100_000_000_000_000).max(100_000_000_000_000),
})
export type CvaeAdjustment = z.infer<typeof CvaeAdjustmentSchema>

/** References of the CFE drafts of a year: "CFE-2026-AC" (acompte), "CFE-2026-SOLDE". */
export const cfeReference = (year: number, kind: 'acompte' | 'solde') => `CFE-${year}-${kind === 'acompte' ? 'AC' : 'SOLDE'}`

export interface DraftState {
  reference: string
  status: 'none' | 'draft' | 'validated'
  entryId: string | null
  entryNumber: string | null
}

export interface CvaeYearView {
  year: number
  status: CvaeYearStatus
  maxRate: string | null
  period: CvaePeriod | null
  books: ValueAddedFromBooks | null
  adjustments: CvaeAdjustment[]
  adjustmentsCents: number
  turnoverAnnualCents: number | null
  computation: CvaeComputation | null
}

export interface LocalTaxesView {
  today: string
  year: number
  /** Years the page offers: from the first fiscal year to next year. */
  years: number[]
  foundationYear: number | null
  settings: Pick<CompanyContext['settings'], 'cfeAcompte' | 'cfeChanges' | 'cvae' | 'cvaeDue' | 'cvaeAcomptes'>
  cfe: {
    situation: CfeYearSituation
    avis: (CfeAvis & { noticeOn: string | null; note: string | null }) | null
    previous: { year: number; totalCents: number } | null
    schedule: CfeSchedule
    expected: ExpectedCfeCharge
    /** Turnover of the reference year (N-2) and whether it exempts from the cotisation minimum (CGI art. 1647 D). */
    minimum: { referenceYear: number; turnoverCents: number | null; exempt: boolean | null }
    drafts: { acompte: DraftState; solde: DraftState }
  }
  cvae: CvaeYearView & {
    previous: { year: number; cvaeCents: number | null } | null
    acomptes: { due: boolean | null; eachCents: number | null }
    /** Settings of the calendar that do not match the turnover: what to switch on or off. */
    hints: string[]
  }
  plafonnement: { rate: number; ceilingCents: number; excessCents: number } | null
  deadlines: TrackedDeadline[]
  sources: LocalTaxSource[]
}

const day = (value: Date) => calendarDayOf(value) as string
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const cents = (value: { toString(): string } | null) => (value === null ? null : parseCents(value.toString()))

function adjustmentsOf(json: unknown): CvaeAdjustment[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((item) => {
    const parsed = CvaeAdjustmentSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

/** The value added parts of the fiscal years of a period, from their validated entries (closing excluded). */
async function booksOf(companyId: string, period: CvaePeriod | null): Promise<ValueAddedFromBooks | null> {
  if (!period) return null
  const parts = await Promise.all(
    period.fiscalYears.map(async (fy) => valueAddedFromBooks(await loadStatementAccounts(companyId, { id: fy.id, startDate: utc(fy.startDate), endDate: utc(fy.endDate) }))),
  )
  return sumValueAdded(parts)
}

async function draftState(companyId: string, reference: string): Promise<DraftState> {
  const entry = await prisma.accountingEntry.findFirst({ where: { companyId, reference }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, entryNumber: true } })
  return { reference, status: entry ? (entry.status === 'validated' ? 'validated' : 'draft') : 'none', entryId: entry?.id ?? null, entryNumber: entry?.entryNumber ?? null }
}

/** The CVAE of a year: the period, the books, the adjustments and the computation. */
async function cvaeYear(companyId: string, context: CompanyContext, year: number, adjustments: CvaeAdjustment[], today: string): Promise<CvaeYearView> {
  const status = cvaeYearStatus(year)
  const period = cvaePeriodOf(year, context.fiscalYears, today)
  const books = status === 'in-force' ? await booksOf(companyId, period) : null
  const adjustmentsCents = adjustments.reduce((sum, a) => sum + a.amountCents, 0)
  const turnoverAnnualCents = books && period ? annualize(books.turnoverCents, period) : null
  const computation =
    books && turnoverAnnualCents !== null
      ? computeCvae({ year, turnoverCents: books.turnoverCents, turnoverAnnualCents, valueAddedCents: books.valueAddedCents + adjustmentsCents })
      : null
  return { year, status, maxRate: cvaeMaxRateLabel(year), period, books, adjustments, adjustmentsCents, turnoverAnnualCents, computation }
}

/** The deadline ids of the local taxes of `year` (the 1330-CVAE and the 1329-DEF of a year are filed the year after). */
function concernsYear(d: TrackedDeadline, year: number): boolean {
  if (d.category !== 'cfe' && d.category !== 'cvae') return false
  return d.id.slice(d.id.indexOf(':') + 1).split(':')[0] === String(year)
}

export async function loadLocalTaxes(companyId: string, query: LocalTaxesQuery, options: { now?: Date } = {}): Promise<LocalTaxesView> {
  const today = day(todayUtc(options.now))
  const currentYear = Number(today.slice(0, 4))
  const year = query.year ?? currentYear
  const context = await loadDeadlineContext(companyId)
  const foundationYear = context.company.foundationDate ? Number(context.company.foundationDate.slice(0, 4)) : null

  const rows = await prisma.localTaxYear.findMany({
    where: { companyId, year: { in: [year - 1, year] } },
    select: { year: true, cfeTotal: true, cfeAcompte: true, cfeNoticeOn: true, cfeNote: true, cvaeAdjustments: true },
    take: 2,
  })
  const row = rows.find((r) => r.year === year) ?? null
  const previousRow = rows.find((r) => r.year === year - 1) ?? null
  const avisOf = (r: (typeof rows)[number] | null): CfeAvis | null => {
    const total = r ? cents(r.cfeTotal) : null
    return r && total !== null ? { totalCents: total, acompteCents: cents(r.cfeAcompte) } : null
  }

  // CFE
  const situation = cfeYearSituation(year, foundationYear)
  const avis = avisOf(row)
  const previousAvis = avisOf(previousRow)
  const schedule = cfeSchedule(avis, previousAvis, situation)
  const expected = expectedCfeCharge(year, avis, previousAvis, situation)

  // CVAE of the year and of the year before (its amount decides the acomptes, art. 1679 septies)
  const [current, previous, reference, drafts] = await Promise.all([
    cvaeYear(companyId, context, year, adjustmentsOf(row?.cvaeAdjustments), today),
    cvaeYearStatus(year - 1) === 'in-force' ? cvaeYear(companyId, context, year - 1, adjustmentsOf(previousRow?.cvaeAdjustments), today) : Promise.resolve(null),
    booksOf(companyId, cvaePeriodOf(year - 2, context.fiscalYears, today)),
    Promise.all([draftState(companyId, cfeReference(year, 'acompte')), draftState(companyId, cfeReference(year, 'solde'))]),
  ])
  const previousCvae = previous?.computation && previous.period && !previous.period.estimate ? previous.computation.cvaeCents : null
  const onLastValueAdded =
    previous?.books && previous.turnoverAnnualCents !== null && cvaeYearStatus(year) === 'in-force'
      ? computeCvae({ year, turnoverCents: previous.books.turnoverCents, turnoverAnnualCents: previous.turnoverAnnualCents, valueAddedCents: previous.books.valueAddedCents + previous.adjustmentsCents }).cvaeCents
      : null

  const hints: string[] = []
  const turnover = current.turnoverAnnualCents
  if (current.status === 'in-force' && turnover !== null) {
    if (turnover > CVAE_DECLARATION_THRESHOLD_CENTS && !context.settings.cvae) {
      hints.push('Votre chiffre d’affaires dépasse 152 500 € : la déclaration 1330-CVAE est due. Activez-la dans les paramètres des échéances.')
    }
    if (turnover > CVAE_PAYMENT_THRESHOLD_CENTS && !context.settings.cvaeDue) {
      hints.push('Votre chiffre d’affaires dépasse 500 000 € : la CVAE se liquide avec la 1329-DEF. Activez-la dans les paramètres des échéances.')
    }
  }
  if (current.status === 'abolished') hints.push(`La CVAE est supprimée à partir de 2030 (loi de finances pour 2025) : rien à déclarer ni à payer pour ${year}.`)

  const plafonnement = plafonnementEstimate(year, avis?.totalCents ?? null, current.computation?.cvaeCents ?? 0, current.computation ? current.computation.valueAdded.cents : null)

  const deadlines = computeDeadlines({ ...context, from: `${year}-01-01`, to: `${year + 1}-12-31` })
  const tracked = (await trackDeadlines(companyId, context, deadlines, today)).filter((d) => concernsYear(d, year))

  const firstYear = Math.min(...context.fiscalYears.map((fy) => Number(fy.startDate.slice(0, 4))), currentYear)
  const years = Array.from({ length: Math.max(currentYear + 1, year) - Math.min(firstYear, year) + 1 }, (_, i) => Math.min(firstYear, year) + i).reverse()

  const S = LOCAL_TAX_SOURCES
  return {
    today,
    year,
    years,
    foundationYear,
    settings: {
      cfeAcompte: context.settings.cfeAcompte,
      cfeChanges: context.settings.cfeChanges,
      cvae: context.settings.cvae,
      cvaeDue: context.settings.cvaeDue,
      cvaeAcomptes: context.settings.cvaeAcomptes,
    },
    cfe: {
      situation,
      avis: avis && row ? { ...avis, noticeOn: row.cfeNoticeOn ? day(row.cfeNoticeOn) : null, note: row.cfeNote } : null,
      previous: previousAvis ? { year: year - 1, totalCents: previousAvis.totalCents } : null,
      schedule,
      expected,
      minimum: { referenceYear: year - 2, turnoverCents: reference?.turnoverCents ?? null, exempt: cfeMinimumExempt(reference?.turnoverCents ?? null) },
      drafts: { acompte: drafts[0], solde: drafts[1] },
    },
    cvae: {
      ...current,
      previous: previous ? { year: year - 1, cvaeCents: previousCvae } : null,
      acomptes: cvaeAcomptes(year, previousCvae, onLastValueAdded),
      hints,
    },
    plafonnement,
    deadlines: tracked,
    sources: [
      S.cgi1447, S.cgi1467, S.cgi1477, S.cgi1478, S.cgi1647D, S.cgi1679quinquies, S.cgi1647Bsexies,
      S.cgi1586ter, S.cgi1586quater, S.cgi1586sexies, S.cgi1586octies, S.cgi1679septies, S.lf2025,
      S.bofipCvaeRates, S.bofipCvaeDecla, S.bofipCfeDecla, S.bofipCfeMinimum, S.bofipPlafonnement,
      S.form1447C, S.form1330, S.form1329AC, S.cetPage,
    ],
  }
}
