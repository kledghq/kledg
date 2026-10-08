/**
 * The "Rémunération et dividendes" simulator of a fiscal year
 * (docs/remuneration-dividendes.md): what the books say, the defaults of the
 * simulation and the simulation itself (simulate.ts), the scenarios saved
 * and the dividends proposed in the approval of the accounts. An
 * indicative simulation, never advice.
 *
 * Loads, in bounded queries scoped by the company:
 * - the IS worksheet of the fiscal year (lib/corporate-tax): whether the
 *   company is at the IS, the 15 % rate answers and its prorated ceiling;
 * - the income statement of the fiscal year so far and of the last closed
 *   one (lib/reports/statements, lib/reports/financial-indicators): the
 *   result before the IS (69 accounts added back) and the director's pay
 *   already booked in 644 and 646, added back too;
 * - the capital, legal reserve and prior losses (lib/accounting/
 *   result-allocation, the balances of the fiscal year);
 * - the shareholders (the director's share), the saved scenarios, the
 *   dividends proposed in the approval of the accounts (lib/approval).
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { allocationBalances } from '@/lib/accounting/result-allocation/allocate-result.service'
import { legalReserveApplies } from '@/lib/accounting/result-allocation/compute'
import { parseStoredDetails } from '@/lib/approval/get-approval.service'
import { buildCorporateTax } from '@/lib/corporate-tax/load-corporate-tax.service'
import { REDUCED_RATE_PROFIT_CEILING_CENTS } from '@/lib/corporate-tax/rules'
import { percentToBp } from '@/lib/group/periods'
import { computeSig } from '@/lib/reports/financial-indicators/sig'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import type { AccountTotals } from '@/lib/reports/statements/allocation'
import { calendarDayOf, todayUtc, utcDaysInclusive } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { mulDiv } from './income-tax'
import { PASS_CENTS, RULES_YEAR } from './rules'
import { RemunerationOverridesSchema, type DirectorStatus, type RemunerationInputs } from './schemas'
import { toSavedScenario, type SavedScenario } from './save-remuneration-scenario.service'
import { simulate, type Simulation } from './simulate'
import { sourcesFor, type RemunerationSource } from './sources'

export const BASES = ['current', 'projection', 'closed'] as const
export type Basis = (typeof BASES)[number]

export const RemunerationQuerySchema = z.object({
  fiscalYearId: z.string().min(1).max(100).optional(),
  /** A saved scenario: its inputs replace the defaults. */
  scenarioId: z.string().min(1).max(100).optional(),
  /** Which figure of the books prefills the result before pay. */
  basis: z.enum(BASES, { error: 'Base inconnue : current, projection ou closed' }).optional(),
  /** Inputs changed by the user, as JSON (RemunerationOverridesSchema). */
  inputs: z.string().max(4_000).optional(),
})
export type RemunerationQuery = z.infer<typeof RemunerationQuerySchema>

/** Legal forms whose officer is an assimilé salarié (président, président du conseil d'administration). */
const ASSIMILE_FORMS = new Set(['SAS', 'SASU', 'SA', 'SELAS'])
/** Legal forms whose gérant is a TNS when he holds the majority, an assimilé salarié otherwise (CSS art. L311-3, 11°; CGI art. 62). */
const GERANT_FORMS = new Set(['SARL', 'EURL', 'SELARL'])
const MAX_SHAREHOLDERS = 200
const MAX_SCENARIOS = 50

export interface FiscalYearOption {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
}

export interface BasisFigure {
  basis: Basis
  label: string
  fiscalYear: FiscalYearOption
  /** Result of the income statement before the IS (69 accounts added back). */
  resultBeforeTaxCents: number
  /** Director's pay already booked (644 rémunération du travail de l'exploitant, 646 cotisations personnelles), added back. */
  directorPayBookedCents: number
  /** The budget of the simulation: result before tax plus the pay booked. */
  resultBeforePayCents: number
  /** Days of the fiscal year passed (projection), and its days. */
  daysElapsed: number
  daysInYear: number
}

