/**
 * Expense reports (notes de frais) as records: list, read, create, edit and
 * delete, and the workflow brouillon -> soumise -> validée. Posting is in
 * post-expense-report.service.ts, reimbursement in
 * expense-reimbursement.service.ts.
 *
 * Invariants owned here:
 * - every lookup is scoped by company, and by claimant for a member who only
 *   submits (actor.ts): another person's report is "introuvable" to them;
 * - amounts are computed on the server from the lines, in cents
 *   (amounts.ts): the recoverable VAT follows vat-recovery.ts, the mileage
 *   allowances the scale of their year (mileage-scale.ts) with the annual
 *   distance of the vehicle counted from the claimant's other submitted
 *   reports; a total sent by a client is never trusted;
 * - only French VAT rates are accepted (VAT paid abroad is not deducted in
 *   France: it is entered at 0 % and stays in the charge);
 * - every line is dated within the report's period, and a receipt
 *   attachment is one of the company's;
 * - the author edits and submits a brouillon; a validator (expenses:validate)
 *   edits a brouillon or a soumise, returns a soumise to its author with a
 *   note, validates it, and reopens a validée that is not posted; a posted
 *   report changes only after its draft entry is deleted;
 * - numbers NDF-0001, NDF-0002... are given under a lock per company.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { dayToDate } from '@/lib/accounting/entry-date'
import { calendarDay, centsField, optionalText } from '@/lib/api/zod-fields'
import { writeAuditLog } from '@/lib/audit'
import { formatVatRate, isFrenchVatRate } from '@/lib/invoices/amounts'
import { calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'
import { centsToDecimal, parseCents } from '@/lib/utils/money'
import type { ExpenseActor } from './actor'
import { assignPriorDistances, computeReport, vehicleKey, type LineInput } from './amounts'
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, isExpenseAccountCode, type ExpenseCategory } from './categories'
import { matchCategoryRule } from './category-rules'
import { listCategoryRules } from './manage-category-rules.service'
import { ensureOwnClaimant } from './manage-expense-claimants.service'
import { expenseReportStatus, type ExpenseReportStatus, type ExpenseStatusFilter, EXPENSE_STATUS_FILTERS } from './status'
import { RECOVERY_LABELS } from './vat-recovery'
import { mealLineTreatment, type MealTaker } from './exploitant-meals'
import { claimantMealRole, mealRulesOn } from './meal-rule.service'

export const REPORT_NOT_FOUND = 'Note de frais introuvable'

type Db = Prisma.TransactionClient | typeof prisma

const cents = (value: { toString(): string }) => parseCents(value) ?? 0

// ------------------------------------------------------------------ inputs

/** 1 milliard d'euros per line: 200 lines stay far within the Decimal(15, 2) totals. */
const MAX_LINE_CENTS = 1e11

const lineSchema = z.object({
  kind: z.enum(['EXPENSE', 'MILEAGE']).default('EXPENSE'),
  date: calendarDay('Date de la dépense invalide'),
  supplierName: optionalText(200),
  label: z.string({ error: 'Le libellé est requis' }).trim().min(1, 'Le libellé est requis').max(300),
  /** Absent: the company's keyword rules decide, else "Autre dépense". */
  category: z.enum(EXPENSE_CATEGORY_KEYS as [ExpenseCategory, ...ExpenseCategory[]], { error: 'Catégorie inconnue' }).optional(),
  accountCode: optionalText(20),
  amountInclTaxCents: centsField({ min: 0, max: MAX_LINE_CENTS, integer: 'Montant en centimes' }).default(0),
  vatRateBp: z.number({ error: 'Taux de TVA invalide' }).int().min(0).max(10000).default(0),
  vatCents: centsField({ min: 0, max: MAX_LINE_CENTS, invalid: 'TVA invalide', negative: 'La TVA ne peut pas être négative', integer: 'TVA en centimes' }).nullish(),
  receiptKind: z.enum(['NONE', 'RECEIPT', 'INVOICE']).default('NONE'),
  receiptAttachmentId: z.string().max(64).nullish(),
  receiptReference: optionalText(200),
  vehicleType: z.enum(['CAR', 'MOTORCYCLE', 'MOPED']).nullish(),
  fiscalPower: z.number().int().min(1).max(99).nullish(),
  electric: z.boolean().default(false),
  distanceKm: z.number({ error: 'Distance invalide' }).int('Distance en kilomètres entiers').min(1).max(100_000).nullish(),
  /**
   * Who took a meal alone (MEALS) when the claimant does not say it, for a
   * company at IR (exploitant-meals.ts): EXPLOITANT or EMPLOYEE. Kept on
   * MEALS lines only.
   */
  mealTaker: z.enum(['EXPLOITANT', 'EMPLOYEE'], { error: 'Réponse inconnue : EXPLOITANT ou EMPLOYEE' }).nullish(),
})
export type ExpenseLineBody = z.infer<typeof lineSchema>

