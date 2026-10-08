/**
 * The impôt sur les sociétés worksheet of a fiscal year
 * (docs/impot-societes.md): Kledg computes the tax result, the IS, the
 * acomptes of the next year and the balance from the validated entries and
 * what the user recorded; the user checks it and files the 2065-SD, the
 * relevés 2571-SD and 2572-SD on impots.gouv.fr. Kledg never files.
 *
 * Loads, in bounded queries scoped by the company:
 * - the regimes, settings and fiscal years of the deadline calendar
 *   (lib/deadlines), which say whether the company is subject to IS and
 *   when its acomptes and balance fall;
 * - the balances of the year's accounts, closing entry excluded
 *   (lib/reports/statements/load.ts), the result and the chiffre
 *   d'affaires of the income statement (lib/reports/financial-indicators);
 * - the rows of corporate_tax_returns (answers, deficits, manual lines,
 *   acomptes paid, filings) of every fiscal year, for the deficits history
 *   and the acomptes;
 * - the shareholders (75 % natural persons), the dividends from
 *   subsidiaries when a group access is given (lib/group), the drafts and
 *   bank lines of the year, the 444 payments, the draft entries prepared;
 * then runs the pure modules: adjustments.ts, compute.ts, acomptes.ts,
 * checks.ts.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { transactionOfCompany } from '@/lib/api/resources'
import { addMonthsEom, computeDeadlines, corporateTaxRegimeAt, corporateTaxRegimeValueAt, secondBusinessDayAfterMayFirst } from '@/lib/deadlines/engine'
import { INCOME_TAX_REGIME } from '@/lib/companies/profit-taxation'
import { loadDeadlineContext, type CompanyContext } from '@/lib/deadlines/load-deadlines.service'
import type { GroupAccess } from '@/lib/management-fees/access'
import { resolveGroup } from '@/lib/group/perimeter'
import { readDividendObservations } from '@/lib/group/read-member'
import { percentToBp } from '@/lib/group/periods'
import { computeSig } from '@/lib/reports/financial-indicators/sig'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import type { AccountTotals } from '@/lib/reports/statements/allocation'
import { addIsoDays, calendarDayOf, todayUtc } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { balanceOf, scheduleAcomptes, type AcomptePaid, type AcompteReference, type AcompteSchedule } from './acomptes'
import { bookAdjustments, manualAdjustments, parentSubsidiaryAdjustments, type ManualLine, type SubsidiaryDividend } from './adjustments'
import { corporateTaxChecks, isReliable, type CorporateTaxCheck } from './checks'
import { computeCorporateTax, type CorporateTaxComputation, type CorporateTaxRegime } from './compute'
import { corporateTaxDeadlineTarget, CORPORATE_TAX_DEADLINE_PATTERN } from './deadline-links'
import { FORM_TITLES, NOT_FROM_THE_BOOKS, sourcesFor } from './forms'
import { durationOf, type FiscalYearDuration } from './rules'
import type { CorporateTaxSource } from './sources'

export const CorporateTaxQuerySchema = z.object({
  fiscalYearId: z.string().min(1).max(100).optional(),
  /** A deadline of the calendar (is-acompte, is-solde, liasse): opens the worksheet that computes it. */
  deadline: z.string().regex(CORPORATE_TAX_DEADLINE_PATTERN, 'Échéance inconnue').optional(),
})
export type CorporateTaxQuery = z.infer<typeof CorporateTaxQuerySchema>

/** Legal forms taxed at the impôt sur le revenu unless they opted for the IS (then their IS regime is set). */
const INCOME_TAX_FORMS = new Set(['EI', 'SCI', 'SNC', 'SCS'])
const MAX_RETURNS = 100
const MAX_SHAREHOLDERS = 200
const DRAFT_NUMBERS_SHOWN = 10

/** "IS-2026": the reference of the IS charge draft of a fiscal year. */
export const chargeReference = (year: number) => `IS-${year}`
/** "IS-AC-2027-1": the reference of an acompte payment draft, by the year of the exercice paying it. */
export const acompteReference = (year: number, number: number) => `IS-AC-${year}-${number}`