export interface RemunerationView {
  today: string
  status: 'ready' | 'not-subject' | 'missing-regime' | 'no-fiscal-year' | 'unsupported-form'
  rulesYear: number
  passCents: number
  legalType: string | null
  fiscalYears: FiscalYearOption[]
  fiscalYear: FiscalYearOption | null
  bases: BasisFigure[]
  basis: Basis | null
  shareholders: Array<{ id: string; name: string; shareBp: number; natural: boolean }>
  /** What the status comes from, in French. */
  statusReason: string | null
  reducedRateEligible: boolean | null
  /** The defaults read from the books, before the user's changes. */
  defaults: RemunerationInputs | null
  inputs: RemunerationInputs | null
  scenario: SavedScenario | null
  simulation: Simulation | null
  scenarios: SavedScenario[]
  approval: { proposedDividendsCents: number | null }
  /** Current account (455) credit balance of the year, for all associates: a hint for the TNS threshold. */
  currentAccountsCents: number
  checks: string[]
  sources: RemunerationSource[]
}

const day = (value: Date) => calendarDayOf(value) as string
const cents = (value: { toString(): string } | null | undefined) => parseCents(value ?? 0) ?? 0
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const option = (y: { id: string; year: number; startDate: Date; endDate: Date; isClosed: boolean }): FiscalYearOption => ({
  id: y.id,
  year: y.year,
  startDate: day(y.startDate),
  endDate: day(y.endDate),
  isClosed: y.isClosed,
})

const netDebit = (accounts: readonly AccountTotals[], prefixes: string[]) =>
  accounts.filter((a) => prefixes.some((p) => a.code.startsWith(p))).reduce((s, a) => s + a.debitCents - a.creditCents, 0)

async function figureOf(companyId: string, fy: FiscalYearOption, basis: Basis, today: string): Promise<BasisFigure> {
  const accounts = await loadStatementAccounts(companyId, { id: fy.id, startDate: utc(fy.startDate), endDate: utc(fy.endDate) })
  const sig = computeSig(accounts)
  const resultBeforeTax = sig.resultatExerciceCents + sig.impotsBeneficesCents
  const booked = Math.max(netDebit(accounts, ['644', '646']), 0)
  const daysInYear = utcDaysInclusive(utc(fy.startDate), utc(fy.endDate))
  const until = today < fy.endDate ? today : fy.endDate
  const daysElapsed = today < fy.startDate ? 0 : utcDaysInclusive(utc(fy.startDate), utc(until))
  const base = resultBeforeTax + booked
  const projected = basis === 'projection' && daysElapsed > 0 && daysElapsed < daysInYear ? mulDiv(base, daysInYear, daysElapsed) : base
  const labels: Record<Basis, string> = {
    current: `Exercice ${fy.year} à ce jour`,
    projection: `Exercice ${fy.year} projeté sur l’année`,
    closed: `Dernier exercice clos (${fy.year})`,
  }
  return {
    basis,
    label: labels[basis],
    fiscalYear: fy,
    resultBeforeTaxCents: basis === 'projection' ? projected - booked : resultBeforeTax,
    directorPayBookedCents: booked,
    resultBeforePayCents: projected,
    daysElapsed,
    daysInYear,
  }
}

/** Status of the director from the legal form and the share held. */
export function directorStatusOf(legalType: string | null, shareBp: number): { status: DirectorStatus | null; reason: string } {
  if (legalType && ASSIMILE_FORMS.has(legalType)) {
    return { status: 'assimile', reason: `${legalType} : le président est assimilé salarié (CSS, art. L311-3, 12° et 23°).` }
  }
  if (legalType && GERANT_FORMS.has(legalType)) {
    return shareBp > 5_000
      ? { status: 'tns', reason: `${legalType} : un gérant qui détient plus de la moitié des parts (avec son conjoint, ses enfants mineurs et les autres gérants) est travailleur non salarié.` }
      : { status: 'assimile', reason: `${legalType} : un gérant minoritaire ou égalitaire est assimilé salarié (CSS, art. L311-3, 11°).` }
  }
  return { status: null, reason: 'Le simulateur couvre les SAS, SASU, SA, SARL, EURL, SELARL et SELAS à l’impôt sur les sociétés.' }
}

function parseOverrides(json: string | undefined) {
  if (!json) return {}
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    throw new ValidationError('Paramètres de simulation illisibles : un objet JSON est attendu.')
  }
  const parsed = RemunerationOverridesSchema.safeParse(value)
  if (!parsed.success) throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' ; '))
  return parsed.data
}