const reportFields = {
  label: optionalText(200),
  periodStart: calendarDay('Début de période invalide'),
  periodEnd: calendarDay('Fin de période invalide'),
  lines: z.array(lineSchema).max(200, '200 lignes au plus').default([]),
}

/** Body of POST /api/expense-reports. */
export const CreateExpenseReportBodySchema = z.object({
  /** A validator records a report for anyone; absent: the acting user's own report. */
  claimantId: z.string().max(64).optional(),
  ...reportFields,
})
export type CreateExpenseReportInput = z.infer<typeof CreateExpenseReportBodySchema>

/** Body of PATCH /api/expense-reports/[id]. */
export const UpdateExpenseReportBodySchema = z.object({ claimantId: z.string().max(64).optional(), ...reportFields })
export type UpdateExpenseReportInput = z.infer<typeof UpdateExpenseReportBodySchema>

/** Body of POST /api/expense-reports/[id]/workflow. */
export const WorkflowBodySchema = z.object({
  action: z.enum(['submit', 'return', 'validate', 'reopen'], { error: 'Action inconnue' }),
  note: optionalText(1000),
})

/** ?companyId=&status=&mine=&claimantId=&search=&cursor=&limit= */
export const ListExpenseReportsQuerySchema = z.object({
  status: z.enum(EXPENSE_STATUS_FILTERS).default('all'),
  mine: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  claimantId: z.string().max(64).optional(),
  search: z.string().trim().max(100).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type ListExpenseReportsQuery = z.infer<typeof ListExpenseReportsQuerySchema>

// ------------------------------------------------------------------ reads

/** Lines of the entry that may be lettered: only the claimant line (6x and 44566 are not letterable). */
const LETTERED_LINES = { where: { letteringCode: { not: null } }, select: { letteringCode: true }, take: 1 } as const

const SUMMARY_SELECT = {
  id: true,
  number: true,
  label: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  totalInclTax: true,
  recoverableVat: true,
  totalExpense: true,
  submittedAt: true,
  validatedAt: true,
  createdAt: true,
  claimant: { select: { id: true, name: true, kind: true, auxiliaryAccountNumber: true, userId: true } },
  entry: { select: { id: true, entryNumber: true, status: true, lines: LETTERED_LINES } },
  _count: { select: { lines: true } },
} satisfies Prisma.ExpenseReportSelect

type SummaryRow = Prisma.ExpenseReportGetPayload<{ select: typeof SUMMARY_SELECT }>

export interface ExpenseReportSummary {
  id: string
  number: string
  label: string | null
  periodStart: string
  periodEnd: string
  status: ExpenseReportStatus
  claimant: { id: string; name: string; kind: 'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE'; auxiliaryAccountNumber: string }
  /** The report is the acting user's own. */
  own: boolean
  totalInclTaxCents: number
  recoverableVatCents: number
  totalExpenseCents: number
  lineCount: number
  letteringCode: string | null
  entry: { id: string; entryNumber: string; status: string } | null
  submittedAt: string | null
  validatedAt: string | null
}

function summaryOf(row: SummaryRow, actor: ExpenseActor): ExpenseReportSummary {
  const letteringCode = row.entry?.lines[0]?.letteringCode ?? null
  return {
    id: row.id,
    number: row.number,
    label: row.label,
    periodStart: calendarDayOf(row.periodStart) as string,
    periodEnd: calendarDayOf(row.periodEnd) as string,
    status: expenseReportStatus({ status: row.status, posted: row.entry !== null, lettered: letteringCode !== null }),
    claimant: { id: row.claimant.id, name: row.claimant.name, kind: row.claimant.kind, auxiliaryAccountNumber: row.claimant.auxiliaryAccountNumber },
    own: row.claimant.userId === actor.userId,
    totalInclTaxCents: cents(row.totalInclTax),
    recoverableVatCents: cents(row.recoverableVat),
    totalExpenseCents: cents(row.totalExpense),
    lineCount: row._count.lines,
    letteringCode,
    entry: row.entry ? { id: row.entry.id, entryNumber: row.entry.entryNumber, status: row.entry.status } : null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    validatedAt: row.validatedAt?.toISOString() ?? null,
  }
}

/** The reports an actor may see: all of the company for a validator, their own otherwise. */
function visibleTo(companyId: string, actor: ExpenseActor, mine = false): Prisma.ExpenseReportWhereInput {
  return { companyId, ...(!actor.canManage || mine ? { claimant: { userId: actor.userId } } : {}) }
}

function statusWhere(filter: ExpenseStatusFilter): Prisma.ExpenseReportWhereInput {
  const lettered = { lines: { some: { letteringCode: { not: null } } } } satisfies Prisma.AccountingEntryWhereInput
  switch (filter) {
    case 'draft':
      return { status: 'DRAFT' }
    case 'submitted':
      return { status: 'SUBMITTED' }
    case 'validated':
      return { status: 'VALIDATED', entryId: null }
    case 'posted':
      return { status: 'VALIDATED', entry: { is: { NOT: lettered } } }
    case 'reimbursed':
      return { status: 'VALIDATED', entry: { is: lettered } }
    default:
      return {}
  }
}

export async function listExpenseReports(companyId: string, actor: ExpenseActor, query: ListExpenseReportsQuery) {
  // The cursor must be a report the actor may see in the company (KLEDG-R3-AUTHZ-02):
  // Prisma reads the sort values of the cursor row by its id alone.
  if (query.cursor) {
    const visible = await prisma.expenseReport.findFirst({ where: { AND: [{ id: query.cursor }, visibleTo(companyId, actor)] }, select: { id: true } })
    if (!visible) throw new ValidationError('Curseur invalide\u00a0: rechargez la liste.')
  }
  const term = query.search?.trim()
  const where: Prisma.ExpenseReportWhereInput = {
    AND: [
      visibleTo(companyId, actor, query.mine),
      statusWhere(query.status),
      query.claimantId ? { claimantId: query.claimantId } : {},
      term
        ? {
            OR: [
              { number: { contains: term, mode: 'insensitive' } },
              { label: { contains: term, mode: 'insensitive' } },
              { claimant: { name: { contains: term, mode: 'insensitive' } } },
            ],
          }
        : {},
    ],
  }
  const rows = await prisma.expenseReport.findMany({
    where,
    select: SUMMARY_SELECT,
    orderBy: [{ periodEnd: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  })
  const page = rows.slice(0, query.limit)
  return { items: page.map((row) => summaryOf(row, actor)), nextCursor: rows.length > query.limit ? page[page.length - 1].id : null }
}

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  returnNote: true,
  claimant: { select: { id: true, name: true, kind: true, auxiliaryAccountNumber: true, userId: true, accountCode: true, personId: true } },
  lines: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      position: true,
      kind: true,
      date: true,
      supplierName: true,
      label: true,
      category: true,
      accountCode: true,
      amountInclTax: true,
      vatRateBp: true,
      vatAmount: true,
      recoverableVat: true,
      receiptKind: true,
      receiptAttachmentId: true,
      receiptReference: true,
      receiptAttachment: { select: { fileName: true, fileContentType: true } },
      vehicleType: true,
      fiscalPower: true,
      electric: true,
      distanceKm: true,
      priorDistanceKm: true,
      scaleYear: true,
      mealTaker: true,
    },
  },
} satisfies Prisma.ExpenseReportSelect

type DetailRow = Prisma.ExpenseReportGetPayload<{ select: typeof DETAIL_SELECT }>

function lineInputOf(line: DetailRow['lines'][number]): LineInput {
  return {
    kind: line.kind,
    date: calendarDayOf(line.date) as string,
    category: line.category as ExpenseCategory,
    amountInclTaxCents: cents(line.amountInclTax),
    vatRateBp: line.vatRateBp,
    vatCents: cents(line.vatAmount),
    receiptKind: line.receiptKind,
    vehicleType: line.vehicleType as LineInput['vehicleType'],
    fiscalPower: line.fiscalPower,
    electric: line.electric,
    distanceKm: line.distanceKm,
    priorDistanceKm: line.priorDistanceKm,
  }
}

export async function getExpenseReport(companyId: string, id: string, actor: ExpenseActor) {
  const row = await prisma.expenseReport.findFirst({ where: { id, ...visibleTo(companyId, actor) }, select: DETAIL_SELECT })
  if (!row) throw new NotFoundError(REPORT_NOT_FOUND)
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { isVatExempt: true } })
  const computed = computeReport(row.lines.map(lineInputOf), { vatExempt: company.isVatExempt })
  const baselines = await mileageBaselines(prisma, companyId, row.claimant.id, id, row.lines.map((l) => calendarDayOf(l.date) as string))
  const meals = await reportMealRule(prisma, companyId, row)
  return {
    ...summaryOf(row, actor),
    returnNote: row.returnNote,
    claimant: { ...summaryOf(row, actor).claimant, accountCode: row.claimant.accountCode },
    storedStatus: row.status,
    vatExempt: company.isVatExempt,
    /** Distance already counted per vehicle and year by the claimant's other submitted reports (the editor's starting point). */
    mileageBaselines: baselines,
    lines: row.lines.map((l, i) => ({
      id: l.id,
      position: l.position,
      kind: l.kind,
      date: calendarDayOf(l.date) as string,
      supplierName: l.supplierName,
      label: l.label,
      category: l.category as ExpenseCategory,
      accountCode: l.accountCode,
      amountInclTaxCents: cents(l.amountInclTax),
      vatRateBp: l.vatRateBp,
      vatCents: cents(l.vatAmount),
      recoverableVatCents: cents(l.recoverableVat),
      recovery: RECOVERY_LABELS[computed.lines[i].reason],
      receiptKind: l.receiptKind,
      receiptAttachmentId: l.receiptAttachmentId,
      receiptFileName: l.receiptAttachment?.fileName ?? null,
      receiptContentType: l.receiptAttachment?.fileContentType ?? null,
      receiptReference: l.receiptReference,
      vehicleType: l.vehicleType,
      fiscalPower: l.fiscalPower,
      electric: l.electric,
      distanceKm: l.distanceKm,
      priorDistanceKm: l.priorDistanceKm,
      scaleYear: l.scaleYear,
      powerClass: computed.lines[i].powerClass,
      mealTaker: (l.mealTaker as MealTaker | null) ?? null,
      /** Meal alone of the exploitant of a company at IR: the split, or what to ask (exploitant-meals.ts); null: not concerned. */
      meal: meals.lines[i],
    })),
    vatByRate: computed.vatByRate,
    /** Rule on the meals of the exploitant: the company side on the report's last day and the claimant's role. */
    mealRule: meals.rule,
  }
}

