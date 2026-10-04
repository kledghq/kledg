/**
 * Deadline engine: the tax and legal deadlines of a company between two
 * days, from its regimes, legal form, fiscal years and calendar settings.
 * Pure (no database, no clock): the API, the dashboard widget and the tests
 * call it with plain values. Dates only, never amounts.
 *
 * Every deadline names the rule it comes from (lib/deadlines/rules.ts, with
 * the official sources). Days that depend on information Kledg does not
 * hold are marked `estimated` and default to the earliest possible day, so
 * the calendar is never later than the company's real deadline:
 * - the CA3 day (15 to 24 by legal form, location and SIREN): the earliest
 *   day of the legal form, unless the company set its own;
 * - acomptes that depend on last year's amounts (IS, CFE, CA12): shown with
 *   their condition unless the company says they are not due.
 *
 * Weekends and public holidays: postponed to the next business day where the
 * administration does it (VAT, IS, CFE; see rules.ts). The liasse of a
 * closing other than 31 December is brought back to the previous business
 * day when its last day is a weekend, as the 2026 calendar shows it.
 * Legal deadlines of the Code de commerce are kept as written.
 *
 * Not covered (documented, never guessed): companies at the impôt sur le
 * revenu (2031), the CA12E option, the first tax period of a first exercice
 * longer than the calendar year (CGI art. 209, I), years without any closing,
 * and Alsace-Moselle holidays.
 */

import { nextBusinessDay, nthBusinessDayAfter, isBusinessDay } from './french-holidays'
import { RULES, type RuleId } from './rules'
import { defaultVatFilingDay, type DeadlineSettings } from './settings'
import type { Deadline } from './types'

export interface RegimePeriod {
  regimeType: string
  regime: string
  startDate: string
  endDate: string | null
  isVatExempt?: boolean
  /** An exemption of one establishment does not change the company's returns. */
  establishmentId?: string | null
}

export interface DeadlineCompany {
  legalType: string | null
  /** Company.vatRegime: normal, real, mini_real, simplified, franchise; null when unknown. */
  vatRegime: string | null
  isVatExempt: boolean
  /** Company.corporateTaxRegime: normal or simplified; null or micro: not subject to IS. */
  corporateTaxRegime: string | null
  foundationDate: string | null
  /** TaxRegimeHistory rows: they win over the company fields for the periods they cover. */
  regimeHistory: RegimePeriod[]
}

export interface DeadlineFiscalYear {
  id: string
  startDate: string
  endDate: string
}

/**
 * What the approval pack recorded for a fiscal year (lib/approval): the day
 * the accounts were approved, and the day they were filed with the greffe.
 */
export interface DeadlineApproval {
  approvedOn: string | null
  filedOn: string | null
  /** Filed online for this fiscal year (two months); null: the company setting. */
  filedOnline?: boolean | null
}

export interface DeadlineInput {
  company: DeadlineCompany
  fiscalYears: DeadlineFiscalYear[]
  settings: DeadlineSettings
  /** By fiscal year id: the approval and filing recorded in the approval pack. */
  approvals?: Record<string, DeadlineApproval>
  /** First and last day of the range, both included (yyyy-mm-dd). */
  from: string
  to: string
}

/** The VAT regime from 1 January 2027 is réel normal or franchise only (loi n° 2025-127, art. 38). */
export const SIMPLIFIED_VAT_LAST_YEAR = 2026

/** Legal forms that approve their accounts within six months and file them with the greffe (unknown included). */
const ACCOUNTS_FILING_FORMS = new Set(['SARL', 'EURL', 'SELARL', 'SA', 'SAS', 'SASU', 'SELAS', 'SCA'])

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const QUARTERS = ['1er', '2e', '3e', '4e']
const ORDINALS = ['1er', '2e', '3e', '4e', '5e', '6e', '7e', '8e']
const DAY_MS = 86_400_000

// ------------------------------------------------------------ day helpers