function emptyView(today: string, status: RemunerationView['status'], extra: Partial<RemunerationView> = {}): RemunerationView {
  return {
    today,
    status,
    rulesYear: RULES_YEAR,
    passCents: PASS_CENTS,
    legalType: null,
    fiscalYears: [],
    fiscalYear: null,
    bases: [],
    basis: null,
    shareholders: [],
    statusReason: null,
    reducedRateEligible: null,
    defaults: null,
    inputs: null,
    scenario: null,
    simulation: null,
    scenarios: [],
    approval: { proposedDividendsCents: null },
    currentAccountsCents: 0,
    checks: [],
    sources: [],
    ...extra,
  }
}

/** GET /api/companies/[id]/remuneration: the simulator of a fiscal year (the one in progress by default). */
export async function loadRemuneration(companyId: string, query: RemunerationQuery, options: { now?: Date } = {}): Promise<RemunerationView> {
  const today = day(todayUtc(options.now))
  const overrides = parseOverrides(query.inputs)
  const [company, years] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { legalType: true, shareCapital: true } }),
    prisma.fiscalYear.findMany({ where: { companyId }, orderBy: { startDate: 'asc' }, take: 100, select: { id: true, year: true, startDate: true, endDate: true, isClosed: true } }),
  ])
  if (!company) throw new NotFoundError('Société introuvable')
  const fiscalYears = years.map(option)
  if (fiscalYears.length === 0) return emptyView(today, 'no-fiscal-year')

  const scenarioRow = query.scenarioId
    ? await prisma.remunerationScenario.findFirst({
        where: { id: query.scenarioId, companyId },
        select: { id: true, fiscalYearId: true, name: true, inputs: true, rulesYear: true, remunerationCost: true, dividends: true, netIncome: true, updatedAt: true },
      })
    : null
  if (query.scenarioId && !scenarioRow) throw new NotFoundError('Scénario introuvable')
  const wanted = scenarioRow?.fiscalYearId ?? query.fiscalYearId
  const fy = wanted
    ? fiscalYears.find((y) => y.id === wanted)
    : (fiscalYears.find((y) => y.startDate <= today && today <= y.endDate) ?? fiscalYears[fiscalYears.length - 1])
  if (!fy) throw new NotFoundError('Exercice comptable introuvable')
  const legalType = company.legalType ?? null
  const listed = [...fiscalYears].reverse()

  const { view: tax } = await buildCorporateTax(companyId, { fiscalYearId: fy.id }, { now: options.now, access: null })
  if (tax.status !== 'ready') return emptyView(today, tax.status === 'not-subject' ? 'not-subject' : tax.status === 'missing-regime' ? 'missing-regime' : 'no-fiscal-year', { legalType, fiscalYears: listed, fiscalYear: fy })

  const closed = [...fiscalYears].reverse().find((y) => y.isClosed && y.endDate <= fy.endDate) ?? null
  const [current, projection, closedFigure, balances, shareholders, savedRows, approval, currentAccounts] = await Promise.all([
    figureOf(companyId, fy, 'current', today),
    figureOf(companyId, fy, 'projection', today),
    closed ? figureOf(companyId, closed, 'closed', today) : Promise.resolve(null),
    allocationBalances(prisma, companyId, fy.id),
    prisma.shareholder.findMany({
      where: { companyId },
      take: MAX_SHAREHOLDERS,
      orderBy: { sharePercentage: 'desc' },
      select: { id: true, type: true, sharePercentage: true, name: true, person: { select: { firstName: true, name: true, usualName: true } }, companyShareholder: { select: { name: true } } },
    }),
    prisma.remunerationScenario.findMany({
      where: { companyId, fiscalYearId: fy.id },
      orderBy: { updatedAt: 'desc' },
      take: MAX_SCENARIOS,
      select: { id: true, fiscalYearId: true, name: true, inputs: true, rulesYear: true, remunerationCost: true, dividends: true, netIncome: true, updatedAt: true },
    }),
    prisma.accountsApproval.findUnique({ where: { fiscalYearId_companyId: { fiscalYearId: fy.id, companyId } }, select: { details: true } }),
    prisma.entryLine.aggregate({
      where: { account: { companyId, fiscalYearId: fy.id, code: { startsWith: '455' } }, accountingEntry: { companyId, fiscalYearId: fy.id, status: 'validated' } },
      _sum: { debit: true, credit: true },
    }),
  ])

  const bases = [current, projection, ...(closedFigure && closedFigure.fiscalYear.id !== fy.id ? [closedFigure] : [])]
  const fyEnded = fy.endDate < today
  const defaultBasis: Basis = query.basis && bases.some((b) => b.basis === query.basis) ? query.basis : fyEnded ? 'current' : closedFigure && closedFigure.fiscalYear.id !== fy.id ? 'closed' : 'projection'
  const figure = bases.find((b) => b.basis === defaultBasis) as BasisFigure

  const holders = shareholders.map((s) => ({
    id: s.id,
    name: s.person ? `${s.person.firstName} ${s.person.usualName || s.person.name}`.trim() : (s.companyShareholder?.name ?? s.name ?? 'Associé'),
    shareBp: percentToBp(s.sharePercentage.toString()),
    natural: s.type === 'PHYSICAL',
  }))
  const director = holders.find((h) => h.natural) ?? null
  const shareBp = director?.shareBp ?? 10_000
  const { status, reason } = directorStatusOf(legalType, overrides.shareBp ?? shareBp)
  const proposed = approval ? parseStoredDetails(approval.details).allocation.dividendsCents : null
  const scenarios = savedRows.map(toSavedScenario).filter((s): s is SavedScenario => s !== null)
  const currentAccountsCents = Math.max(cents(currentAccounts._sum.credit) - cents(currentAccounts._sum.debit), 0)
  const common = { legalType, fiscalYears: listed, fiscalYear: fy, bases, basis: defaultBasis, shareholders: holders, statusReason: reason, scenarios, approval: { proposedDividendsCents: proposed }, currentAccountsCents }
  if (!status) return emptyView(today, 'unsupported-form', common)

  const eligible = tax.computation?.eligibility.eligible ?? null
  const capital = balances.capitalCents > 0 ? balances.capitalCents : cents(company.shareCapital)
  const defaults: RemunerationInputs = {
    resultBeforePayCents: figure.resultBeforePayCents,
    status,
    reducedRate: eligible === true,
    reducedRateCeilingCents: tax.computation?.reducedRate.ceilingCents ?? REDUCED_RATE_PROFIT_CEILING_CENTS,
    legalReserveRequired: legalReserveApplies(legalType),
    capitalCents: capital,
    legalReserveCents: balances.legalReserveCents,
    priorLossesCents: balances.priorLossesCents,
    shareBp,
    premiumsCents: 0,
    currentAccountCents: 0,
    householdParts: 1,
    otherIncomeCents: 0,
    dividendTaxation: 'best',
    distributionBp: 10_000,
    mixBp: 5_000,
  }
  const scenario = scenarioRow ? toSavedScenario(scenarioRow) : null
  const inputs: RemunerationInputs = { ...defaults, ...(scenario?.inputs ?? {}), ...overrides }

  const checks: string[] = []
  if (eligible === null) checks.push('Les conditions du taux réduit de 15 % ne sont pas confirmées sur la page Impôt sur les sociétés : la simulation applique 25 % tant que vous ne les avez pas confirmées.')
  if (eligible === false) checks.push('La société ne remplit pas les conditions du taux réduit de 15 % : tout le bénéfice est imposé à 25 %.')
  if (balances.resultCents !== 0) checks.push('Le résultat de l’exercice précédent n’est pas encore affecté : la réserve légale et le report à nouveau peuvent changer.')
  if (figure.directorPayBookedCents > 0) checks.push(`La rémunération du dirigeant déjà comptabilisée (comptes 644 et 646) est ajoutée au résultat : ${(figure.directorPayBookedCents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €.`)
  checks.push('Si la rémunération du dirigeant est comptabilisée en 641 et 645 avec celle des salariés, ajoutez-la au résultat avant rémunération.')
  if (!director) checks.push('Aucun associé personne physique enregistré : la simulation suppose que le dirigeant détient tout le capital.')
  if (defaultBasis === 'projection' && figure.daysElapsed < 90) checks.push('Moins de trois mois d’écritures : la projection sur l’année est fragile, saisissez plutôt le résultat attendu.')

  return {
    ...emptyView(today, 'ready', common),
    reducedRateEligible: eligible,
    defaults,
    inputs,
    scenario,
    simulation: simulate(inputs),
    checks,
    sources: sourcesFor(inputs.status),
  }
}