/**
 * The rule on the meals of the exploitant for a report: the company side on
 * each meal's day, the claimant's role, and each line's treatment.
 */
export async function reportMealRule(
  db: Db,
  companyId: string,
  report: {
    periodEnd: Date
    claimant: { kind: 'EMPLOYEE' | 'DIRIGEANT' | 'ASSOCIE'; personId: string | null }
    lines: Array<{ kind: string; category: string; date: Date; amountInclTax: { toString(): string }; recoverableVat: { toString(): string }; mealTaker: string | null }>
  },
) {
  const end = calendarDayOf(report.periodEnd) as string
  const days = report.lines.map((l) => calendarDayOf(l.date) as string)
  const [rules, claimant] = await Promise.all([mealRulesOn(companyId, [end, ...days], db), claimantMealRole(companyId, report.claimant, db)])
  return {
    rule: { company: rules.get(end)!, claimant },
    lines: report.lines.map((l, i) =>
      mealLineTreatment(
        {
          kind: l.kind,
          category: l.category,
          amountInclTaxCents: cents(l.amountInclTax),
          recoverableVatCents: cents(l.recoverableVat),
          date: days[i],
          mealTaker: (l.mealTaker as MealTaker | null) ?? null,
        },
        rules.get(days[i])!,
        claimant,
      ),
    ),
  }
}

