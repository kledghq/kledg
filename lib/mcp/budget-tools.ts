/**
 * Read tools of budgets (docs/budget.md): list_budgets, get_budget (the
 * lines with their ids, monthly amounts and recurring items, for
 * update_budget_line) and get_budget_report (the budget of a fiscal year
 * against its validated entries). Same rule as the web UI: the company
 * guard with reports:read (so the connection's company grant applies),
 * then the services scope everything by company. Amounts in euros.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { getBudgetReportOfFiscalYear } from '@/lib/budgets/get-budget-report.service'
import { findBudgetOfFiscalYear, listBudgets } from '@/lib/budgets/manage-budgets.service'
import type { ReportRow, ReportTotal } from '@/lib/budgets/report'
import { fromCents } from '@/lib/utils/money'

const companyId = z.string().describe('Company id, from list_companies.')
const fiscalYearId = z.string().optional().describe('Fiscal year id, from list_fiscal_years. Defaults to the current fiscal year.')

const comparison = (c: ReportTotal | ReportRow) => ({
  budget: fromCents(c.budgetCents),
  actual: fromCents(c.actualCents),
  variance: fromCents(c.varianceCents),
  variancePercent: c.variancePercent,
  favorable: c.favorable,
  annualBudget: fromCents(c.annualBudgetCents),
})

async function fiscalYearOf(companyId: string, fiscalYearId: string | undefined): Promise<{ id: string }> {
  const fiscalYear = fiscalYearId
    ? await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId }, select: { id: true } })
    : await getActiveFiscalYear(companyId)
  if (!fiscalYear) throw new NotFoundError('Exercice introuvable pour cette société.')
  return fiscalYear
}

const NEVER_WRITES = 'changes the budget or the books (read only).'

export function registerBudgetReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'list_budgets',
    {
      title: 'Budgets',
      description: describeTool({
        summary: 'Lists the budgets of a company, latest fiscal year first: fiscal year, number of lines, annual charges, produits and resultat planned, and whether the year is closed (its budget no longer changes).',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        never: NEVER_WRITES,
      }),
      inputSchema: z.object({ companyId }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const { items } = await listBudgets(args.companyId)
        return json({
          budgets: items.map((b) => ({
            id: b.id,
            fiscalYear: b.fiscalYear,
            lines: b.lineCount,
            charges: fromCents(b.chargesCents),
            produits: fromCents(b.produitsCents),
            resultat: fromCents(b.resultatCents),
          })),
        })
      }),
  )

  server.registerTool(
    'get_budget',
    {
      title: 'Budget d’un exercice',
      description: describeTool({
        summary:
          'The budget of a fiscal year with every line: id (for update_budget_line and add_subscription_to_budget), account prefix, label, side (charges or produits), amounts entered per month, recurring items (label, amount, MONTHLY, QUARTERLY or YEARLY, first and last month), planned amount of each month of the year and annual total; and the annual totals. Answers that the year has no budget when there is none (create_budget creates it).',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Months as yyyy-mm.',
        never: NEVER_WRITES,
      }),
      inputSchema: z.object({ companyId, fiscalYearId }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const fiscalYear = await fiscalYearOf(args.companyId, args.fiscalYearId)
        const budget = await findBudgetOfFiscalYear(args.companyId, fiscalYear.id)
        if (!budget) throw new NotFoundError("Cet exercice n'a pas de budget : créez-le avec create_budget, ou dans Kledg.")
        return json({
          id: budget.id,
          fiscalYear: budget.fiscalYear,
          editable: budget.editable,
          months: budget.months,
          charges: fromCents(budget.chargesCents),
          produits: fromCents(budget.produitsCents),
          resultat: fromCents(budget.resultatCents),
          lines: budget.lines.map((l) => ({
            id: l.id,
            accountPrefix: l.accountPrefix,
            label: l.label,
            side: l.side,
            annualBudget: fromCents(l.annualCents),
            amounts: l.amounts.map((a) => ({ month: a.month, amount: fromCents(a.amountCents) })),
            recurringItems: l.recurringItems.map((i) => ({ id: i.id, label: i.label, amount: fromCents(i.amountCents), frequency: i.frequency, startMonth: i.startMonth, endMonth: i.endMonth })),
            plannedByMonth: l.plannedMonths.map((cents) => fromCents(cents)),
          })),
        })
      }),
  )

  server.registerTool(
    'get_budget_report',
    {
      title: 'Budget et réalisé',
      description: describeTool({
        summary:
          'Compares the budget of a fiscal year with its validated entries (closing entries excluded, like the income statement): per budget line (class 6 charges or class 7 produits, on an account number prefix; an account goes to the line with the longest matching prefix), the budget, the actual amount, the variance (actual minus budget) and its percentage, and whether it is favorable (a charge under budget, a produit over budget). Accounts no line matches are listed as unbudgeted, so totals match the income statement. Totals cover the months up to throughMonth (the whole year by default).',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Variances in percent.',
        never: NEVER_WRITES,
      }),
      inputSchema: z.object({
        companyId,
        fiscalYearId,
        throughMonth: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Format attendu : AAAA-MM')
          .optional()
          .describe('Last month counted (yyyy-mm), to compare the year to date. Defaults to the last month of the fiscal year.'),
        monthly: z.boolean().default(false).describe('true: also return the budget and the actual amount of every month per line.'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const fiscalYear = await fiscalYearOf(args.companyId, args.fiscalYearId)
        const report = await getBudgetReportOfFiscalYear(args.companyId, fiscalYear.id, { throughMonth: args.throughMonth })
        const row = (r: ReportRow) => ({
          accountPrefix: r.accountPrefix,
          label: r.label,
          ...comparison(r),
          accounts: r.accounts.map((a) => a.code),
          ...(args.monthly ? { months: r.months.map((m) => ({ month: m.month, budget: fromCents(m.budgetCents), actual: fromCents(m.actualCents) })) } : {}),
        })
        return json({
          fiscalYear: report.fiscalYear,
          throughMonth: report.throughMonth,
          charges: { lines: report.charges.lines.map(row), unbudgeted: report.charges.unbudgeted.map(row), total: comparison(report.charges.total) },
          produits: { lines: report.produits.lines.map(row), unbudgeted: report.produits.unbudgeted.map(row), total: comparison(report.produits.total) },
          resultat: comparison(report.resultat),
        })
      }),
  )
}
