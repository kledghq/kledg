/**
 * Budgets of the fiscal years (docs/budget.md): one budget per fiscal year,
 * lines on class 6 and 7 account prefixes, amounts entered per month and
 * recurring items, all in cents.
 *
 * Invariants owned here (the database repeats the structural ones):
 * - a budget belongs to the company of its fiscal year (composite foreign
 *   key in the migration 20261023090000_budgets), every lookup is scoped by
 *   company;
 * - the budget of a closed fiscal year no longer changes: it is what the
 *   year was compared with (409, like the books of a closed year,
 *   PCG art. 1031-4);
 * - writes on a budget run under its row lock, so two concurrent edits
 *   cannot both pass the line count or the prefix uniqueness check;
 * - amounts are entered for months of the fiscal year only; a recurring item
 *   must fall due at least once in it.
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { PCG_ACCOUNTS } from '@/lib/accounting/pcg-data'
import { writeAuditLog } from '@/lib/audit'
import { optionalText } from '@/lib/api/zod-fields'
import { calendarDayOf } from '@/lib/utils/date'
import { centsToDecimal, toCents } from '@/lib/utils/money'
import { fiscalYearMonths, isMonthKey, type MonthKey } from './months'
import { BUDGET_FREQUENCIES, fallsDueIn, plannedByMonth, type BudgetFrequency } from './recurring'
import { ACCOUNT_PREFIX, sideOfAccount, type BudgetSide } from './prefixes'

export const BUDGET_NOT_FOUND = 'Budget introuvable'
export const BUDGET_LINE_NOT_FOUND = 'Ligne de budget introuvable'
const FISCAL_YEAR_NOT_FOUND = 'Exercice introuvable'

/** Bounds that keep one budget reasonable and every sum exact in a JS number. */
export const MAX_BUDGET_LINES = 300
const MAX_RECURRING_ITEMS = 50
/** 10 billion euros per amount, in cents. */
const MAX_AMOUNT_CENTS = 1_000_000_000_000

/** Lines created by the "posts" template: the posts of the dashboard's charges by post, and sales. */
const TEMPLATE_POSTS = ['60', '61', '62', '63', '64', '65', '70'] as const

// ---------------------------------------------------------------------------
// Input schemas (route `body` options and MCP)

const cents = z
  .number({ error: 'Montant invalide' })
  .int('Montant en centimes entiers')
  .min(-MAX_AMOUNT_CENTS, 'Montant trop élevé')
  .max(MAX_AMOUNT_CENTS, 'Montant trop élevé')

const month = z.string({ error: 'Mois invalide' }).refine(isMonthKey, 'Mois invalide : AAAA-MM')

const RecurringItemSchema = z
  .object({
    label: z.string({ error: 'Le libellé est requis' }).trim().min(1, 'Le libellé est requis').max(120, '120 caractères au maximum'),
    amountCents: cents,
    frequency: z.enum(BUDGET_FREQUENCIES, { error: 'Fréquence inconnue : MONTHLY, QUARTERLY ou YEARLY' }),
    startMonth: month,
    endMonth: month.nullable().optional(),
  })
  .refine((item) => !item.endMonth || item.endMonth >= item.startMonth, { message: 'Le dernier mois précède le premier', path: ['endMonth'] })

const LineFields = {
  accountPrefix: z
    .string({ error: 'Le compte est requis' })
    .trim()
    .regex(ACCOUNT_PREFIX, 'Saisissez un compte ou un début de compte de charges (classe 6) ou de produits (classe 7), par exemple 606 ou 706'),
  label: optionalText(120),
  amounts: z.array(z.object({ month, amountCents: cents }), { error: 'Montants invalides' }).max(36, '36 mois au maximum').optional(),
  recurringItems: z.array(RecurringItemSchema, { error: 'Éléments récurrents invalides' }).max(MAX_RECURRING_ITEMS, `${MAX_RECURRING_ITEMS} éléments récurrents au maximum`).optional(),
}