export type ExpenseReportDetail = Awaited<ReturnType<typeof getExpenseReport>>

// ------------------------------------------------------------------ writes

/**
 * Distance per vehicle and year already counted by the claimant's other
 * reports past the brouillon (soumise or validée): the annual bands of the
 * scale start from there.
 */
async function mileageBaselines(db: Db, companyId: string, claimantId: string, exceptReportId: string | null, days: string[]): Promise<Record<string, number>> {
  const years = [...new Set(days.map((d) => Number(d.slice(0, 4))))]
  if (years.length === 0) return {}
  const rows = await db.expenseLine.findMany({
    where: {
      kind: 'MILEAGE',
      report: { companyId, claimantId, status: { in: ['SUBMITTED', 'VALIDATED'] }, ...(exceptReportId ? { id: { not: exceptReportId } } : {}) },
      OR: years.map((year) => ({ date: { gte: dayToDate(`${year}-01-01`), lte: dayToDate(`${year}-12-31`) } })),
    },
    select: { date: true, vehicleType: true, fiscalPower: true, electric: true, distanceKm: true },
    take: 5000,
  })
  const baselines: Record<string, number> = {}
  for (const row of rows) {
    const key = vehicleKey({ date: calendarDayOf(row.date) as string, vehicleType: row.vehicleType as LineInput['vehicleType'], fiscalPower: row.fiscalPower, electric: row.electric })
    baselines[key] = (baselines[key] ?? 0) + (row.distanceKm ?? 0)
  }
  return baselines
}

