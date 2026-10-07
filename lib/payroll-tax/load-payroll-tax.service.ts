/**
 * The taxe sur les salaires of a calendar year (docs/organisme-de-formation.md):
 * liability and rapport d'assujettissement from the revenue of the year
 * before (the reading of the coefficient de taxation, lib/vat-deduction),
 * the computation of the 2502 from the annual base of each employee the
 * user entered, the salaries of the books as a check, the frequency of the
 * relevés from the tax of the year before, the deadlines and the draft.
 * Kledg prepares; the employer files and pays on impots.gouv.fr.
 *
 * Every query is scoped by the company the caller resolved.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { deductionModeOn, taxationOf } from '@/lib/vat-deduction/coefficient'
import { parsePayrollTaxData, type PayrollTaxComputed, type PayrollTaxData } from './schemas'
import {
  annualDeclarationDate,
  appliedRatio,
  computePayrollTax,
  frequencyOf,
  isLiable,
  payrollTaxReference,
  releveDates,
  PAYROLL_TAX_YEARS,
  type PayrollTaxComputation,
  type PayrollTaxFrequency,
} from './rules'
import { PAYROLL_TAX_SOURCES, type PayrollTaxSource } from './sources'

export const PayrollTaxQuerySchema = z.object({
  year: z.coerce.number({ error: 'Année invalide' }).int('Année invalide').min(2000, 'Année invalide').max(2100, 'Année invalide').optional(),
})
export type PayrollTaxQuery = z.infer<typeof PayrollTaxQuerySchema>

export type Liability = 'liable' | 'not-liable' | 'franchise' | 'unknown'

export interface PayrollTaxView {
  today: string
  year: number
  years: number[]
  /** The barème of the year is known to Kledg (2025 and 2026). */
  covered: boolean
  data: PayrollTaxData
  /** Revenue of the year before, as the rapport reads it. */
  reference: { year: number; nonDeductibleCents: number; totalCents: number; toClassifyCents: number }
  ratio: { source: 'books' | 'entered' | 'none'; exactBasisPoints: number | null; truncatedPercent: number | null; appliedPercent: number }
  liability: Liability
  computation: PayrollTaxComputation | null
  /** Gross salaries of the year in the books (641 and 644), to check the bases entered. */
  booksSalariesCents: number
  enteredBasesCents: number
  previous: { taxCents: number | null; source: 'kledg' | 'entered' | 'none' }
  frequency: PayrollTaxFrequency
  schedule: Array<{ key: string; label: string; date: string; extendedDate?: string }>
  draft: { reference: string; status: 'none' | 'draft' | 'validated'; entryId: string | null; entryNumber: string | null }
  hints: string[]
  sources: PayrollTaxSource[]
}

const day = (value: Date) => calendarDayOf(value) as string
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

async function salariesOf(companyId: string, year: number): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ cents: bigint | null }>>`
    SELECT round(sum(l."debit" - l."credit") * 100)::bigint AS cents
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId} AND e."status" = 'validated' AND e."date" >= ${utc(`${year}-01-01`)} AND e."date" <= ${utc(`${year}-12-31`)}
      AND (a."code" LIKE '641%' OR a."code" LIKE '644%') AND j."code" NOT IN ('AN', 'CL')
  `
  return Number(row?.cents ?? 0)
}

interface YearCore {
  liability: Liability
  ratio: PayrollTaxView['ratio']
  reference: PayrollTaxView['reference']
  computation: PayrollTaxComputation | null
}

/** Liability, rapport and tax of a year from its data and the revenue of the year before. */
async function coreOf(companyId: string, year: number, data: PayrollTaxData): Promise<YearCore> {
  const [{ revenue }, { mode }] = await Promise.all([taxationOf(companyId, `${year - 1}-01-01`, `${year - 1}-12-31`), deductionModeOn(companyId, `${year - 1}-12-31`)])
  const nonDeductible = revenue.exemptCents + revenue.toClassifyCents
  const total = revenue.denominatorCents
  const reference = { year: year - 1, nonDeductibleCents: nonDeductible, totalCents: total, toClassifyCents: revenue.toClassifyCents }
  const fromBooks = appliedRatio(nonDeductible, total)
  let ratio: PayrollTaxView['ratio']
  let liability: Liability
  if (mode === 'franchise') {
    // Art. 231, 1, second alinéa: turnover within the franchise limits of art. 293 B, not liable.
    ratio = { source: 'none', exactBasisPoints: null, truncatedPercent: null, appliedPercent: 0 }
    liability = 'franchise'
  } else if (data.ratioPercent !== null) {
    // Entered with its decimals: 10,4 % is above 10 %, liable (CGI art. 231, 1), whatever the rapport's rounding
    const basisPoints = Math.round(data.ratioPercent * 100)
    ratio = { source: 'entered', ...appliedRatio(basisPoints, 10_000)! }
    liability = isLiable(basisPoints, 10_000) ? 'liable' : 'not-liable'
  } else if (fromBooks) {
    ratio = { source: 'books', ...fromBooks }
    liability = isLiable(nonDeductible, total) ? 'liable' : 'not-liable'
  } else {
    ratio = { source: 'none', exactBasisPoints: null, truncatedPercent: null, appliedPercent: 0 }
    liability = 'unknown'
  }
  const rules = PAYROLL_TAX_YEARS[year]
  const computation =
    rules && liability === 'liable' ? computePayrollTax({ rules, employeeBasesCents: data.employees.map((e) => e.baseCents), ratioPercent: ratio.appliedPercent, association: data.association }) : null
  return { liability, ratio, reference, computation }
}

