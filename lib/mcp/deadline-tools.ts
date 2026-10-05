/**
 * Read tool of the tax and legal deadline calendar (lib/deadlines, page
 * Échéances): list_tax_deadlines. Same rule as GET /api/deadlines: the
 * company guard with DEADLINES_PERMISSION (reports:read), then the service
 * computes the deadlines of the fiscal year from the company's regimes,
 * each with its rule and official source. Dates and rules: the filed and
 * paid statuses are in list_declarations_status (lib/mcp/local-tax-tools.ts).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { loadDeadlinesView } from '@/lib/deadlines/load-deadlines.service'
import { DEADLINES_PERMISSION } from '@/lib/deadlines/permissions'
import { DEADLINE_CATEGORIES } from '@/lib/deadlines/types'
import { daysBetween } from '@/lib/reports/third-parties/payment-terms'

export function registerDeadlineReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'list_tax_deadlines',
    {
      title: 'Échéances fiscales et juridiques',
      description: describeTool({
        summary:
          'Lists the tax and legal deadlines of a fiscal year (the current one by default), computed from the company regimes: VAT returns (CA3, CA12), corporate tax instalments and balance (2571, 2572), tax return (liasse), CFE, CVAE, approval and filing of the accounts. Each with the day to act by (already postponed to the next working day when the rule says so), the legal day, whether the day is estimated (it depends on information Kledg does not hold), its condition, the extended day for online filing, the days left from today (negative when past) and its rule with the official sources. missingRegimes: the VAT regime is not set, so VAT deadlines are missing. Dates and rules only: whether each one was filed or paid is in list_declarations_status.',
        access: 'read',
        permission: DEADLINES_PERMISSION,
        amounts: 'none',
        units: 'Dates as yyyy-mm-dd, delays in days.',
        never: 'files a return, pays a tax or changes the deadline settings.',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        fiscalYearId: z.string().max(64).optional().describe('Fiscal year id, from list_fiscal_years. Defaults to the current fiscal year.'),
        category: z.enum(DEADLINE_CATEGORIES).optional().describe('tva, is, liasse, cfe, cvae, salaires (taxe sur les salaires), formation (bilan pédagogique et financier) or juridique; all by default.'),
        upcomingOnly: z.boolean().default(false).describe('true: only the deadlines from today on.'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, DEADLINES_PERMISSION)
        const view = await loadDeadlinesView(args.companyId, { fiscalYearId: args.fiscalYearId })
        const deadlines = view.deadlines
          .filter((d) => !args.category || d.category === args.category)
          .filter((d) => !args.upcomingOnly || d.date >= view.today)
        const rules = new Set(deadlines.map((d) => d.ruleId))
        return json({
          today: view.today,
          fiscalYear: view.fiscalYear,
          missingRegimes: view.missingRegimes,
          deadlines: deadlines.map((d) => ({
            date: d.date,
            legalDate: d.legalDate,
            daysLeft: daysBetween(view.today, d.date),
            label: d.label,
            form: d.form,
            category: d.category,
            estimated: d.estimated,
            projected: d.projected,
            condition: d.condition ?? null,
            note: d.note ?? null,
            extendedDate: d.extendedDate ?? null,
            rule: d.ruleId,
          })),
          rules: view.rules.filter((r) => rules.has(r.id)),
        })
      }),
  )
}