interface PreparedReport {
  lines: Prisma.ExpenseLineCreateWithoutReportInput[]
  totals: { totalInclTaxCents: number; recoverableVatCents: number; totalExpenseCents: number }
}

/** Checks the lines and computes every amount; throws one French 400 listing every problem. */
async function prepareLines(
  tx: Prisma.TransactionClient,
  companyId: string,
  claimantId: string,
  reportId: string | null,
  input: { periodStart: string; periodEnd: string; lines: ExpenseLineBody[] },
): Promise<PreparedReport> {
  if (input.periodStart > input.periodEnd) throw new ValidationError('La période commence après sa fin.')
  const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { isVatExempt: true } })
  const { rules } = await listCategoryRules(companyId, tx)
  const attachmentIds = [...new Set(input.lines.map((l) => l.receiptAttachmentId).filter((v): v is string => !!v))]
  const ownAttachments = attachmentIds.length
    ? new Set((await tx.attachment.findMany({ where: { id: { in: attachmentIds }, companyId }, select: { id: true } })).map((a) => a.id))
    : new Set<string>()

  const errors: string[] = []
  const prepared = input.lines.map((line, index) => {
    const n = index + 1
    const mileage = line.kind === 'MILEAGE'
    const rule = !mileage && !line.category ? matchCategoryRule(rules, line) : null
    const category: ExpenseCategory = mileage ? 'MILEAGE' : (line.category ?? rule?.category ?? 'OTHER')
    if (!mileage && category === 'MILEAGE') errors.push(`Ligne ${n} : une indemnité kilométrique se saisit comme un trajet (distance et véhicule).`)
    const accountCode = line.accountCode ?? rule?.accountCode ?? null
    if (accountCode && !isExpenseAccountCode(accountCode)) errors.push(`Ligne ${n} : le compte ${accountCode} n’est pas un compte de charges (classe 6).`)
    if (line.date < input.periodStart || line.date > input.periodEnd) {
      errors.push(`Ligne ${n} : la dépense du ${formatIsoDateFr(line.date)} est hors de la période de la note (du ${formatIsoDateFr(input.periodStart)} au ${formatIsoDateFr(input.periodEnd)}).`)
    }
    if (!mileage && !isFrenchVatRate(line.vatRateBp)) {
      errors.push(`Ligne ${n} : ${formatVatRate(line.vatRateBp)} n’est pas un taux de TVA français (une TVA payée à l’étranger se saisit à 0 %).`)
    }
    if (line.receiptAttachmentId && !ownAttachments.has(line.receiptAttachmentId)) errors.push(`Ligne ${n} : justificatif introuvable dans cette société.`)
    if (mileage && !line.vehicleType) errors.push(`Ligne ${n} : choisissez le véhicule du trajet.`)
    return { body: line, category, accountCode, mileage }
  })
  if (errors.length > 0) throw new ValidationError(errors.join(' '))

  const baselines = await mileageBaselines(tx, companyId, claimantId, reportId, input.lines.filter((l) => l.kind === 'MILEAGE').map((l) => l.date))
  const lineInputs = assignPriorDistances(
    prepared.map<LineInput>(({ body, category, mileage }) => ({
      kind: body.kind,
      date: body.date,
      category,
      amountInclTaxCents: mileage ? 0 : body.amountInclTaxCents,
      vatRateBp: mileage ? 0 : body.vatRateBp,
      vatCents: mileage ? 0 : (body.vatCents ?? null),
      receiptKind: body.receiptKind,
      vehicleType: mileage ? (body.vehicleType ?? null) : null,
      fiscalPower: mileage && body.vehicleType !== 'MOPED' ? (body.fiscalPower ?? null) : null,
      electric: mileage ? body.electric : false,
      distanceKm: mileage ? (body.distanceKm ?? null) : null,
    })),
    baselines,
  )
  const totals = computeReport(lineInputs, { vatExempt: company.isVatExempt })
  totals.lines.forEach((line, i) => {
    if (line.error) errors.push(`Ligne ${i + 1} : ${line.error}`)
  })
  if (errors.length > 0) throw new ValidationError(errors.join(' '))

  return {
    lines: prepared.map(({ body, category, accountCode, mileage }, i) => {
      const computed = totals.lines[i]
      const input = lineInputs[i]
      return {
        position: i + 1,
        kind: body.kind,
        date: dayToDate(body.date),
        supplierName: mileage ? null : (body.supplierName ?? null),
        label: body.label,
        category,
        accountCode,
        amountInclTax: centsToDecimal(computed.amountInclTaxCents),
        vatRateBp: input.vatRateBp,
        vatAmount: centsToDecimal(computed.vatCents),
        recoverableVat: centsToDecimal(computed.recoverableVatCents),
        receiptKind: body.receiptKind,
        ...(body.receiptAttachmentId ? { receiptAttachment: { connect: { id: body.receiptAttachmentId } } } : {}),
        receiptReference: body.receiptReference ?? null,
        vehicleType: input.vehicleType ?? null,
        fiscalPower: input.fiscalPower ?? null,
        electric: input.electric ?? false,
        distanceKm: input.distanceKm ?? null,
        priorDistanceKm: mileage ? (input.priorDistanceKm ?? 0) : null,
        scaleYear: computed.scaleYear,
        mealTaker: !mileage && category === 'MEALS' ? (body.mealTaker ?? null) : null,
      }
    }),
    totals: { totalInclTaxCents: totals.totalInclTaxCents, recoverableVatCents: totals.recoverableVatCents, totalExpenseCents: totals.totalExpenseCents },
  }
}