export const ManualLineSchema = z.object({
  id: z.string().min(1).max(40),
  kind: z.enum(['reintegration', 'deduction', 'credit']),
  label: z.string().trim().min(1).max(200),
  amountCents: z.number().int().min(0).max(100_000_000_000_000),
})
export const AcomptePaidSchema = z.object({
  number: z.number().int().min(1).max(8),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountCents: z.number().int().min(0).max(100_000_000_000_000),
})

export interface FiscalYearOption {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
  filed: boolean
}

export interface DeficitHistoryRow {
  fiscalYearId: string
  year: number
  /** Null when not known (no deficits recorded and no earlier history). */
  openingCents: number | null
  imputedCents: number | null
  createdCents: number | null
  closingCents: number | null
  /** filed: from the recorded return; worksheet: this worksheet; unknown: neither. */
  basis: 'filed' | 'worksheet' | 'unknown'
  /** The opening was typed by the user (else carried from the year before). */
  openingTyped: boolean
}

export interface CorporateTaxFiling {
  filedOn: string
  resultBeforeDeficitsCents: number
  deficitsImputedCents: number
  corporateTaxCents: number
  reducedRate: boolean
}

export interface DraftEntryState {
  reference: string
  status: 'none' | 'draft' | 'validated'
  entryId: string | null
  entryNumber: string | null
}

export interface CorporateTaxView {
  today: string
  /**
   * ready: a worksheet computed; not-subject: the company is not subject to
   * IS (impôt sur le revenu: EI, SCI, SNC...), nothing to compute;
   * missing-regime: the IS regime is not set; no-fiscal-year: no exercice.
   */
  status: 'ready' | 'not-subject' | 'missing-regime' | 'no-fiscal-year'
  fiscalYears: FiscalYearOption[]
  fiscalYear: FiscalYearOption | null
  regime: CorporateTaxRegime | null
  formTitle: string | null
  duration: FiscalYearDuration | null
  computation: CorporateTaxComputation | null
  /** Where each answer of the reduced rate comes from. */
  answers: {
    capitalPaidUp: { value: boolean | null; from: 'answer' | 'books' | null }
    naturalPersons75: { value: boolean | null; from: 'answer' | 'shareholders' | null }
    /** Natural persons' share of the capital as recorded, in basis points of a percent, and whether the shareholders add up to 100 %. */
    shareholders: { naturalBp: number; totalBp: number; complete: boolean }
  }
  deficits: { openingTypedCents: number | null; history: DeficitHistoryRow[] }
  manualLines: ManualLine[]
  /** Dividends of subsidiaries deducted under the parent-subsidiary regime. */
  parentSubsidiary: SubsidiaryDividend[]
  checks: CorporateTaxCheck[]
  reliable: boolean
  /** Relevé de solde (2572-SD) of this year. */
  balance: {
    deadline: { date: string; legalDate: string; id: string } | null
    acomptesPaid: AcomptePaid[]
    paidCents: number
    /** Positive: to pay with the relevé de solde; negative: an excess to claim back. */
    balanceCents: number
    /** Debits of 444 during the year (payments booked). */
    acomptesBookedCents: number
  } | null
  /** Acomptes (2571-SD) of the next fiscal year. */
  acomptes: (AcompteSchedule & { exercice: { year: number; startDate: string; endDate: string; exists: boolean; id: string | null }; drafts: DraftEntryState[] }) | null
  /** Declaration of results (2065-SD and liasse) of this year. */
  liasse: { date: string; legalDate: string } | null
  charge: DraftEntryState
  filing: CorporateTaxFiling | null
  notFromTheBooks: readonly string[]
  sources: CorporateTaxSource[]
}

const day = (value: Date) => calendarDayOf(value) as string
const cents = (value: { toString(): string } | null | undefined) => parseCents(value ?? 0) ?? 0
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function parseList<T>(schema: z.ZodType<T>, json: unknown): T[] {
  if (!Array.isArray(json)) return []
  return json.flatMap((item) => {
    const parsed = schema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  })
}

type ReturnRow = {
  fiscalYearId: string
  capitalPaidUp: boolean | null
  naturalPersons75: boolean | null
  deficitsOpening: { toString(): string } | null
  manualLines: unknown
  acomptesPaid: unknown
  filedOn: Date | null
  resultBeforeDeficits: { toString(): string } | null
  deficitsImputed: { toString(): string } | null
  corporateTax: { toString(): string } | null
  reducedRate: boolean | null
}