const pad = (n: number) => String(n).padStart(2, '0')
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const yearOf = (day: string) => Number(day.slice(0, 4))
const monthOf = (day: string) => Number(day.slice(5, 7))
const dayOf = (day: string) => Number(day.slice(8, 10))
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const frDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`

/** Year and month `months` after (y, m). */
function shiftMonth(y: number, m: number, months: number): [number, number] {
  const index = y * 12 + (m - 1) + months
  return [Math.floor(index / 12), (index % 12) + 1]
}

/**
 * The day `months` months after `day`. The last day of a month gives the
 * last day of the target month (28/02 + 3 months: 31/05, 30/06 + 6: 31/12),
 * how "dans les trois mois" and "dans les six mois" of a month-end closing
 * are read; another day keeps its number, capped at the month's end.
 */
export function addMonthsEom(day: string, months: number): string {
  const [y, m] = shiftMonth(yearOf(day), monthOf(day), months)
  const last = lastDay(y, m)
  const endOfMonth = dayOf(day) === lastDay(yearOf(day), monthOf(day))
  return isoOf(y, m, endOfMonth ? last : Math.min(dayOf(day), last))
}

function previousBusinessDay(day: string): string {
  let current = day
  while (!isBusinessDay(current)) current = addDays(current, -1)
  return current
}

/** "le deuxième jour ouvré suivant le 1er mai" of a year. */
export function secondBusinessDayAfterMayFirst(year: number): string {
  return nthBusinessDayAfter(isoOf(year, 5, 1), 2)
}

// ------------------------------------------------------------ regimes

export type VatRegime = 'normal' | 'simplified' | 'none'

function normalizeVat(regime: string | null, exempt: boolean): VatRegime | null {
  if (exempt) return 'none'
  if (regime === 'normal' || regime === 'real' || regime === 'mini_real') return 'normal'
  if (regime === 'simplified') return 'simplified'
  if (regime === 'franchise') return 'none'
  return null
}

function historyAt(company: DeadlineCompany, regimeType: 'vat' | 'corporateTax', day: string): RegimePeriod | undefined {
  return company.regimeHistory
    .filter((r) => r.regimeType === regimeType && !r.establishmentId && r.startDate <= day && (r.endDate === null || r.endDate >= day))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
}

/** The VAT regime on a day: the history row covering it, else the company fields; null when unknown. */
export function vatRegimeAt(company: DeadlineCompany, day: string): VatRegime | null {
  const period = historyAt(company, 'vat', day)
  if (period) return normalizeVat(period.regime, Boolean(period.isVatExempt))
  return normalizeVat(company.vatRegime, company.isVatExempt)
}

/**
 * The VAT return a month belongs to, the one rule shared by the calendar and
 * the VAT return worksheet (lib/vat-returns):
 * - réel normal: CA3, monthly, quarterly when the company says so (annual
 *   VAT under 4 000 €, CGI art. 287, 2);
 * - réel simplifié until 2026: the annual CA12 of the calendar year;
 * - réel simplifié from 2027: the regime is abolished, CA3 quarterly by
 *   default, monthly on request;
 * - franchise or exemption: no return ('none'); unknown regime: null.
 */
export type VatFiling = { form: 'CA3'; quarterly: boolean; afterSimplified: boolean } | { form: 'CA12' } | { form: 'none' }

export function vatFilingAt(company: DeadlineCompany, settings: Pick<DeadlineSettings, 'vatCa3Frequency'>, monthStart: string): VatFiling | null {
  const regime = vatRegimeAt(company, monthStart)
  if (regime === null) return null
  if (regime === 'none') return { form: 'none' }
  const afterSimplified = regime === 'simplified' && yearOf(monthStart) > SIMPLIFIED_VAT_LAST_YEAR
  if (regime === 'normal' || afterSimplified) {
    const quarterly = afterSimplified ? settings.vatCa3Frequency !== 'monthly' : settings.vatCa3Frequency === 'quarterly'
    return { form: 'CA3', quarterly, afterSimplified }
  }
  return { form: 'CA12' }
}

type CorporateTaxRegime = 'normal' | 'simplified'

function corporateTaxRegimeAt(company: DeadlineCompany, day: string): CorporateTaxRegime | null {
  const regime = historyAt(company, 'corporateTax', day)?.regime ?? company.corporateTaxRegime
  return regime === 'normal' || regime === 'simplified' ? regime : null
}

/** Whether the calendar lacks the VAT regime: no company field and no history row. */
export function missingVatRegime(company: DeadlineCompany): boolean {
  return normalizeVat(company.vatRegime, company.isVatExempt) === null && !company.regimeHistory.some((r) => r.regimeType === 'vat')
}

// ------------------------------------------------------------ building

interface Candidate {
  key: string
  ruleId: RuleId
  legalDate: string
  /** Postpone to the next business day (VAT, IS, CFE). */
  postpone?: boolean
  /** Bring a weekend back to the previous business day (liasse of a non-December closing). */
  bringForward?: boolean
  label: string
  form?: string
  estimated?: boolean
  condition?: string
  note?: string
  extendedDate?: string
  projected?: boolean
}

function toDeadline(c: Candidate): Deadline {
  const rule = RULES[c.ruleId]
  const date = c.postpone ? nextBusinessDay(c.legalDate) : c.bringForward ? previousBusinessDay(c.legalDate) : c.legalDate
  const deadline: Deadline = {
    id: `${c.ruleId}:${c.key}`,
    date,
    legalDate: c.legalDate,
    label: c.label,
    form: c.form ?? rule.form,
    category: rule.category,
    ruleId: rule.id,
    estimated: Boolean(c.estimated),
    projected: Boolean(c.projected),
  }
  if (c.condition) deadline.condition = c.condition
  if (c.note) deadline.note = c.note
  if (c.extendedDate) deadline.extendedDate = c.extendedDate
  return deadline
}

const ONLINE_EXTENSION_NOTE =
  "15 jours de plus en cas de télédéclaration, un délai que l'administration annonce chaque année."

interface FiscalYearSpan extends DeadlineFiscalYear {
  projected: boolean
  /** First exercice of a new company: no IS acompte (CGI art. 1668, 1). */
  first: boolean
}

/**
 * The fiscal years, then twelve-month years extrapolated after the last one
 * until the range is covered (the next exercice is often created late).
 */
function fiscalYearSpans(input: DeadlineInput): FiscalYearSpan[] {
  const sorted = [...input.fiscalYears].sort((a, b) => a.startDate.localeCompare(b.startDate))
  const foundation = input.company.foundationDate
  const spans: FiscalYearSpan[] = sorted.map((fy, index) => ({
    ...fy,
    projected: false,
    // The company's first exercice when it is the earliest known and starts with the company.
    first: index === 0 && foundation !== null && foundation >= addDays(fy.startDate, -31) && foundation <= fy.endDate,
  }))
  let last = spans[spans.length - 1]
  while (last && last.endDate < input.to && spans.length < sorted.length + 4) {
    const endDate = addMonthsEom(last.endDate, 12)
    last = { id: `projected-${endDate}`, startDate: addDays(last.endDate, 1), endDate, projected: true, first: false }
    spans.push(last)
  }
  return spans
}

const exerciceLabel = (fy: FiscalYearSpan) => `l'exercice clos le ${frDay(fy.endDate)}`