function amountData(totals: PreparedReport['totals']) {
  return {
    totalInclTax: centsToDecimal(totals.totalInclTaxCents),
    recoverableVat: centsToDecimal(totals.recoverableVatCents),
    totalExpense: centsToDecimal(totals.totalExpenseCents),
  }
}

/** The claimant of a new or edited report: anyone of the company for a validator, the actor's own otherwise. */
async function resolveClaimant(tx: Prisma.TransactionClient, companyId: string, actor: ExpenseActor, claimantId: string | undefined): Promise<string> {
  if (!claimantId) return (await ensureOwnClaimant(tx, companyId, actor)).id
  const claimant = await tx.expenseClaimant.findFirst({ where: { id: claimantId, companyId }, select: { id: true, userId: true } })
  if (!claimant) throw new NotFoundError('Bénéficiaire introuvable')
  if (!actor.canManage && claimant.userId !== actor.userId) throw new NotFoundError('Bénéficiaire introuvable')
  return claimant.id
}

async function nextNumber(tx: Prisma.TransactionClient, companyId: string): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`kledg:expense-report-number:${companyId}`}))`
  const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST(substring("number" FROM 5) AS INTEGER)) AS max FROM "expense_reports"
    WHERE "companyId" = ${companyId} AND "number" ~ '^NDF-[0-9]{1,9}$'`
  return `NDF-${String((rows[0]?.max ?? 0) + 1).padStart(4, '0')}`
}

