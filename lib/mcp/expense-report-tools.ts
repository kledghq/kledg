/**
 * Read tools of expense reports (notes de frais): list_expense_reports and
 * get_expense_report. Same rules as the web UI: the company guard with
 * entries:read (so the connection's company grant applies), then the
 * services scope the reports by the user's role: a validator
 * (expenses:validate) sees every report of the company, another member only
 * their own (lib/expense-reports/actor.ts). Amounts in euros.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { viewMeta, withView } from '@/lib/mcp/views'
import { expenseReportDocument } from '@/lib/mcp/views/builders'
import { expenseActorOf } from '@/lib/expense-reports/actor'
import { EXPENSE_CATEGORIES } from '@/lib/expense-reports/categories'
import { getExpenseReport, listExpenseReports } from '@/lib/expense-reports/manage-expense-reports.service'
import { listClaimants } from '@/lib/expense-reports/manage-expense-claimants.service'
import { EXPENSE_STATUS_FILTERS } from '@/lib/expense-reports/status'
import { fromCents } from '@/lib/utils/money'
import type { MealLineTreatment } from '@/lib/expense-reports/exploitant-meals'

/**
 * A meal line under the rule on the meals of the exploitant of a company at
 * IR (lib/expense-reports/exploitant-meals.ts), in euros: status split (the
 * charge on the line's account and on 62568), not-concerned, ask (who took
 * the meal: answer mealTaker) or unknown-taxation.
 */
export function mealOut(treatment: MealLineTreatment | null) {
  if (!treatment) return null
  const split = treatment.split
  return {
    status: treatment.status,
    reason: treatment.reason,
    ...(split
      ? {
          deductible: fromCents(split.deductibleCents),
          nonDeductible: fromCents(split.nonDeductibleCents),
          nonDeductibleAccount: '62568',
          thresholds: {
            year: split.thresholds.year,
            appliedYear: split.thresholds.appliedYear,
            estimated: split.thresholds.estimated,
            homeMeal: fromCents(split.thresholds.homeMealCents),
            limit: fromCents(split.thresholds.limitCents),
            source: split.thresholds.source.url,
          },
        }
      : {}),
  }
}

const companyId = z.string().describe('Company id, from list_companies.')