// ------------------------------------------------------------ VAT

function vatDeadlines(input: DeadlineInput): Candidate[] {
  const { company, settings } = input
  const out: Candidate[] = []
  const day = settings.vatFilingDay ?? defaultVatFilingDay(company.legalType)
  const estimated = settings.vatFilingDay === null
  const estimatedNote = estimated
    ? `Jour indicatif : le ${day} est le plus tôt possible pour cette forme juridique. Votre jour figure dans votre espace professionnel sur impots.gouv.fr ; indiquez-le dans les paramètres des échéances.`
    : undefined
  const startYear = yearOf(input.from) - 1
  const endYear = yearOf(input.to)
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 1; m <= 12; m++) {
      const periodStart = isoOf(y, m, 1)
      const filing = vatFilingAt(company, settings, periodStart)
      if (filing === null || filing.form === 'none') continue
      const [ny, nm] = shiftMonth(y, m, 1)
      const due = isoOf(ny, nm, day)
      if (filing.form === 'CA3') {
        const { quarterly, afterSimplified } = filing
        const transition = afterSimplified
          ? 'Le régime simplifié de TVA est supprimé au 1er janvier 2027 : déclaration CA3 trimestrielle par défaut, mensuelle sur demande.'
          : undefined
        const note = transition
        if (!quarterly) {
          out.push({ key: `${y}-${pad(m)}`, ruleId: 'tva-ca3', legalDate: due, postpone: true, label: `Déclaration et paiement de la TVA de ${MONTHS[m - 1]} ${y}`, estimated, note })
        } else if (m % 3 === 0) {
          out.push({
            key: `${y}-T${m / 3}`,
            ruleId: 'tva-ca3',
            legalDate: due,
            postpone: true,
            label: `Déclaration et paiement de la TVA du ${QUARTERS[m / 3 - 1]} trimestre ${y}`,
            estimated,
            condition: afterSimplified ? undefined : 'Option trimestrielle : TVA annuelle inférieure à 4 000 €.',
            note,
          })
        }
        continue
      }
      // Réel simplifié, until 2026: acomptes in July and December, CA12 after the year.
      if ((m === 7 || m === 12) && settings.vatSimplifiedAcomptes) {
        out.push({
          key: `${y}-${pad(m)}`,
          ruleId: 'tva-acompte',
          legalDate: isoOf(y, m, day),
          postpone: true,
          label: `Acompte de TVA de ${MONTHS[m - 1]} ${y} (${m === 7 ? '55' : '40'} % de la TVA de ${y - 1})`,
          estimated,
          condition: "Pas d'acompte si la TVA de l'année précédente est inférieure à 1 000 €.",
          note: estimatedNote,
        })
      }
      if (m === 12) {
        out.push({
          key: `${y}`,
          ruleId: 'tva-ca12',
          legalDate: secondBusinessDayAfterMayFirst(y + 1),
          label: `Déclaration annuelle de TVA ${y}`,
          note: y === SIMPLIFIED_VAT_LAST_YEAR ? 'Dernière CA12 : le régime simplifié de TVA est supprimé au 1er janvier 2027.' : undefined,
        })
      }
    }
  }
  return out
}