/** Locks a report of the company visible to the actor and returns its state (FOR UPDATE: edits, workflow and posting never interleave). */
export async function lockExpenseReport(tx: Prisma.TransactionClient, companyId: string, id: string, actor: ExpenseActor | null) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "expense_reports" WHERE "id" = ${id} AND "companyId" = ${companyId} FOR UPDATE`
  if (rows.length === 0) throw new NotFoundError(REPORT_NOT_FOUND)
  const report = await tx.expenseReport.findUniqueOrThrow({
    where: { id },
    select: { id: true, number: true, status: true, entryId: true, claimantId: true, claimant: { select: { userId: true } }, _count: { select: { lines: true } } },
  })
  const own = actor !== null && report.claimant.userId === actor.userId
  if (actor && !actor.canManage && !own) throw new NotFoundError(REPORT_NOT_FOUND)
  return { ...report, own }
}

const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const

export async function createExpenseReport(companyId: string, input: CreateExpenseReportInput, actor: ExpenseActor, options: { source?: string } = {}): Promise<ExpenseReportDetail> {
  const id = await prisma.$transaction(async (tx) => {
    const claimantId = await resolveClaimant(tx, companyId, actor, input.claimantId)
    const prepared = await prepareLines(tx, companyId, claimantId, null, input)
    const number = await nextNumber(tx, companyId)
    const created = await tx.expenseReport.create({
      data: {
        companyId,
        claimantId,
        number,
        label: input.label ?? null,
        periodStart: dayToDate(input.periodStart),
        periodEnd: dayToDate(input.periodEnd),
        createdById: actor.userId,
        ...amountData(prepared.totals),
        lines: { create: prepared.lines },
      },
      select: { id: true, number: true },
    })
    return created
  }, TX_OPTIONS)
  await writeAuditLog('info', `Expense report created: ${id.number}`, { action: 'CREATE_EXPENSE_REPORT', companyId, metadata: { reportId: id.id, source: options.source ?? 'web' } })
  return getExpenseReport(companyId, id.id, actor)
}

function assertEditable(report: Awaited<ReturnType<typeof lockExpenseReport>>, actor: ExpenseActor) {
  if (report.entryId) throw new ConflictError(`La note de frais ${report.number} est comptabilisée\u00a0: supprimez d’abord son écriture en brouillon pour la modifier.`)
  if (report.status === 'VALIDATED') throw new ConflictError(`La note de frais ${report.number} est validée\u00a0: rouvrez-la pour la modifier.`)
  if (report.status === 'SUBMITTED' && !actor.canManage) {
    throw new ConflictError(`La note de frais ${report.number} est soumise\u00a0: elle ne se modifie plus, sauf si un valideur vous la renvoie.`)
  }
}

export async function updateExpenseReport(companyId: string, id: string, input: UpdateExpenseReportInput, actor: ExpenseActor): Promise<ExpenseReportDetail> {
  const number = await prisma.$transaction(async (tx) => {
    const report = await lockExpenseReport(tx, companyId, id, actor)
    assertEditable(report, actor)
    const claimantId = input.claimantId && input.claimantId !== report.claimantId ? await resolveClaimant(tx, companyId, actor, input.claimantId) : report.claimantId
    const prepared = await prepareLines(tx, companyId, claimantId, id, input)
    await tx.expenseLine.deleteMany({ where: { reportId: id } })
    await tx.expenseReport.update({
      where: { id },
      data: {
        claimantId,
        label: input.label ?? null,
        periodStart: dayToDate(input.periodStart),
        periodEnd: dayToDate(input.periodEnd),
        ...amountData(prepared.totals),
        lines: { create: prepared.lines },
      },
    })
    return report.number
  }, TX_OPTIONS)
  await writeAuditLog('info', `Expense report updated: ${number}`, { action: 'UPDATE_EXPENSE_REPORT', companyId, metadata: { reportId: id } })
  return getExpenseReport(companyId, id, actor)
}

export async function deleteExpenseReport(companyId: string, id: string, actor: ExpenseActor): Promise<{ id: string }> {
  const number = await prisma.$transaction(async (tx) => {
    const report = await lockExpenseReport(tx, companyId, id, actor)
    if (report.entryId) throw new ConflictError(`La note de frais ${report.number} est comptabilisée\u00a0: supprimez d’abord son écriture en brouillon.`)
    if (!actor.canManage && report.status !== 'DRAFT') throw new ConflictError(`La note de frais ${report.number} est soumise\u00a0: seul un valideur peut la supprimer.`)
    await tx.expenseReport.delete({ where: { id } })
    return report.number
  }, TX_OPTIONS)
  await writeAuditLog('info', `Expense report deleted: ${number}`, { action: 'DELETE_EXPENSE_REPORT', companyId, metadata: { reportId: id } })
  return { id }
}

/**
 * The workflow. submit: brouillon -> soumise (its author or a validator; at
 * least one line). return: soumise -> brouillon with a note (validator).
 * validate: soumise -> validée (validator). reopen: validée and not posted
 * -> brouillon (validator).
 */
export async function runExpenseWorkflow(
  companyId: string,
  id: string,
  input: z.infer<typeof WorkflowBodySchema>,
  actor: ExpenseActor,
  options: { now?: Date; source?: string } = {},
): Promise<ExpenseReportDetail> {
  const now = options.now ?? new Date()
  const number = await prisma.$transaction(async (tx) => {
    const report = await lockExpenseReport(tx, companyId, id, actor)
    const requireManager = () => {
      if (!actor.canManage) throw new ConflictError('Seul un administrateur ou un comptable de la société valide les notes de frais.')
    }
    switch (input.action) {
      case 'submit': {
        if (report.status !== 'DRAFT') throw new ConflictError(`La note de frais ${report.number} n’est pas un brouillon.`)
        if (report._count.lines === 0) throw new ValidationError('Ajoutez au moins une dépense avant de soumettre la note de frais.')
        await tx.expenseReport.update({ where: { id }, data: { status: 'SUBMITTED', submittedAt: now, submittedById: actor.userId, returnNote: null } })
        break
      }
      case 'return': {
        requireManager()
        if (report.status !== 'SUBMITTED') throw new ConflictError(`La note de frais ${report.number} n’est pas soumise.`)
        if (!input.note) throw new ValidationError('Expliquez à son auteur ce qu’il doit corriger.')
        await tx.expenseReport.update({ where: { id }, data: { status: 'DRAFT', returnNote: input.note, submittedAt: null, submittedById: null } })
        break
      }
      case 'validate': {
        requireManager()
        if (report.status !== 'SUBMITTED') throw new ConflictError(`La note de frais ${report.number} doit être soumise avant d’être validée.`)
        await assertPostable(tx, companyId, id)
        await tx.expenseReport.update({ where: { id }, data: { status: 'VALIDATED', validatedAt: now, validatedById: actor.userId } })
        break
      }
      case 'reopen': {
        requireManager()
        if (report.status !== 'VALIDATED') throw new ConflictError(`La note de frais ${report.number} n’est pas validée.`)
        if (report.entryId) throw new ConflictError(`La note de frais ${report.number} est comptabilisée\u00a0: supprimez d’abord son écriture en brouillon.`)
        await tx.expenseReport.update({ where: { id }, data: { status: 'DRAFT', validatedAt: null, validatedById: null, submittedAt: null, submittedById: null } })
        break
      }
    }
    return report.number
  }, TX_OPTIONS)
  const actions = { submit: 'SUBMIT_EXPENSE_REPORT', return: 'RETURN_EXPENSE_REPORT', validate: 'VALIDATE_EXPENSE_REPORT', reopen: 'REOPEN_EXPENSE_REPORT' } as const
  await writeAuditLog('info', `Expense report ${input.action}: ${number}`, { action: actions[input.action], companyId, metadata: { reportId: id, source: options.source ?? 'web' } })
  return getExpenseReport(companyId, id, actor)
}

/** What validation needs so that posting can follow: every line has an account (category or its own). */
async function assertPostable(tx: Prisma.TransactionClient, companyId: string, id: string) {
  const lines = await tx.expenseLine.findMany({ where: { reportId: id, report: { companyId } }, select: { position: true, category: true, accountCode: true } })
  const missing = lines.filter((l) => !l.accountCode && !EXPENSE_CATEGORIES[l.category as ExpenseCategory]?.account).map((l) => l.position)
  if (missing.length > 0) {
    throw new ValidationError(`Choisissez le compte de charge des lignes ${missing.join(', ')} (catégorie « Autre dépense ») avant de valider.`)
  }
}