/** Body of POST /api/budgets/[id]/lines. */
export const CreateBudgetLineBodySchema = z.object(LineFields)
export type CreateBudgetLineInput = z.infer<typeof CreateBudgetLineBodySchema>

/** Body of PATCH /api/budget-lines/[id]: given amounts and recurring items replace the line's. */
export const UpdateBudgetLineBodySchema = z.object(LineFields).partial()
export type UpdateBudgetLineInput = z.infer<typeof UpdateBudgetLineBodySchema>

/** Body of POST /api/budgets. */
export const CreateBudgetBodySchema = z.object({
  fiscalYearId: z.string({ error: "L'exercice est requis" }).min(1, "L'exercice est requis"),
  template: z.enum(['empty', 'posts'], { error: 'Modèle inconnu : empty ou posts' }).default('empty'),
})
export type CreateBudgetInput = z.infer<typeof CreateBudgetBodySchema>

// ---------------------------------------------------------------------------
// Shapes returned to the routes, the page and the MCP tools

export interface BudgetFiscalYear {
  id: string
  year: number
  startDate: string
  endDate: string
  isClosed: boolean
}

export interface BudgetRecurringItemView {
  id: string
  label: string
  amountCents: number
  frequency: BudgetFrequency
  startMonth: MonthKey
  endMonth: MonthKey | null
}

export interface BudgetLineView {
  id: string
  accountPrefix: string
  label: string
  side: BudgetSide
  /** Amounts entered per month (months of the fiscal year only, zero months omitted). */
  amounts: Array<{ month: MonthKey; amountCents: number }>
  recurringItems: BudgetRecurringItemView[]
  /** Planned cents per month (entered plus recurring), aligned with the budget's months. */
  plannedMonths: number[]
  annualCents: number
}

export interface BudgetTotals {
  chargesCents: number
  produitsCents: number
  /** Produits minus charges. */
  resultatCents: number
}

export interface BudgetSummary extends BudgetTotals {
  id: string
  fiscalYear: BudgetFiscalYear
  lineCount: number
}

export interface BudgetDetail extends BudgetSummary {
  months: MonthKey[]
  /** False once the fiscal year is closed. */
  editable: boolean
  lines: BudgetLineView[]
}

const FISCAL_YEAR_SELECT = { id: true, year: true, startDate: true, endDate: true, isClosed: true } as const