// ------------------------------------------------------------ IS and liasse

const QUARTER_MONTHS = [3, 6, 9, 12]

/** The quarterly IS due dates (the 15th of March, June, September, December) from `from` to `to`, both included. */
function quarterlyDates(from: string, to: string): string[] {
  const dates: string[] = []
  for (let y = yearOf(from); y <= yearOf(to); y++) {
    for (const m of QUARTER_MONTHS) {
      const d = isoOf(y, m, 15)
      if (d >= from && d <= to) dates.push(d)
    }
  }
  return dates
}

/**
 * The IS acomptes of an exercice (BOI-IS-DECLA-20-10 §60 to 100). The last
 * one is the latest quarterly date up to the 15th of the closing month, or
 * of the month after when the closing falls on the 20th or later (closing
 * 20/11 to 19/02: 15/03, 15/06, 15/09, 15/12; 20/02 to 19/05: 15/06, 15/09,
 * 15/12, 15/03...). An exercice pays as many acomptes as it contains
 * quarterly dates (1 March to 30 November: three, on 15/06, 15/09, 15/12).
 */
export function isAcompteDates(fy: DeadlineFiscalYear): string[] {
  const end = fy.endDate
  const [py, pm] = dayOf(end) >= 20 ? shiftMonth(yearOf(end), monthOf(end), 1) : [yearOf(end), monthOf(end)]
  const pivot = isoOf(py, pm, 15)
  const count = quarterlyDates(fy.startDate, fy.endDate).length
  const sequence = quarterlyDates(addDays(pivot, -366 * 3), pivot)
  return count === 0 ? [] : sequence.slice(-count)
}

