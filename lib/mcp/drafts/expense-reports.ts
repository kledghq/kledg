/**
 * Draft-level tool of expense reports: create_draft_expense_report records
 * a draft report (brouillon) from receipts and trips, for the connected
 * user or, for a user who validates reports, for another claimant. A thin
 * wrapper over lib/expense-reports/manage-expense-reports.service.ts, with
 * the right of POST /api/expense-reports (expenses:submit): amounts
 * computed by Kledg in cents, recoverable VAT by the rules of
 * lib/expense-reports/vat-recovery.ts, mileage by the official scale of
 * the year, receipts that are attachments of the company, the claimant
 * chosen by the user's role (lib/expense-reports/actor.ts).
 *
 * The report stays a brouillon: submitting, validating and posting it are
 * done by people in Kledg. dryRun: true returns the totals without writing.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { expenseActorOf } from '@/lib/expense-reports/actor'
import { assignPriorDistances, computeReport, type LineInput } from '@/lib/expense-reports/amounts'
import { EXPENSE_LINE_CATEGORIES, type ExpenseCategory } from '@/lib/expense-reports/categories'
import { matchCategoryRule } from '@/lib/expense-reports/category-rules'
import { listCategoryRules } from '@/lib/expense-reports/manage-category-rules.service'
import { createExpenseReport, type ExpenseLineBody } from '@/lib/expense-reports/manage-expense-reports.service'
import { RECOVERY_LABELS } from '@/lib/expense-reports/vat-recovery'
import type { ExpenseActor } from '@/lib/expense-reports/actor'
import { mealLineTreatment } from '@/lib/expense-reports/exploitant-meals'
import { loadMealRule, mealRulesOn } from '@/lib/expense-reports/meal-rule.service'
import { mealOut } from '@/lib/mcp/expense-report-tools'
import { rateToBasisPoints } from '@/lib/invoices/amounts'
import { fromCents, toCents } from '@/lib/utils/money'
import { kledgPageUrl } from '@/lib/mcp/tool-meta'
import { draftTool, type RegisterDraftTool } from './define'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ')

const input = {
  dryRun: z.boolean().default(false).describe('true: only return the totals and the recoverable VAT per line, nothing is recorded.'),
  claimant: z
    .string()
    .max(64)
    .optional()
    .describe('Claimant id or auxiliary number (S00001...). Omitted: the connected user’s own report. Only a user who validates reports may record one for someone else.'),
  periodStart: day,
  periodEnd: day,
  label: z.string().max(200).optional(),
  expenses: z
    .array(
      z.object({
        date: day,
        supplier: z.string().max(200).optional(),
        label: z.string().min(1).max(300),
        category: z
          .enum(EXPENSE_LINE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]])
          .optional()
          .describe('TRANSPORT, LODGING, MEALS, RECEPTION, FUEL, SUPPLIES, POSTAGE, GIFTS or OTHER. Omitted: the company’s keyword rules, else OTHER.'),
        accountCode: z.string().max(20).optional().describe('Expense account (class 6); omitted: the category’s.'),
        amountPaid: z.number().min(0).max(1e9).describe('Amount paid, VAT included, in euros.'),
        vatRate: z.number().min(0).max(100).default(0).describe('VAT rate in percent shown on the receipt: 20, 10, 5.5, 2.1 or 0.'),
        vatAmount: z.number().min(0).max(1e9).optional().describe('VAT shown on the receipt, in euros; omitted: computed from the amount and the rate.'),
        receipt: z.enum(['NONE', 'RECEIPT', 'INVOICE']).default('RECEIPT').describe('INVOICE: invoice made out to the company; RECEIPT: ticket or simplified invoice (150 € HT at most for the VAT); NONE.'),
        receiptAttachmentId: z.string().max(64).optional().describe('Id of a receipt already in Kledg (a Qonto attachment of the company).'),
        receiptReference: z.string().max(200).optional(),
        mealTaker: z
          .enum(['EXPLOITANT', 'EMPLOYEE'])
          .optional()
          .describe('MEALS only, for a company at the impôt sur le revenu when the claimant is not known as associé or employee: who took the meal (EXPLOITANT: the exploitant or an associé, only the frais supplémentaires are deductible; EMPLOYEE).'),
      }),
    )
    .max(200)
    .default([]),
  trips: z
    .array(
      z.object({
        date: day,
        label: z.string().min(1).max(300).describe('Trip and purpose, e.g. "Paris, Lyon, client Martin".'),
        distanceKm: z.number().int().min(1).max(100_000),
        vehicle: z.enum(['CAR', 'MOTORCYCLE', 'MOPED']).default('CAR'),
        fiscalPower: z.number().int().min(1).max(99).optional().describe('Fiscal power (CV) from the registration document; not needed for a moped.'),
        electric: z.boolean().default(false),
      }),
    )
    .max(200)
    .default([]),
}

type Args = Omit<z.infer<z.ZodObject<typeof input>>, 'dryRun'> & { companyId: string }

async function resolveClaimant(companyId: string, ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined
  const claimant = await prisma.expenseClaimant.findFirst({
    where: { companyId, OR: [{ id: ref }, { auxiliaryAccountNumber: ref.toUpperCase() }] },
    select: { id: true },
  })
  if (!claimant) throw new NotFoundError('Bénéficiaire introuvable\u00a0: laissez claimant vide pour votre propre note de frais.')
  return claimant.id
}

function linesOf(args: Args): ExpenseLineBody[] {
  const expenses = args.expenses.map<ExpenseLineBody>((e, i) => {
    const amountInclTaxCents = toCents(e.amountPaid)
    const vatRateBp = rateToBasisPoints(String(e.vatRate), 'percent')
    const vatCents = e.vatAmount === undefined ? null : toCents(e.vatAmount)
    if (amountInclTaxCents === null || vatRateBp === null || (e.vatAmount !== undefined && vatCents === null)) {
      throw new ValidationError(`Dépense ${i + 1} : montant (2 décimales) ou taux de TVA invalide.`)
    }
    return {
      kind: 'EXPENSE',
      date: e.date,
      supplierName: e.supplier ?? null,
      label: e.label,
      category: e.category,
      accountCode: e.accountCode ?? null,
      amountInclTaxCents,
      vatRateBp,
      vatCents,
      receiptKind: e.receipt,
      receiptAttachmentId: e.receiptAttachmentId ?? null,
      receiptReference: e.receiptReference ?? null,
      electric: false,
      mealTaker: e.mealTaker ?? null,
    }
  })
  const trips = args.trips.map<ExpenseLineBody>((t) => ({
    kind: 'MILEAGE',
    date: t.date,
    label: t.label,
    category: 'MILEAGE',
    amountInclTaxCents: 0,
    vatRateBp: 0,
    receiptKind: 'NONE',
    vehicleType: t.vehicle,
    fiscalPower: t.vehicle === 'MOPED' ? null : (t.fiscalPower ?? null),
    electric: t.electric,
    distanceKm: t.distanceKm,
  }))
  const lines = [...expenses, ...trips]
  if (lines.length === 0) throw new ValidationError('Ajoutez au moins une dépense ou un trajet.')
  return lines
}

async function previewOf(args: Args, actor: ExpenseActor) {
  const lines = linesOf(args)
  const claimantId = await resolveClaimant(args.companyId, args.claimant)
  const [mealRules, mealView] = await Promise.all([
    mealRulesOn(args.companyId, lines.map((l) => l.date)),
    loadMealRule(args.companyId, actor, { claimantId, day: args.periodEnd }),
  ])
  const company = await prisma.company.findUniqueOrThrow({ where: { id: args.companyId }, select: { isVatExempt: true } })
  const { rules } = await listCategoryRules(args.companyId)
  const inputs = assignPriorDistances(
    lines.map<LineInput>((l) => ({
      kind: l.kind,
      date: l.date,
      category: l.kind === 'MILEAGE' ? 'MILEAGE' : (l.category ?? matchCategoryRule(rules, l)?.category ?? 'OTHER'),
      amountInclTaxCents: l.amountInclTaxCents,
      vatRateBp: l.vatRateBp,
      vatCents: l.vatCents ?? null,
      receiptKind: l.receiptKind,
      vehicleType: l.vehicleType ?? null,
      fiscalPower: l.fiscalPower ?? null,
      electric: l.electric,
      distanceKm: l.distanceKm ?? null,
    })),
    {},
  )
  const totals = computeReport(inputs, { vatExempt: company.isVatExempt })
  return {
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    totalOwed: fromCents(totals.totalInclTaxCents),
    recoverableVat: fromCents(totals.recoverableVatCents),
    charges: fromCents(totals.totalExpenseCents),
    lines: totals.lines.map((l, i) => ({
      label: lines[i].label,
      category: inputs[i].category,
      amount: fromCents(l.amountInclTaxCents),
      recoverableVat: fromCents(l.recoverableVatCents),
      recovery: RECOVERY_LABELS[l.reason],
      problem: l.error,
      meal: mealOut(
        mealLineTreatment(
          {
            kind: lines[i].kind,
            category: inputs[i].category,
            amountInclTaxCents: l.amountInclTaxCents,
            recoverableVatCents: l.recoverableVatCents,
            date: lines[i].date,
            mealTaker: lines[i].mealTaker ?? null,
          },
          mealRules.get(lines[i].date)!,
          mealView.claimant,
        ),
      ),
    })),
  }
}

const createDraftExpenseReportTool = draftTool({
  name: 'create_draft_expense_report',
  title: 'Préparer une note de frais',
  summary:
    "Records an expense report (note de frais) in Kledg as a draft (brouillon) from receipts: expenses with the amount paid and the VAT shown, and mileage trips paid by the official scale of their year (no VAT). For the connected user, or for another claimant (id or auxiliary number from list_expense_claimants) when the user validates reports. Kledg computes the recoverable VAT of each line (none on passenger transport or staff lodging, CGI ann. II art. 206, IV, 2; 80 % on fuel; only with an invoice in the company name, or a ticket of 150 € HT at most). For a company taxed at the impôt sur le revenu, a meal alone (MEALS) of the exploitant or an associé is split when posted: only the frais supplémentaires are deductible (above the home meal value, up to the yearly limit: 5,50 € and 21,40 € TTC in 2026, BOI-BNC-BASE-40-60-60), the rest goes to 62568 and is added back on the return; the dryRun preview shows it per line (meal), and status ask means mealTaker is needed. dryRun: true shows the totals and the VAT recovered per line without recording (its mileage amounts do not count the claimant's earlier trips of the year; the recorded report does).",
  never: 'submits, validates, posts or reimburses the report: the person submits it and a validator validates and posts it in Kledg.',
  amounts: 'euros',
  units: 'VAT rates in percent, distances in km.',
  input,
  permission: { expenses: ['submit'] },
  destructive: false,
  idempotent: false,
  async execute({ dryRun, ...args }, ctx) {
    if (dryRun) {
      return {
        dryRun: true,
        preview: await previewOf(args, await expenseActorOf(ctx.access.user, args.companyId)),
        changes: 'Aucune\u00a0: aperçu seulement.',
        reviewUrl: kledgPageUrl(args.companyId, 'expense-reports'),
        message: "Aperçu seulement\u00a0: rien n'a été enregistré. Rappelez l'outil sans dryRun pour enregistrer la note en brouillon.",
      }
    }
    const actor = await expenseActorOf(ctx.access.user, args.companyId)
    const report = await createExpenseReport(
      args.companyId,
      { claimantId: await resolveClaimant(args.companyId, args.claimant), label: args.label ?? null, periodStart: args.periodStart, periodEnd: args.periodEnd, lines: linesOf(args) },
      actor,
      { source: 'mcp' },
    )
    return {
      reportId: report.id,
      number: report.number,
      status: report.status,
      totalOwed: fromCents(report.totalInclTaxCents),
      recoverableVat: fromCents(report.recoverableVatCents),
      changes: { reportCreated: report.id, number: report.number, status: report.status },
      reviewUrl: kledgPageUrl(args.companyId, `expense-reports/${report.id}`),
      message: 'Note de frais enregistrée en brouillon\u00a0: soumettez-la dans Kledg pour qu’elle soit validée puis comptabilisée.',
    }
  },
  audit: (_args, result) => ('reportId' in result ? { reportId: result.reportId, number: result.number } : null),
})

export function registerExpenseReportDraftTools(register: RegisterDraftTool) {
  register(createDraftExpenseReportTool)
}