const BUDGET_INCLUDE = {
  fiscalYear: { select: FISCAL_YEAR_SELECT },
  lines: {
    orderBy: { accountPrefix: 'asc' },
    include: { amounts: { orderBy: { month: 'asc' } }, recurringItems: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
  },
} as const satisfies Prisma.BudgetInclude

type BudgetRow = Prisma.BudgetGetPayload<{ include: typeof BUDGET_INCLUDE }>
type FiscalYearRow = BudgetRow['fiscalYear']

function requireCents(value: Prisma.Decimal): number {
  const amount = toCents(value)
  if (amount === null) throw new RangeError(`Invalid budget amount: ${value.toString()}`)
  return amount
}

function fiscalYearView(fy: FiscalYearRow): BudgetFiscalYear {
  return { id: fy.id, year: fy.year, startDate: calendarDayOf(fy.startDate) as string, endDate: calendarDayOf(fy.endDate) as string, isClosed: fy.isClosed }
}

export function monthsOfFiscalYear(fy: { startDate: Date; endDate: Date }): MonthKey[] {
  return fiscalYearMonths(calendarDayOf(fy.startDate) as string, calendarDayOf(fy.endDate) as string)
}

function lineView(line: BudgetRow['lines'][number], months: readonly MonthKey[]): BudgetLineView {
  const inYear = new Set(months)
  const amounts = line.amounts.map((a) => ({ month: a.month, amountCents: requireCents(a.amount) })).filter((a) => inYear.has(a.month) && a.amountCents !== 0)
  const recurringItems = line.recurringItems.map((item) => ({
    id: item.id,
    label: item.label,
    amountCents: requireCents(item.amount),
    frequency: item.frequency,
    startMonth: item.startMonth,
    endMonth: item.endMonth,
  }))
  const plannedMonths = plannedByMonth(months, amounts, recurringItems)
  return {
    id: line.id,
    accountPrefix: line.accountPrefix,
    label: line.label,
    side: sideOfAccount(line.accountPrefix) as BudgetSide,
    amounts,
    recurringItems,
    plannedMonths,
    annualCents: plannedMonths.reduce((sum, c) => sum + c, 0),
  }
}

function totalsOf(lines: readonly BudgetLineView[]): BudgetTotals {
  const side = (s: BudgetSide) => lines.filter((l) => l.side === s).reduce((sum, l) => sum + l.annualCents, 0)
  const chargesCents = side('charges')
  const produitsCents = side('produits')
  return { chargesCents, produitsCents, resultatCents: produitsCents - chargesCents }
}

function detailOf(budget: BudgetRow): BudgetDetail {
  const months = monthsOfFiscalYear(budget.fiscalYear)
  const lines = budget.lines.map((l) => lineView(l, months))
  return {
    id: budget.id,
    fiscalYear: fiscalYearView(budget.fiscalYear),
    lineCount: lines.length,
    ...totalsOf(lines),
    months,
    editable: !budget.fiscalYear.isClosed,
    lines,
  }
}

// ---------------------------------------------------------------------------
// Reads

/** Budgets of the company, latest fiscal year first, with their annual totals. */
export async function listBudgets(companyId: string): Promise<{ items: BudgetSummary[] }> {
  const budgets = await prisma.budget.findMany({
    where: { companyId },
    include: BUDGET_INCLUDE,
    orderBy: { fiscalYear: { startDate: 'desc' } },
    take: 100,
  })
  return {
    items: budgets.map((b) => {
      const { id, fiscalYear, lineCount, chargesCents, produitsCents, resultatCents } = detailOf(b)
      return { id, fiscalYear, lineCount, chargesCents, produitsCents, resultatCents }
    }),
  }
}

export async function getBudget(companyId: string, budgetId: string): Promise<BudgetDetail> {
  const budget = await prisma.budget.findFirst({ where: { id: budgetId, companyId }, include: BUDGET_INCLUDE })
  if (!budget) throw new NotFoundError(BUDGET_NOT_FOUND)
  return detailOf(budget)
}

/** The budget of a fiscal year of the company, or null when it has none. */
export async function findBudgetOfFiscalYear(companyId: string, fiscalYearId: string): Promise<BudgetDetail | null> {
  const budget = await prisma.budget.findFirst({ where: { fiscalYearId, companyId }, include: BUDGET_INCLUDE })
  return budget ? detailOf(budget) : null
}

// ---------------------------------------------------------------------------
// Writes

type Tx = Prisma.TransactionClient

function assertOpen(fy: { year: number; isClosed: boolean }) {
  if (fy.isClosed) {
    throw new ConflictError(`L'exercice ${fy.year} est clôturé : son budget ne se modifie plus.`)
  }
}

/** Locks the budget row, then reads it with its fiscal year: 404 for another company's budget, 409 in a closed year. */
async function lockOpenBudget(tx: Tx, companyId: string, budgetId: string) {
  await tx.$queryRaw`SELECT 1 FROM "budgets" WHERE "id" = ${budgetId} AND "companyId" = ${companyId} FOR UPDATE`
  const budget = await tx.budget.findFirst({ where: { id: budgetId, companyId }, select: { id: true, fiscalYearId: true, fiscalYear: { select: FISCAL_YEAR_SELECT } } })
  if (!budget) throw new NotFoundError(BUDGET_NOT_FOUND)
  assertOpen(budget.fiscalYear)
  return budget
}

/** Label of the account in the company's chart of that year, else of the closest PCG account (PCG 2026 list). */
async function defaultLabel(tx: Tx, companyId: string, fiscalYearId: string, prefix: string): Promise<string> {
  const own = await tx.account.findFirst({ where: { companyId, fiscalYearId, code: prefix }, select: { label: true } })
  if (own) return own.label
  for (let length = prefix.length; length > 0; length--) {
    const pcg = PCG_ACCOUNTS.find((a) => a.code === prefix.slice(0, length))
    if (pcg) return pcg.label
  }
  return prefix
}

/** Checks the months and recurring items of a line against the fiscal year; returns the rows to write. */
function linePlan(input: Pick<CreateBudgetLineInput, 'amounts' | 'recurringItems'>, months: readonly MonthKey[], year: number) {
  const inYear = new Set(months)
  const seen = new Set<string>()
  const amounts: Array<{ month: MonthKey; amount: string }> = []
  for (const a of input.amounts ?? []) {
    if (!inYear.has(a.month)) throw new ValidationError(`Le mois ${a.month} n'est pas dans l'exercice ${year}.`)
    if (seen.has(a.month)) throw new ValidationError(`Le mois ${a.month} est saisi deux fois.`)
    seen.add(a.month)
    if (a.amountCents !== 0) amounts.push({ month: a.month, amount: centsToDecimal(a.amountCents) })
  }
  const items = (input.recurringItems ?? []).map((item, position) => {
    const recurring = { amountCents: item.amountCents, frequency: item.frequency, startMonth: item.startMonth, endMonth: item.endMonth ?? null }
    if (!months.some((m) => fallsDueIn(recurring, m))) {
      throw new ValidationError(`« ${item.label} » ne tombe dans aucun mois de l'exercice ${year} : vérifiez son premier et son dernier mois.`)
    }
    return { label: item.label, amount: centsToDecimal(item.amountCents), frequency: item.frequency, startMonth: item.startMonth, endMonth: item.endMonth ?? null, position }
  })
  return { amounts, items }
}

async function assertPrefixFree(tx: Tx, budgetId: string, prefix: string, exceptLineId?: string) {
  const taken = await tx.budgetLine.findFirst({ where: { budgetId, accountPrefix: prefix, ...(exceptLineId ? { id: { not: exceptLineId } } : {}) }, select: { id: true } })
  if (taken) throw new ConflictError(`Le budget a déjà une ligne sur le compte ${prefix} : modifiez-la.`)
}

/** Creates the budget of a fiscal year of the company, empty or with one line per main post. */
export async function createBudget(companyId: string, input: CreateBudgetInput): Promise<BudgetDetail> {
  const budgetId = await prisma.$transaction(async (tx) => {
    const fiscalYear = await tx.fiscalYear.findFirst({ where: { id: input.fiscalYearId, companyId }, select: FISCAL_YEAR_SELECT })
    if (!fiscalYear) throw new NotFoundError(FISCAL_YEAR_NOT_FOUND)
    assertOpen(fiscalYear)
    // Serializes two creations for the same year (the unique index would refuse the second with a generic message).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:budget:${fiscalYear.id}`}))`
    const existing = await tx.budget.findFirst({ where: { fiscalYearId: fiscalYear.id, companyId }, select: { id: true } })
    if (existing) throw new ConflictError(`L'exercice ${fiscalYear.year} a déjà un budget.`)
    const budget = await tx.budget.create({ data: { companyId, fiscalYearId: fiscalYear.id }, select: { id: true } })
    if (input.template === 'posts') {
      const lines = []
      for (const prefix of TEMPLATE_POSTS) lines.push({ budgetId: budget.id, accountPrefix: prefix, label: await defaultLabel(tx, companyId, fiscalYear.id, prefix) })
      await tx.budgetLine.createMany({ data: lines })
    }
    return budget.id
  })
  await writeAuditLog('info', 'Budget created', { action: 'CREATE_BUDGET', companyId, metadata: { budgetId, fiscalYearId: input.fiscalYearId, template: input.template } })
  return getBudget(companyId, budgetId)
}

export async function deleteBudget(companyId: string, budgetId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockOpenBudget(tx, companyId, budgetId)
    await tx.budget.delete({ where: { id: budgetId } })
  })
  await writeAuditLog('info', 'Budget deleted', { action: 'DELETE_BUDGET', companyId, metadata: { budgetId } })
}