function filingOf(row: ReturnRow | undefined): CorporateTaxFiling | null {
  if (!row?.filedOn || row.resultBeforeDeficits === null || row.deficitsImputed === null || row.corporateTax === null || row.reducedRate === null) return null
  return {
    filedOn: day(row.filedOn),
    resultBeforeDeficitsCents: cents(row.resultBeforeDeficits),
    deficitsImputedCents: cents(row.deficitsImputed),
    corporateTaxCents: cents(row.corporateTax),
    reducedRate: row.reducedRate,
  }
}

type Fy = CompanyContext['fiscalYears'][number]

/** Whether the company is subject to IS for a fiscal year, and at which regime. */
export function corporateTaxStatusOf(company: CompanyContext['company'], fy: Pick<Fy, 'endDate'>): { status: 'ready'; regime: CorporateTaxRegime } | { status: 'not-subject' | 'missing-regime' } {
  const regime = corporateTaxRegimeAt(company, fy.endDate)
  if (regime) return { status: 'ready', regime }
  // Micro regime, or the impôt sur le revenu recorded (lib/companies/profit-taxation.ts), or a form at IR by default
  const value = corporateTaxRegimeValueAt(company, fy.endDate)
  if (value === 'micro' || value === INCOME_TAX_REGIME || (company.legalType && INCOME_TAX_FORMS.has(company.legalType))) return { status: 'not-subject' }
  return { status: 'missing-regime' }
}

/** The first exercice of the company (no acompte, CGI art. 1668), by the engine's rule. */
function isFirstExercice(context: CompanyContext, fy: Fy): boolean {
  const first = context.fiscalYears[0]
  const foundation = context.company.foundationDate
  return first?.id === fy.id && foundation !== null && foundation >= addIsoDays(fy.startDate, -31) && foundation <= fy.endDate
}

/** Day the declaration of results is due (2065-SD and liasse), as the calendar computes it. */
function liasseLegalDate(endDate: string): string {
  return endDate.endsWith('-12-31') ? secondBusinessDayAfterMayFirst(Number(endDate.slice(0, 4)) + 1) : addMonthsEom(endDate, 3)
}

function chooseFiscalYear(context: CompanyContext, query: CorporateTaxQuery, today: string): Fy {
  const years = context.fiscalYears
  if (query.fiscalYearId) {
    const found = years.find((fy) => fy.id === query.fiscalYearId)
    if (!found) throw new NotFoundError('Exercice introuvable')
    return found
  }
  if (query.deadline) {
    const target = corporateTaxDeadlineTarget(query.deadline)
    const exercice = target ? years.find((fy) => fy.endDate === target.exerciceEnd) : undefined
    // The acomptes of an exercice are computed on the worksheet of the one before it.
    const found = target?.kind === 'acompte' ? (exercice ? years.find((fy) => addIsoDays(fy.endDate, 1) === exercice.startDate) : years.find((fy) => addMonthsEom(fy.endDate, 12) === target.exerciceEnd)) : exercice
    if (!found) throw new NotFoundError('Aucun exercice ne correspond à cette échéance : créez l’exercice pour préparer l’impôt.')
    return found
  }
  // By default: the latest closed exercice whose balance is not due yet, else the exercice in progress, else the latest.
  const pending = years.filter((fy) => fy.endDate < today && addMonthsEom(fy.endDate, 4) >= today)
  if (pending.length > 0) return pending[pending.length - 1]
  return years.find((fy) => fy.startDate <= today && fy.endDate >= today) ?? years[years.length - 1]
}

/** Capital not fully paid, read with certainty from the books: 109, 4562 in debit, 1011, 1012 in credit. */
function capitalNotPaidInBooks(accounts: readonly AccountTotals[]): boolean {
  return accounts.some((a) => {
    const balance = a.debitCents - a.creditCents
    if (a.code.startsWith('109') || a.code.startsWith('4562')) return balance > 0
    if (a.code.startsWith('1011') || a.code.startsWith('1012')) return balance < 0
    return false
  })
}

