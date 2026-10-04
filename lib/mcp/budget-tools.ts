/**
 * Read tool of budgets: get_budget_report, the budget of a fiscal year
 * against its validated entries (docs/budget.md). Same rule as the web UI:
 * the company guard with reports:read (so the connection's company grant
 * applies), then the service scopes everything by company. Amounts in euros.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { getBudgetReportOfFiscalYear } from '@/lib/budgets/get-budget-report.service'
import type { ReportRow, ReportTotal } from '@/lib/budgets/report'
import { fromCents } from '@/lib/utils/money'

const comparison = (c: ReportTotal | ReportRow) => ({
  budget: fromCents(c.budgetCents),
  actual: fromCents(c.actualCents),
  variance: fromCents(c.varianceCents),
  variancePercent: c.variancePercent,
  favorable: c.favorable,
  annualBudget: fromCents(c.annualBudgetCents),
})

export function registerBudgetReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_budget_report',
    {
      title: 'Budget et réalisé',
      description:
        'Compares the budget of a fiscal year with its validated entries (closing entries excluded, like the income statement): per budget line (class 6 charges or class 7 produits, on an account number prefix; an account goes to the line with the longest matching prefix), the budget, the actual amount, the variance (actual minus budget) and its percentage, and whether it is favorable (a charge under budget, a produit over budget). Accounts no line matches are listed as unbudgeted, so totals match the income statement. Totals cover the months up to throughMonth (the whole year by default).',
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        fiscalYearId: z.string().optional().describe('Fiscal year id, from list_fiscal_years. Defaults to the current fiscal year.'),
        throughMonth: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Format attendu : AAAA-MM')
          .optional()
          .describe('Last month counted (yyyy-mm), to compare the year to date. Defaults to the last month of the fiscal year.'),
        monthly: z.boolean().default(false).describe('true: also return the budget and the actual amount of every month per line.'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const fiscalYear = args.fiscalYearId
          ? await prisma.fiscalYear.findFirst({ where: { id: args.fiscalYearId, companyId: args.companyId }, select: { id: true } })
          : await getActiveFiscalYear(args.companyId)
        if (!fiscalYear) throw new NotFoundError('Exercice introuvable pour cette société.')
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
