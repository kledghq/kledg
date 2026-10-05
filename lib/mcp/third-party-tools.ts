/**
 * Read tools of the auxiliary balance (balance auxiliaire, docs/lettrage-et-tiers.md):
 * get_auxiliary_balance, and of the flows of a year with the customers and
 * suppliers (docs/factures-et-tiers.md): get_tiers_flows. Same rule as GET
 * /api/reports/auxiliary-balance and /api/reports/tiers-flows: the company
 * guard with reports:read, then the service of the page scopes everything
 * by company. The aged balance is get_aged_balance (lib/mcp/tools.ts).
 * Amounts in euros.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { viewMeta, withView } from '@/lib/mcp/views'
import { tiersFlowsChart } from '@/lib/mcp/views/builders'
import {
  AuxiliaryBalanceQuerySchema,
  getAuxiliaryBalance,
  getTiersFlows,
  TiersFlowsQuerySchema,
} from '@/lib/reports/third-parties/get-third-party-reports.service'
import type { AuxiliarySection } from '@/lib/reports/third-parties/third-party-balances'
import { NO_AUXILIARY_CODE, shareOf, type TiersFlowSide } from '@/lib/reports/third-parties/tiers-flows'
import { parseInput } from '@/lib/api/zod-fields'
import { fromCents } from '@/lib/utils/money'

const MAX_ROWS = 200

const amounts = (t: { openingCents: number; debitCents: number; creditCents: number; closingCents: number; unletteredCents: number }) => ({
  opening: fromCents(t.openingCents),
  debit: fromCents(t.debitCents),
  credit: fromCents(t.creditCents),
  closing: fromCents(t.closingCents),
  unlettered: fromCents(t.unletteredCents),
})

const section = (s: AuxiliarySection) => ({
  totals: amounts(s.totals),
  tiers: s.tiers.slice(0, MAX_ROWS).map((t) => ({ tiers: t.code, label: t.label, accounts: t.accountCodes, ...amounts(t) })),
  truncated: s.tiers.length > MAX_ROWS,
})

const flowSide = (s: TiersFlowSide) => ({
  total: fromCents(s.totalCents),
  count: s.tiers.length,
  tiers: s.tiers.slice(0, MAX_ROWS).map((t) => ({
    tiers: t.code === NO_AUXILIARY_CODE ? null : t.code,
    name: t.name,
    amount: fromCents(t.cents),
    sharePercent: shareOf(t.cents, s.totalCents),
  })),
  truncated: s.tiers.length > MAX_ROWS,
})

export function registerThirdPartyReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_auxiliary_balance',
    {
      title: 'Balance auxiliaire',
      description: describeTool({
        summary:
          'Returns the auxiliary balance (balance auxiliaire) of a period within one fiscal year (the whole year by default): per customer (411) and supplier (401), by auxiliary account, the opening balance, the debits and credits of the period, the closing balance and the part still unlettered at the end of the period; with the totals. Balances are signed debit minus credit, like the trial balance (a customer owing money is positive, a supplier owed money is negative).',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'letters lines or changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        fiscalYearId: z.string().max(64).optional().describe('Fiscal year id, from list_fiscal_years. Defaults to the fiscal year containing the dates, else today.'),
        startDate: z.string().optional().describe('First day of the period (yyyy-mm-dd), within the fiscal year.'),
        endDate: z.string().optional().describe('Last day of the period (yyyy-mm-dd), within the fiscal year.'),
        kind: z.enum(['customers', 'suppliers', 'all']).default('all'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const query = parseInput(AuxiliaryBalanceQuerySchema, { fiscalYearId: args.fiscalYearId, startDate: args.startDate, endDate: args.endDate })
        const report = await getAuxiliaryBalance(args.companyId, query)
        return json({
          fiscalYear: report.fiscalYear,
          period: report.period,
          ...(args.kind !== 'suppliers' && { customers: section(report.customers) }),
          ...(args.kind !== 'customers' && { suppliers: section(report.suppliers) }),
        })
      }),
  )

  server.registerTool(
    'get_tiers_flows',
    {
      title: 'Flux avec les clients et fournisseurs',
      description: describeTool({
        summary:
          'Returns what each customer was billed and what each supplier billed the company over one fiscal year (the current one by default), TTC, credit notes deducted: the figures of the flow diagram of the Tiers page. A line of a 411 (customers) or 401 (suppliers) account counts only when its entry also has a revenue line (class 7) for a customer, an expense (class 6) or fixed asset (class 2) line for a supplier: payments and the opening entry are left out. Per side: the total and every tiers with a positive amount, largest first, with its auxiliary account (null for lines without one), its name and its share of the side in percent.',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        never: 'changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        fiscalYearId: z.string().max(64).optional().describe('Fiscal year id, from list_fiscal_years. Defaults to the fiscal year containing today.'),
        kind: z.enum(['customers', 'suppliers', 'all']).default('all'),
      }),
      annotations: READ_ONLY,
      _meta: viewMeta('chart'),
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const query = parseInput(TiersFlowsQuerySchema, { fiscalYearId: args.fiscalYearId })
        const report = await getTiersFlows(args.companyId, query)
        const result = json({
          fiscalYear: report.fiscalYear,
          ...(args.kind !== 'suppliers' && { customers: flowSide(report.customers) }),
          ...(args.kind !== 'customers' && { suppliers: flowSide(report.suppliers) }),
        })
        return withView(result, () => tiersFlowsChart(args.companyId, report, args.kind))
      }),
  )
}
