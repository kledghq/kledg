/**
 * The coefficient de déduction of a company for a calendar year
 * (docs/organisme-de-formation.md): where the revenue comes from (taxed,
 * exempt, excluded, to classify), the coefficient de taxation of the year,
 * the provisional coefficient applied during the year, the definitive one
 * and the regularisation to declare before 25 April of the following year,
 * with the line of the return and the state of its draft entry.
 *
 * Every query is scoped by the company the caller resolved.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { vatFilingAt } from '@/lib/deadlines/engine'
import { loadDeadlineContext } from '@/lib/deadlines/load-deadlines.service'
import { isTrainingOrganisation } from '@/lib/companies/nav-features'
import { calendarDayOf, formatIsoDateFr, todayUtc } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import { deductionModeOn, loadAccountSettings, provisionalCoefficientOf, taxationOf, type DeductionMode, type ProvisionalCoefficient } from './coefficient'
import type { RevenueSummary, VatTreatment } from './revenue'
import {
  COEFFICIENT_LINE,
  REGULARISATION_REFERENCE_PREFIX,
  deductionPercent,
  incurredFromDeducted,
  regularisationCents,
  regularisationDeadline,
  regularisationLine,
  regularisationReference,
} from './rules'
import { VAT_DEDUCTION_SOURCES, type VatDeductionSource } from './sources'

export const VatDeductionQuerySchema = z.object({
  year: z.coerce.number({ error: 'Année invalide' }).int('Année invalide').min(2000, 'Année invalide').max(2100, 'Année invalide').optional(),
})
export type VatDeductionQuery = z.infer<typeof VatDeductionQuerySchema>

export interface DraftState {
  reference: string
  status: 'none' | 'draft' | 'validated'
  entryId: string | null
  entryNumber: string | null
}

export interface VatDeductionView {
  today: string
  year: number
  years: number[]
  mode: DeductionMode
  partialVatDeduction: boolean
  isVatExempt: boolean
  trainingOrganisation: boolean
  revenue: RevenueSummary
  /** The year is over: its coefficient de taxation is definitive. */
  yearClosed: boolean
  /** Coefficient de taxation of the year's revenue (to date while the year runs). */
  taxationPercent: number | null
  provisional: ProvisionalCoefficient
  /** Definitive coefficient de déduction of the year (rounded up product), null without turnover. */
  definitiveDeductionPercent: number | null
  /** The line where the coefficient de taxation is written on the return (22A or 25A). */
  coefficientLine: string | null
  regularisation: {
    /** VAT deducted in the year on 44562 and 44566 (settlements and regularisations aside). */
    deductedCents: number
    incurredCents: number | null
    incurredSource: 'entered' | 'books' | null
    amountCents: number | null
    form: 'CA3' | 'CA12' | null
    line: { code: string; box: string; label: string } | null
    deadline: string
    /** Day of the draft: 31 March of the following year, in the return filed in April. */
    entryDate: string
    draft: DraftState
  }
  settings: { estimatedTaxationPercent: number | null; assujettissementPercent: number; incurredVatCents: number | null; note: string | null }
  accountSettings: Array<{ accountCode: string; vatTreatment: VatTreatment | null }>
  hints: string[]
  sources: VatDeductionSource[]
}

const day = (value: Date) => calendarDayOf(value) as string
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** VAT deducted on 44562 and 44566 between two days: validated entries, balances, settlements and regularisations aside. */
export async function deductedVatOf(companyId: string, from: string, to: string): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ cents: bigint | null }>>`
    SELECT round(sum(l."debit" - l."credit") * 100)::bigint AS cents
    FROM "entry_lines" l
    JOIN "accounting_entries" e ON e."id" = l."accountingEntryId"
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId} AND e."status" = 'validated' AND e."date" >= ${utc(from)} AND e."date" <= ${utc(to)}
      AND (a."code" LIKE '44562%' OR a."code" LIKE '44566%' OR a."code" = '4456')
      AND j."code" NOT IN ('AN', 'CL')
      AND coalesce(e."reference", '') NOT LIKE 'TVA-%' AND coalesce(e."reference", '') NOT LIKE ${`${REGULARISATION_REFERENCE_PREFIX}%`} AND coalesce(e."reference", '') NOT LIKE 'CL-%'
  `
  return Number(row?.cents ?? 0)
}

async function draftState(companyId: string, reference: string): Promise<DraftState> {
  const entry = await prisma.accountingEntry.findFirst({ where: { companyId, reference }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, entryNumber: true } })
  return { reference, status: entry ? (entry.status === 'validated' ? 'validated' : 'draft') : 'none', entryId: entry?.id ?? null, entryNumber: entry?.entryNumber ?? null }
}