function corporateTaxDeadlines(input: DeadlineInput, spans: FiscalYearSpan[]): Candidate[] {
  const { company, settings } = input
  const out: Candidate[] = []
  for (const fy of spans) {
    const regime = corporateTaxRegimeAt(company, fy.endDate)
    if (!regime) continue
    const projected = fy.projected
    const closingYear = yearOf(fy.endDate)
    const december = monthOf(fy.endDate) === 12 && dayOf(fy.endDate) === 31

    if (settings.isAcomptes && !fy.first) {
      isAcompteDates(fy).forEach((date, i) => {
        out.push({
          key: `${fy.endDate}:${i + 1}`,
          ruleId: 'is-acompte',
          legalDate: date,
          postpone: true,
          label: `${ORDINALS[i]} acompte d'IS de ${exerciceLabel(fy)}`,
          condition: "Si l'impôt de l'exercice de référence dépasse 3 000 €.",
          projected,
        })
      })
    }

    const [sy, sm] = december ? [closingYear + 1, 5] : shiftMonth(closingYear, monthOf(fy.endDate), 4)
    out.push({ key: fy.endDate, ruleId: 'is-solde', legalDate: isoOf(sy, sm, 15), postpone: true, label: `Solde de l'IS de ${exerciceLabel(fy)}`, projected })

    const liasseDate = december ? secondBusinessDayAfterMayFirst(closingYear + 1) : addMonthsEom(fy.endDate, 3)
    out.push({
      key: fy.endDate,
      ruleId: 'liasse',
      legalDate: liasseDate,
      bringForward: !december,
      label: `Déclaration de résultat et liasse fiscale de ${exerciceLabel(fy)}`,
      form: regime === 'simplified' ? '2065 et 2033' : '2065 et 2050',
      extendedDate: addDays(liasseDate, 15),
      note: ONLINE_EXTENSION_NOTE,
      projected,
    })

    if (settings.das2) {
      // With the results return, for the calendar year that ended before it (BOI-BIC-DECLA-30-70-20 §400).
      const coveredYear = december ? closingYear : closingYear - 1
      out.push({
        key: `${coveredYear}`,
        ruleId: 'das2',
        legalDate: liasseDate,
        bringForward: !december,
        label: `Déclaration des honoraires versés en ${coveredYear}`,
        condition: 'Si plus de 2 400 € ont été versés à un même bénéficiaire dans l\'année.',
        projected,
      })
    }
  }
  return out
}

// ------------------------------------------------------------ CVAE and CFE

function yearlyDeadlines(input: DeadlineInput): Candidate[] {
  const { company, settings } = input
  const out: Candidate[] = []
  const foundationYear = company.foundationDate ? yearOf(company.foundationDate) : null
  for (let y = yearOf(input.from) - 1; y <= yearOf(input.to); y++) {
    if (settings.cvae) {
      const date = secondBusinessDayAfterMayFirst(y + 1)
      out.push({
        key: `${y}`,
        ruleId: 'cvae',
        legalDate: date,
        label: `Déclaration de valeur ajoutée et des effectifs ${y}`,
        condition: "Chiffre d'affaires supérieur à 152 500 € hors taxes.",
        extendedDate: addDays(date, 15),
        note: ONLINE_EXTENSION_NOTE,
      })
    }
    // No CFE the year of creation (CGI art. 1478, II); no acompte without a CFE the year before.
    if (foundationYear !== null && y <= foundationYear) continue
    if (settings.cfeAcompte && (foundationYear === null || y >= foundationYear + 2)) {
      out.push({
        key: `${y}`,
        ruleId: 'cfe-acompte',
        legalDate: isoOf(y, 6, 15),
        postpone: true,
        label: `Acompte de CFE ${y}`,
        condition: "Si la CFE de l'année précédente atteignait 3 000 €.",
      })
    }
    out.push({
      key: `${y}`,
      ruleId: 'cfe',
      legalDate: isoOf(y, 12, 15),
      postpone: true,
      label: settings.cfeAcompte ? `Solde de la CFE ${y}` : `Paiement de la CFE ${y}`,
    })
  }
  return out
}