export function registerExpenseReportReadTools(server: McpServer, access: McpAccess, guard: CompanyGuard) {
  const readOnly = READ_ONLY

  server.registerTool(
    'list_expense_reports',
    {
      title: 'Notes de frais',
      description: describeTool({
        summary:
          'Lists the expense reports (notes de frais) of a company, latest period first: number, claimant (salarié, dirigeant or associé), period, total owed, recoverable VAT and status (draft, submitted, validated, posted, reimbursed: reimbursed is derived from the lettering of the claimant account). A user who cannot validate reports only sees their own.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'shows another person’s report to a user who cannot validate reports, or changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId,
        status: z.enum(EXPENSE_STATUS_FILTERS).default('all'),
        mine: z.boolean().default(false).describe('true: only the connected user’s own reports.'),
        search: z.string().max(100).optional().describe('Part of the number, label or claimant name.'),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        const actor = await expenseActorOf(access.user, args.companyId)
        const page = await listExpenseReports(args.companyId, actor, { status: args.status, mine: args.mine, search: args.search, limit: args.limit })
        return json({
          truncated: page.nextCursor !== null,
          reports: page.items.map((r) => ({
            id: r.id,
            number: r.number,
            label: r.label,
            claimant: r.claimant.name,
            claimantKind: r.claimant.kind,
            periodStart: r.periodStart,
            periodEnd: r.periodEnd,
            totalOwed: fromCents(r.totalInclTaxCents),
            recoverableVat: fromCents(r.recoverableVatCents),
            charges: fromCents(r.totalExpenseCents),
            status: r.status,
            entryNumber: r.entry?.entryNumber ?? null,
          })),
        })
      }),
  )

  server.registerTool(
    'get_expense_report',
    {
      title: 'Note de frais',
      description: describeTool({
        summary:
          'One expense report with its lines: date, supplier, category, account, amount paid, VAT shown and the part recoverable with the reason (no recovery on passenger transport and staff lodging, CGI ann. II art. 206, IV, 2; a receipt over 150 € HT needs an invoice in the company name), mileage trips with the scale year applied, its entry and status. For a company taxed at the impôt sur le revenu, each meal alone (MEALS) of the exploitant or an associé carries meal: the deductible part (frais supplémentaires above the home meal value, up to the yearly limit, BOI-BNC-BASE-40-60-60) and the non-deductible part posted to 62568 and added back on the return, with the year’s thresholds and source; status ask when who took the meal is unknown (posting is refused until mealTaker is given). mealRule gives the company taxation and the claimant role.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'euros',
        units: 'VAT rates in percent, distances in km.',
        never: 'submits, validates or posts a report (read only).',
      }),
      inputSchema: z.object({ companyId, reportId: z.string().describe('Expense report id, from list_expense_reports.') }),
      annotations: readOnly,
      _meta: viewMeta('document'),
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        const actor = await expenseActorOf(access.user, args.companyId)
        const report = await getExpenseReport(args.companyId, args.reportId, actor)
        const out = {
          id: report.id,
          number: report.number,
          label: report.label,
          claimant: report.claimant,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          status: report.status,
          returnNote: report.returnNote,
          totalOwed: fromCents(report.totalInclTaxCents),
          recoverableVat: fromCents(report.recoverableVatCents),
          charges: fromCents(report.totalExpenseCents),
          lines: report.lines.map((l) => ({
            kind: l.kind,
            date: l.date,
            supplier: l.supplierName,
            label: l.label,
            category: l.category,
            categoryLabel: EXPENSE_CATEGORIES[l.category]?.label ?? l.category,
            accountCode: l.accountCode ?? EXPENSE_CATEGORIES[l.category]?.account ?? null,
            amountPaid: fromCents(l.amountInclTaxCents),
            vatRatePercent: l.vatRateBp / 100,
            vat: fromCents(l.vatCents),
            recoverableVat: fromCents(l.recoverableVatCents),
            recovery: l.recovery,
            receipt: l.receiptKind,
            hasReceiptFile: l.receiptAttachmentId !== null,
            mealTaker: l.mealTaker,
            meal: mealOut(l.meal),
            ...(l.kind === 'MILEAGE' ? { mileage: { distanceKm: l.distanceKm, vehicle: l.vehicleType, fiscalPower: l.fiscalPower, electric: l.electric, scaleYear: l.scaleYear, priorDistanceKm: l.priorDistanceKm } } : {}),
          })),
          entry: report.entry,
          lettering: report.letteringCode,
          mealRule: report.mealRule,
        }
        return withView(json(out), () => expenseReportDocument(args.companyId, out))
      }),
  )

  server.registerTool(
    'list_expense_claimants',
    {
      title: 'Bénéficiaires de notes de frais',
      description: describeTool({
        summary:
          'Lists the claimants of expense reports of a company (salarié, dirigeant or associé) with their id, auxiliary account number (S00001...) and account, and their number of reports: the claimant to pass to create_draft_expense_report. A user who cannot validate reports only sees their own claimant.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'none',
        never: 'creates or changes a claimant, or shows another person to a user who cannot validate reports (read only).',
      }),
      inputSchema: z.object({ companyId }),
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        const actor = await expenseActorOf(access.user, args.companyId)
        const { claimants } = await listClaimants(args.companyId, actor)
        return json({
          claimants: claimants.map((c) => ({ id: c.id, kind: c.kind, name: c.name, auxiliaryAccountNumber: c.auxiliaryAccountNumber, account: c.accountCode, reports: c._count.reports, isYou: c.userId === access.user.id })),
        })
      }),
  )
}