const sumWhere = (accounts: readonly AccountTotals[], test: (code: string) => boolean) =>
  accounts.filter((a) => test(a.code)).reduce((s, a) => s + a.debitCents - a.creditCents, 0)

async function draftState(companyId: string, reference: string): Promise<DraftEntryState> {
  const entry = await prisma.accountingEntry.findFirst({ where: { companyId, reference }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, entryNumber: true } })
  return { reference, status: entry ? (entry.status === 'validated' ? 'validated' : 'draft') : 'none', entryId: entry?.id ?? null, entryNumber: entry?.entryNumber ?? null }
}

async function groupDividends(companyId: string, fiscalYearId: string, access: GroupAccess): Promise<{ dividends: SubsidiaryDividend[]; unreachable: number }> {
  const perimeter = await resolveGroup(companyId, access)
  if (perimeter.subsidiaries.length === 0) return { dividends: [], unreachable: perimeter.unreachable.length }
  const observations = await readDividendObservations(companyId, fiscalYearId, [perimeter.holding, ...perimeter.subsidiaries])
  const dividends = perimeter.subsidiaries.map((sub) => ({
    subsidiaryId: sub.id,
    name: sub.name,
    stakeBp: sub.stake?.percentBp ?? 0,
    dividendsCents: observations.filter((o) => o.counterpartyId === sub.id).reduce((s, o) => s + o.cents, 0),
  }))
  return { dividends: dividends.filter((d) => d.dividendsCents !== 0), unreachable: perimeter.unreachable.length }
}

export interface BuildOptions {
  now?: Date
  /** Reads the subsidiaries for the parent-subsidiary regime; null: the dividends stay taxable (an estimate). */
  access?: GroupAccess | null
}

function emptyView(today: string, status: CorporateTaxView['status'], years: FiscalYearOption[] = [], fiscalYear: FiscalYearOption | null = null): CorporateTaxView {
  return {
    today,
    status,
    fiscalYears: years,
    fiscalYear,
    regime: null,
    formTitle: null,
    duration: null,
    computation: null,
    answers: { capitalPaidUp: { value: null, from: null }, naturalPersons75: { value: null, from: null }, shareholders: { naturalBp: 0, totalBp: 0, complete: false } },
    deficits: { openingTypedCents: null, history: [] },
    manualLines: [],
    parentSubsidiary: [],
    checks: [],
    reliable: false,
    balance: null,
    acomptes: null,
    liasse: null,
    charge: { reference: '', status: 'none', entryId: null, entryNumber: null },
    filing: null,
    notFromTheBooks: [],
    sources: [],
  }
}

export interface BuiltCorporateTax {
  view: CorporateTaxView
  /** The fiscal year of the worksheet with its open state, for the entry service. */
  fiscalYear: Fy | null
  /** The next fiscal year when it exists in Kledg. */
  nextFiscalYear: Fy | null
}