export async function createBudgetLine(companyId: string, budgetId: string, input: CreateBudgetLineInput): Promise<BudgetLineView> {
  const lineId = await prisma.$transaction(async (tx) => {
    const budget = await lockOpenBudget(tx, companyId, budgetId)
    if ((await tx.budgetLine.count({ where: { budgetId } })) >= MAX_BUDGET_LINES) {
      throw new ConflictError(`Un budget compte ${MAX_BUDGET_LINES} lignes au plus : regroupez des comptes sous un préfixe plus court.`)
    }
    await assertPrefixFree(tx, budgetId, input.accountPrefix)
    const plan = linePlan(input, monthsOfFiscalYear(budget.fiscalYear), budget.fiscalYear.year)
    const line = await tx.budgetLine.create({
      data: {
        budgetId,
        accountPrefix: input.accountPrefix,
        label: input.label ?? (await defaultLabel(tx, companyId, budget.fiscalYearId, input.accountPrefix)),
        amounts: { createMany: { data: plan.amounts } },
        recurringItems: { createMany: { data: plan.items } },
      },
      select: { id: true },
    })
    return line.id
  })
  return getLine(companyId, lineId)
}

export async function updateBudgetLine(companyId: string, lineId: string, input: UpdateBudgetLineInput): Promise<BudgetLineView> {
  await prisma.$transaction(async (tx) => {
    const found = await tx.budgetLine.findFirst({ where: { id: lineId, budget: { companyId } }, select: { budgetId: true } })
    if (!found) throw new NotFoundError(BUDGET_LINE_NOT_FOUND)
    const budget = await lockOpenBudget(tx, companyId, found.budgetId)
    // Read again under the budget's lock: a concurrent edit may have changed it.
    const line = await tx.budgetLine.findUniqueOrThrow({ where: { id: lineId }, select: { accountPrefix: true } })
    const accountPrefix = input.accountPrefix ?? line.accountPrefix
    if (accountPrefix !== line.accountPrefix) await assertPrefixFree(tx, found.budgetId, accountPrefix, lineId)
    const plan = linePlan(input, monthsOfFiscalYear(budget.fiscalYear), budget.fiscalYear.year)
    // A cleared label (null) takes the label of the account again.
    const label = input.label === null ? await defaultLabel(tx, companyId, budget.fiscalYearId, accountPrefix) : input.label
    await tx.budgetLine.update({ where: { id: lineId }, data: { accountPrefix, ...(label !== undefined ? { label } : {}) } })
    if (input.amounts !== undefined) {
      await tx.budgetLineAmount.deleteMany({ where: { lineId } })
      await tx.budgetLineAmount.createMany({ data: plan.amounts.map((a) => ({ ...a, lineId })) })
    }
    if (input.recurringItems !== undefined) {
      await tx.budgetRecurringItem.deleteMany({ where: { lineId } })
      await tx.budgetRecurringItem.createMany({ data: plan.items.map((item) => ({ ...item, lineId })) })
    }
  })
  return getLine(companyId, lineId)
}

export async function deleteBudgetLine(companyId: string, lineId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const line = await tx.budgetLine.findFirst({ where: { id: lineId, budget: { companyId } }, select: { budgetId: true } })
    if (!line) throw new NotFoundError(BUDGET_LINE_NOT_FOUND)
    await lockOpenBudget(tx, companyId, line.budgetId)
    await tx.budgetLine.delete({ where: { id: lineId } })
  })
}

async function getLine(companyId: string, lineId: string): Promise<BudgetLineView> {
  const line = await prisma.budgetLine.findFirst({
    where: { id: lineId, budget: { companyId } },
    include: { ...BUDGET_INCLUDE.lines.include, budget: { select: { fiscalYear: { select: FISCAL_YEAR_SELECT } } } },
  })
  if (!line) throw new NotFoundError(BUDGET_LINE_NOT_FOUND)
  return lineView(line, monthsOfFiscalYear(line.budget.fiscalYear))
}