export async function loadVatDeduction(companyId: string, query: VatDeductionQuery, options: { now?: Date } = {}): Promise<VatDeductionView> {
  const today = day(todayUtc(options.now))
  const currentYear = Number(today.slice(0, 4))
  const year = query.year ?? (today <= `${currentYear}-04-24` ? currentYear - 1 : currentYear)
  const yearEnd = `${year}-12-31`
  const yearClosed = today > yearEnd
  const asOf = yearClosed ? yearEnd : today

  const [company, row, accountSettings, context, training, { mode }] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { isVatExempt: true, partialVatDeduction: true } }),
    prisma.vatDeductionYear.findUnique({
      where: { companyId_year: { companyId, year } },
      select: { estimatedTaxationPercent: true, assujettissementPercent: true, incurredVat: true, note: true, coefficientChangedOn: true },
    }),
    loadAccountSettings(companyId),
    loadDeadlineContext(companyId),
    isTrainingOrganisation(companyId),
    deductionModeOn(companyId, asOf),
  ])
  const [taxation, provisional, deductedCents, draft] = await Promise.all([
    taxationOf(companyId, `${year}-01-01`, asOf, accountSettings),
    provisionalCoefficientOf(companyId, year, asOf, accountSettings),
    deductedVatOf(companyId, `${year}-01-01`, yearEnd),
    draftState(companyId, regularisationReference(year)),
  ])

  const assujettissement = row?.assujettissementPercent ?? 100
  const definitive = taxation.percent === null ? null : deductionPercent(assujettissement, taxation.percent)
  const entered = row?.incurredVat === null || row?.incurredVat === undefined ? null : parseCents(row.incurredVat.toString())
  // The VAT borne reads back from the VAT deducted only when one coefficient applied all year: the
  // definitive one of the year before, or an estimate set before any deduction (not the books to date,
  // which move with every sale, nor a coefficient changed during the year)
  const constantApplied = provisional.source !== 'books-to-date' && !row?.coefficientChangedOn
  const derived = constantApplied ? incurredFromDeducted(deductedCents, provisional.deductionPercent) : null
  const incurredCents = entered ?? derived
  // CGI ann. II art. 207, I; BOI-TVA-DED-20-10-40, example 3: definitive x VAT borne - VAT deducted
  const amountCents = mode === 'coefficient' && definitive !== null && incurredCents !== null ? regularisationCents(incurredCents, deductedCents, definitive) : null
  const filing = vatFilingAt(context.company, context.settings, `${year + 1}-03-01`)
  const form = filing && filing.form !== 'none' ? filing.form : null

  const hints: string[] = []
  if (mode === 'full' && training) {
    hints.push('Un établissement est un organisme de formation : si la société réalise aussi des opérations taxées, activez la déduction par coefficient. Sa formation exonérée (CGI, art. 261, 4, 4° a) ne donne pas droit à déduction.')
  }
  if (mode === 'franchise') hints.push('Franchise en base (CGI, art. 293 B) : la société ne déduit aucune TVA.')
  if (taxation.revenue.toClassifyCents > 0) {
    hints.push('Des ventes sans TVA ni exonération sont à classer : comptées comme exonérées en attendant. Marquez les exportations et livraisons intracommunautaires comme ouvrant droit à déduction.')
  }
  if (provisional.source === 'books-to-date') {
    hints.push(`Pas de coefficient définitif pour ${year - 1} : saisissez l’estimation du coefficient de taxation de ${year}. En attendant, Kledg applique celui des comptes de l’année à ce jour.`)
  }
  if (mode === 'coefficient' && entered === null) {
    if (!constantApplied) {
      hints.push(
        row?.coefficientChangedOn
          ? `Le coefficient appliqué a changé le ${formatIsoDateFr(day(row.coefficientChangedOn))} après des déductions de l’année : Kledg ne peut pas retrouver la TVA supportée dans les comptes, saisissez-la pour calculer la régularisation.`
          : 'Le coefficient appliqué a suivi les comptes de l’année au fil des écritures : Kledg ne peut pas retrouver la TVA supportée dans les comptes, saisissez-la pour calculer la régularisation.',
      )
    } else if (provisional.deductionPercent === 0) {
      hints.push('Avec un coefficient provisoire de 0 %, Kledg ne peut pas retrouver la TVA supportée dans les comptes : saisissez-la pour calculer la régularisation.')
    }
  }
  if (form === 'CA12') {
    hints.push('Au régime simplifié, aucun texte consulté ne dit sur quelle CA12 porter la régularisation due avant le 25 avril : vérifiez avec votre service des impôts.')
  }

  const firstYear = Math.min(...context.fiscalYears.map((fy) => Number(fy.startDate.slice(0, 4))), currentYear)
  const years = Array.from({ length: currentYear - Math.min(firstYear, year) + 1 }, (_, i) => Math.min(firstYear, year) + i).reverse()

  const S = VAT_DEDUCTION_SOURCES
  return {
    today,
    year,
    years,
    mode,
    partialVatDeduction: company?.partialVatDeduction ?? false,
    isVatExempt: company?.isVatExempt ?? false,
    trainingOrganisation: training,
    revenue: taxation.revenue,
    yearClosed,
    taxationPercent: taxation.percent,
    provisional,
    definitiveDeductionPercent: definitive,
    coefficientLine: form ? COEFFICIENT_LINE[form] : null,
    regularisation: {
      deductedCents,
      incurredCents,
      incurredSource: entered !== null ? 'entered' : derived !== null ? 'books' : null,
      amountCents,
      form,
      line: form && amountCents !== null && amountCents !== 0 ? regularisationLine(form, amountCents) : null,
      deadline: regularisationDeadline(year),
      entryDate: `${year + 1}-03-31`,
      draft,
    },
    settings: {
      estimatedTaxationPercent: row?.estimatedTaxationPercent ?? null,
      assujettissementPercent: assujettissement,
      incurredVatCents: entered,
      note: row?.note ?? null,
    },
    accountSettings: accountSettings.filter((s) => s.vatTreatment !== null).map((s) => ({ accountCode: s.accountCode, vatTreatment: s.vatTreatment })),
    hints,
    sources: [S.ann2art205, S.ann2art206, S.ann2art207, S.ann2art209, S.cgi261, S.cgi293B, S.bofipDed10, S.bofipTaxation, S.bofipRounding, S.bofipRegularisation, S.bofipTraining, S.ca3Notice, S.ca12Notice],
  }
}