export async function buildCorporateTax(companyId: string, query: CorporateTaxQuery, options: BuildOptions = {}): Promise<BuiltCorporateTax> {
  const context = await loadDeadlineContext(companyId)
  const today = day(todayUtc(options.now))
  if (context.fiscalYears.length === 0) return { view: emptyView(today, 'no-fiscal-year'), fiscalYear: null, nextFiscalYear: null }

  const fy = chooseFiscalYear(context, query, today)
  const rows = await prisma.corporateTaxReturn.findMany({
    where: { companyId },
    take: MAX_RETURNS,
    select: {
      fiscalYearId: true,
      capitalPaidUp: true,
      naturalPersons75: true,
      deficitsOpening: true,
      manualLines: true,
      acomptesPaid: true,
      filedOn: true,
      resultBeforeDeficits: true,
      deficitsImputed: true,
      corporateTax: true,
      reducedRate: true,
    },
  })
  const rowOf = new Map<string, ReturnRow>(rows.map((r) => [r.fiscalYearId, r]))
  const years: FiscalYearOption[] = context.fiscalYears
    .map((y) => ({ id: y.id, year: y.year, startDate: y.startDate, endDate: y.endDate, isClosed: y.isClosed, filed: filingOf(rowOf.get(y.id)) !== null }))
    .reverse()
  const option = years.find((y) => y.id === fy.id) as FiscalYearOption
  const subject = corporateTaxStatusOf(context.company, fy)
  if (subject.status !== 'ready') return { view: emptyView(today, subject.status, years, option), fiscalYear: fy, nextFiscalYear: null }
  const regime = subject.regime
  const duration = durationOf(fy.startDate, fy.endDate)
  const row = rowOf.get(fy.id)
  const range = { gte: utc(fy.startDate), lte: utc(fy.endDate) }
  const chargeRef = chargeReference(fy.year)

  // The next exercice: in Kledg, or the twelve months the calendar projects.
  const nextFy = context.fiscalYears.find((y) => y.startDate === addIsoDays(fy.endDate, 1)) ?? null
  const next = nextFy
    ? { year: nextFy.year, startDate: nextFy.startDate, endDate: nextFy.endDate, exists: true, id: nextFy.id }
    : { year: Number(addMonthsEom(fy.endDate, 12).slice(0, 4)), startDate: addIsoDays(fy.endDate, 1), endDate: addMonthsEom(fy.endDate, 12), exists: false, id: null }

  const [accounts, shareholders, draftCount, drafts, unreconciled, booked444, charge, group] = await Promise.all([
    loadStatementAccounts(companyId, { id: fy.id, startDate: utc(fy.startDate), endDate: utc(fy.endDate) }),
    prisma.shareholder.findMany({ where: { companyId }, select: { type: true, sharePercentage: true }, take: MAX_SHAREHOLDERS }),
    // NOT on a nullable column would leave out the drafts without a reference.
    prisma.accountingEntry.count({ where: { companyId, status: 'draft', date: range, OR: [{ reference: null }, { NOT: { reference: { startsWith: 'IS-' } } }] } }),
    prisma.accountingEntry.findMany({
      where: { companyId, status: 'draft', date: range, OR: [{ reference: null }, { NOT: { reference: { startsWith: 'IS-' } } }] },
      orderBy: [{ date: 'asc' }, { entryNumber: 'asc' }],
      take: DRAFT_NUMBERS_SHOWN,
      select: { entryNumber: true },
    }),
    prisma.bankTransaction.aggregate({
      where: { ...transactionOfCompany(companyId), reconciled: false, date: range, OR: [{ status: null }, { status: { not: 'declined' } }] },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.entryLine.aggregate({
      where: {
        account: { companyId, fiscalYearId: fy.id, code: { startsWith: '444' } },
        accountingEntry: { companyId, fiscalYearId: fy.id, status: 'validated', OR: [{ reference: null }, { reference: { not: chargeRef } }], journal: { code: { notIn: ['AN', 'CL'] } } },
      },
      _sum: { debit: true },
    }),
    draftState(companyId, chargeRef),
    options.access ? groupDividends(companyId, fy.id, options.access) : Promise.resolve({ dividends: [] as SubsidiaryDividend[], unreachable: 0 }),
  ])

  const sig = computeSig(accounts)

  // Answers of the reduced rate: the user's, else what the books or the shareholders say for sure.
  const capitalFromBooks = capitalNotPaidInBooks(accounts) ? false : null
  const capitalPaidUp = row?.capitalPaidUp ?? capitalFromBooks
  let naturalBp = 0
  let totalBp = 0
  for (const s of shareholders) {
    const bp = percentToBp(s.sharePercentage.toString())
    totalBp += bp
    if (s.type === 'PHYSICAL') naturalBp += bp
  }
  const complete = totalBp === 10_000
  const fromShareholders = complete && naturalBp >= 7_500 ? true : null
  const naturalPersons75 = row?.naturalPersons75 ?? fromShareholders

  // Deficits: the years before, from their filings, then this year's opening.
  const ordered = context.fiscalYears.filter((y) => y.startDate < fy.startDate)
  const history: DeficitHistoryRow[] = []
  let carried: number | null = null
  ordered.forEach((y, index) => {
    const r = rowOf.get(y.id)
    const typed = r?.deficitsOpening ? cents(r.deficitsOpening) : null
    const opening = typed ?? (index === 0 ? (isFirstExercice(context, y) ? 0 : null) : carried)
    const filing = filingOf(r)
    if (!filing) {
      history.push({ fiscalYearId: y.id, year: y.year, openingCents: opening, imputedCents: null, createdCents: null, closingCents: null, basis: 'unknown', openingTyped: typed !== null })
      carried = null
      return
    }
    const created = Math.max(-filing.resultBeforeDeficitsCents, 0)
    const closing = opening === null ? null : Math.max(opening - filing.deficitsImputedCents, 0) + created
    history.push({ fiscalYearId: y.id, year: y.year, openingCents: opening, imputedCents: filing.deficitsImputedCents, createdCents: created, closingCents: closing, basis: 'filed', openingTyped: typed !== null })
    carried = closing
  })
  const typedOpening = row?.deficitsOpening ? cents(row.deficitsOpening) : null
  const derivedOpening = ordered.length === 0 ? (isFirstExercice(context, fy) ? 0 : null) : carried
  const deficitsOpeningCents = typedOpening ?? derivedOpening

  const manualLines = parseList(ManualLineSchema, row?.manualLines)
  const books = bookAdjustments(accounts)
  const parent = parentSubsidiaryAdjustments(group.dividends)
  const manual = manualAdjustments(manualLines)
  const computation = computeCorporateTax({
    regime,
    duration,
    accountingResultCents: sig.resultatExerciceCents,
    adjustments: [...books, ...parent.adjustments, ...manual.adjustments],
    credits: manual.credits,
    deficitsOpeningCents,
    turnoverCents: sig.chiffreAffairesCents,
    capitalPaidUp,
    naturalPersons75,
  })
  const d = computation.deficits
  history.push({
    fiscalYearId: fy.id,
    year: fy.year,
    openingCents: d.known ? d.openingCents : null,
    imputedCents: d.imputedCents,
    createdCents: d.createdCents,
    closingCents: d.known ? d.closingCents : null,
    basis: 'worksheet',
    openingTyped: typedOpening !== null,
  })

  // Calendar: balance and liasse of this exercice, acomptes of the next one.
  const deadlines = computeDeadlines({ ...context, settings: { ...context.settings, isAcomptes: true }, from: fy.startDate, to: addIsoDays(next.endDate, 160) })
  const solde = deadlines.find((x) => x.id === `is-solde:${fy.endDate}`) ?? null
  const liasse = deadlines.find((x) => x.id === `liasse:${fy.endDate}`) ?? null
  const dues = deadlines
    .filter((x) => x.ruleId === 'is-acompte' && x.id.startsWith(`is-acompte:${next.endDate}:`))
    .map((x) => ({ number: Number(x.id.split(':')[2]), date: x.date, legalDate: x.legalDate, deadlineId: x.id }))
    .sort((a, b) => a.number - b.number)

  const filing = filingOf(row)
  const current: AcompteReference = filing
    ? { label: `exercice ${fy.year}`, profitCents: Math.max(filing.resultBeforeDeficitsCents - filing.deficitsImputedCents, 0), duration, reducedRate: filing.reducedRate, filed: true }
    : { label: `exercice ${fy.year}`, profitCents: computation.taxableProfitCents, duration, reducedRate: computation.reducedRate.applied, filed: false }
  const previousFy = context.fiscalYears.find((y) => addIsoDays(y.endDate, 1) === fy.startDate) ?? null
  const previousFiling = previousFy ? filingOf(rowOf.get(previousFy.id)) : null
  const previous: AcompteReference | 'none' | null = previousFy
    ? previousFiling
      ? {
          label: `exercice ${previousFy.year}`,
          profitCents: Math.max(previousFiling.resultBeforeDeficitsCents - previousFiling.deficitsImputedCents, 0),
          duration: durationOf(previousFy.startDate, previousFy.endDate),
          reducedRate: previousFiling.reducedRate,
          filed: true,
        }
      : null
    : isFirstExercice(context, fy)
      ? 'none'
      : null
  const schedule = scheduleAcomptes({ dues, current, previous, firstOnPrevious: dues.length > 0 && dues[0].legalDate < liasseLegalDate(fy.endDate) })
  const acompteDrafts = await Promise.all(dues.map((due) => draftState(companyId, acompteReference(next.year, due.number))))

  const acomptesPaid = parseList(AcomptePaidSchema, row?.acomptesPaid)
  const { paidCents, balanceCents } = balanceOf(computation.totalCents, acomptesPaid)
  const acomptesBookedCents = cents(booked444._sum.debit)

  const dividends761 = -sumWhere(accounts, (code) => code.startsWith('761'))
  const qualifyingCents = parent.qualifying.reduce((s, q) => s + q.dividendsCents, 0)
  const unanswered: string[] = []
  if (computation.eligibility.turnoverOk) {
    if (capitalPaidUp === null) unanswered.push('Le capital est-il entièrement libéré ?')
    if (naturalPersons75 === null) unanswered.push('Le capital est-il détenu à 75 % au moins par des personnes physiques, directement ou par des sociétés qui remplissent les mêmes conditions ?')
  }
  const checks = corporateTaxChecks({
    drafts: { count: draftCount, numbers: drafts.map((x) => x.entryNumber) },
    unreconciled: { count: unreconciled._count._all, totalCents: Math.abs(cents(unreconciled._sum.amount)) },
    yearInProgress: today <= fy.endDate,
    unanswered,
    deficitsKnown: deficitsOpeningCents !== null,
    otherDividendsCents: Math.max(dividends761 - qualifyingCents, 0),
    unreachableSubsidiaries: group.unreachable,
    receptionsCents: Math.max(sumWhere(accounts, (code) => code.startsWith('6257')), 0),
    foreignTaxCents: sumWhere(accounts, (code) => code.startsWith('6954')),
    taxGroupCents: sumWhere(accounts, (code) => code.startsWith('698')),
    acomptes: { recordedCents: paidCents, bookedCents: acomptesBookedCents },
  })

  const view: CorporateTaxView = {
    today,
    status: 'ready',
    fiscalYears: years,
    fiscalYear: option,
    regime,
    formTitle: FORM_TITLES[regime],
    duration,
    computation,
    answers: {
      capitalPaidUp: { value: capitalPaidUp, from: row?.capitalPaidUp != null ? 'answer' : capitalFromBooks !== null ? 'books' : null },
      naturalPersons75: { value: naturalPersons75, from: row?.naturalPersons75 != null ? 'answer' : fromShareholders !== null ? 'shareholders' : null },
      shareholders: { naturalBp, totalBp, complete },
    },
    deficits: { openingTypedCents: typedOpening, history },
    manualLines,
    parentSubsidiary: parent.qualifying,
    checks,
    reliable: isReliable(checks),
    balance: {
      deadline: solde ? { date: solde.date, legalDate: solde.legalDate, id: solde.id } : null,
      acomptesPaid,
      paidCents,
      balanceCents,
      acomptesBookedCents,
    },
    acomptes: { ...schedule, exercice: next, drafts: acompteDrafts },
    liasse: liasse ? { date: liasse.date, legalDate: liasse.legalDate } : null,
    charge,
    filing,
    notFromTheBooks: NOT_FROM_THE_BOOKS,
    sources: sourcesFor(regime),
  }
  return { view, fiscalYear: fy, nextFiscalYear: nextFy }
}

/** GET /api/companies/[id]/corporate-tax: the worksheet of a fiscal year (the one due next by default). */
export async function loadCorporateTax(companyId: string, query: CorporateTaxQuery, options: BuildOptions = {}): Promise<CorporateTaxView> {
  return (await buildCorporateTax(companyId, query, options)).view
}

/**
 * The estimate the simple home shows ("Impôt sur les sociétés estimé"):
 * the tax of the fiscal year from its entries so far, as the worksheet
 * computes it, without the subsidiaries' dividends (no group access there).
 * Null when the company is not subject to IS or nothing can be computed.
 */
export async function estimateCorporateTax(companyId: string, fiscalYearId: string, now?: Date): Promise<{ totalCents: number; reducedRate: boolean } | null> {
  const { view } = await buildCorporateTax(companyId, { fiscalYearId }, { now, access: null })
  if (view.status !== 'ready' || !view.computation) return null
  return { totalCents: Math.max(view.computation.totalCents, 0), reducedRate: view.computation.reducedRate.applied }
}