/** What the deadline calendar reads, written with the year's data (schemas.ts). */
export function computedOf(core: YearCore, frequency: PayrollTaxFrequency): PayrollTaxComputed {
  return { liable: core.liability === 'liable', frequency, dueCents: core.computation?.dueCents ?? 0 }
}

export async function buildPayrollTax(companyId: string, query: PayrollTaxQuery, options: { now?: Date } = {}): Promise<{ view: PayrollTaxView; core: YearCore }> {
  const today = day(todayUtc(options.now))
  const currentYear = Number(today.slice(0, 4))
  const year = query.year ?? currentYear
  const rows = await prisma.payrollTaxYear.findMany({ where: { companyId, year: { in: [year - 1, year] } }, select: { year: true, data: true }, take: 2 })
  const data = parsePayrollTaxData(rows.find((r) => r.year === year)?.data)
  const previousData = rows.find((r) => r.year === year - 1) ? parsePayrollTaxData(rows.find((r) => r.year === year - 1)!.data) : null

  const [core, previousCore, booksSalariesCents, entry, fiscalYears] = await Promise.all([
    coreOf(companyId, year, data),
    previousData && previousData.employees.length > 0 && PAYROLL_TAX_YEARS[year - 1] ? coreOf(companyId, year - 1, previousData) : Promise.resolve(null),
    salariesOf(companyId, year),
    prisma.accountingEntry.findFirst({ where: { companyId, reference: payrollTaxReference(year) }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, entryNumber: true } }),
    prisma.fiscalYear.findMany({ where: { companyId }, select: { startDate: true }, orderBy: { startDate: 'asc' }, take: 1 }),
  ])

  const previous: PayrollTaxView['previous'] = previousCore
    ? { taxCents: previousCore.computation?.dueCents ?? 0, source: 'kledg' }
    : data.previousYearTaxCents !== null
      ? { taxCents: data.previousYearTaxCents, source: 'entered' }
      : { taxCents: null, source: 'none' }
  const frequency = frequencyOf(previous.taxCents ?? 0)
  const liable = core.liability === 'liable'
  const declaration = annualDeclarationDate(year)
  const schedule = liable
    ? [
        ...releveDates(year, frequency).map((r) => ({
          key: r.key,
          label: r.period.includes('T') ? `Relevé 2501 du ${r.period.slice(-1)}${r.period.endsWith('1') ? 'er' : 'e'} trimestre ${year}` : `Relevé 2501 de ${MONTHS[Number(r.period.slice(5)) - 1]} ${year}`,
          date: r.date,
        })),
        { key: `${year}`, label: `Déclaration annuelle 2502 des salaires ${year}`, date: declaration.date, extendedDate: declaration.extendedDate },
      ]
    : []

  const hints: string[] = []
  if (!PAYROLL_TAX_YEARS[year]) hints.push(`Le barème ${year} (seuils des tranches, abattement) n’est pas encore dans Kledg : seules les années 2025 et 2026 sont calculées.`)
  if (core.liability === 'liable' && data.employees.length === 0) {
    hints.push('Les comptes donnent le total des salaires, pas la base annuelle de chaque salarié : saisissez-la (rémunérations retenues pour la CSG, sans l’abattement de 1,75 %), les tranches s’appliquent salarié par salarié.')
  }
  if (core.reference.toClassifyCents > 0 && core.ratio.source === 'books') {
    hints.push(`Des ventes ${year - 1} sans TVA ni exonération sont comptées sans droit à déduction : classez-les sur la page Coefficient de déduction de TVA (une exportation ouvre droit à déduction).`)
  }
  if (core.ratio.source === 'books') {
    hints.push('Les recettes hors du champ de la TVA (indemnités, dividendes...) entrent au dénominateur du rapport et ne sont pas lues dans les comptes : saisissez le rapport si vous en avez.')
  }
  if (core.liability === 'unknown') hints.push(`Aucune recette en ${year - 1} : pour une première année, saisissez le rapport estimé de l’année.`)
  if (data.employees.length > 0 && booksSalariesCents > 0 && data.employees.reduce((s, e) => s + e.baseCents, 0) < booksSalariesCents) {
    hints.push('Les bases saisies sont inférieures aux salaires bruts des comptes 641 et 644 : vérifiez qu’aucun salarié ne manque (les avantages en nature s’ajoutent à la base).')
  }

  const firstYear = Math.min(fiscalYears[0] ? Number(day(fiscalYears[0].startDate).slice(0, 4)) : currentYear, currentYear)
  const years = Array.from({ length: Math.max(currentYear, year) - Math.min(firstYear, year) + 1 }, (_, i) => Math.min(firstYear, year) + i).reverse()

  const view: PayrollTaxView = {
    today,
    year,
    years,
    covered: Boolean(PAYROLL_TAX_YEARS[year]),
    data,
    reference: core.reference,
    ratio: core.ratio,
    liability: core.liability,
    computation: core.computation,
    booksSalariesCents,
    enteredBasesCents: data.employees.reduce((s, e) => s + e.baseCents, 0),
    previous,
    frequency,
    schedule,
    draft: {
      reference: payrollTaxReference(year),
      status: entry ? (entry.status === 'validated' ? 'validated' : 'draft') : 'none',
      entryId: entry?.id ?? null,
      entryNumber: entry?.entryNumber ?? null,
    },
    hints,
    sources: Object.values(PAYROLL_TAX_SOURCES),
  }
  return { view, core }
}

export async function loadPayrollTax(companyId: string, query: PayrollTaxQuery, options: { now?: Date } = {}): Promise<PayrollTaxView> {
  return (await buildPayrollTax(companyId, query, options)).view
}