// ------------------------------------------------------------ legal

/**
 * Last day to approve the accounts: six months after the closing (C. com.
 * L223-26 SARL, L225-100 SA, L227-9 SASU; the statuts of an SAS usually say
 * the same). Shared with the approval pack (lib/approval).
 */
export function approvalDeadlineOf(endDate: string): string {
  return addMonthsEom(endDate, 6)
}

/**
 * Last day to file the approved accounts with the greffe: one month after
 * the approval, two months when filed online (C. com. L232-22, L232-23).
 */
export function filingDeadlineOf(approvalDay: string, online: boolean): string {
  return addMonthsEom(approvalDay, online ? 2 : 1)
}

function legalDeadlines(input: DeadlineInput, spans: FiscalYearSpan[]): Candidate[] {
  const { company, settings } = input
  if (company.legalType !== null && !ACCOUNTS_FILING_FORMS.has(company.legalType)) return []
  const out: Candidate[] = []
  for (const fy of spans) {
    const approval = approvalDeadlineOf(fy.endDate)
    const recorded = fy.projected ? undefined : input.approvals?.[fy.id]
    const approvedOn = recorded?.approvedOn ?? null
    out.push({
      key: fy.endDate,
      ruleId: 'approbation',
      legalDate: approval,
      label: `Approbation des comptes de ${exerciceLabel(fy)}`,
      note: approvedOn
        ? `Comptes approuvés le ${frDay(approvedOn)}.`
        : company.legalType === 'SAS'
          ? 'Dans une SAS, le délai est celui des statuts, six mois le plus souvent.'
          : company.legalType === 'SASU'
            ? "Si l'associé unique, personne physique, est le président, le dépôt au greffe des comptes signés dans ce délai vaut approbation."
            : company.legalType === 'EURL'
              ? "Si l'associé unique est le seul gérant, le dépôt au greffe des comptes signés dans ce délai vaut approbation."
              : undefined,
      projected: fy.projected,
    })
    const online = recorded?.filedOnline ?? settings.accountsFiledOnline
    const filedOn = recorded?.filedOn ?? null
    out.push({
      key: fy.endDate,
      ruleId: 'depot-comptes',
      legalDate: filingDeadlineOf(approvedOn ?? approval, online),
      label: `Dépôt des comptes de ${exerciceLabel(fy)} au greffe`,
      note: filedOn
        ? `Comptes déposés le ${frDay(filedOn)}.`
        : approvedOn
          ? online
            ? `Deux mois après l'approbation du ${frDay(approvedOn)}, pour un dépôt en ligne.`
            : `Un mois après l'approbation du ${frDay(approvedOn)} (deux mois en cas de dépôt en ligne).`
          : online
            ? "Deux mois après l'approbation pour un dépôt en ligne, comptés ici depuis la date limite d'approbation."
            : "Un mois après l'approbation (deux mois en cas de dépôt en ligne), compté ici depuis la date limite d'approbation.",
      projected: fy.projected,
    })
  }
  return out
}

// ------------------------------------------------------------ entry point

const CATEGORY_ORDER = { tva: 0, is: 1, liasse: 2, cfe: 3, juridique: 4 } as const

/** The deadlines dated from `from` to `to` (both included), in date order. */
export function computeDeadlines(input: DeadlineInput): Deadline[] {
  const spans = fiscalYearSpans(input)
  const candidates = [
    ...vatDeadlines(input),
    ...corporateTaxDeadlines(input, spans),
    ...yearlyDeadlines(input),
    ...legalDeadlines(input, spans),
  ]
  const byId = new Map<string, Deadline>()
  for (const candidate of candidates) {
    const deadline = toDeadline(candidate)
    if (deadline.date < input.from || deadline.date > input.to) continue
    const existing = byId.get(deadline.id)
    // Two short exercices closing in one year file one DAS2: the earliest wins.
    if (!existing || deadline.date < existing.date) byId.set(deadline.id, deadline)
  }
  return [...byId.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.label.localeCompare(b.label),
  )
}
