/**
 * Read tools of management fees (frais de gestion): list_management_fee_conventions
 * and preview_management_fees. Same rules as the web UI: the company guard
 * with reports:read on the holding, then every subsidiary is reached through
 * the same guard (lib/management-fees/access.ts), so the connection's
 * company grant applies to the subsidiaries too: a subsidiary outside the
 * grant is "out of reach", never read. No tool generates invoices: that
 * stays a decision taken in Kledg. Amounts in euros.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import type { GroupAccess } from '@/lib/management-fees/access'
import { computeConventionFees } from '@/lib/management-fees/compute-management-fees.service'
import { listConventions } from '@/lib/management-fees/manage-conventions.service'
import { fromCents } from '@/lib/utils/money'

const companyId = z.string().describe('Holding company id, from list_companies.')

export function registerManagementFeeTools(server: McpServer, access: McpAccess, guard: CompanyGuard) {
  const readOnly = READ_ONLY
  const group: GroupAccess = {
    userId: access.user.id,
    require: (id, permission) => guard.require(id, permission),
    companyIds: () => guard.companyIds(),
  }

  server.registerTool(
    'list_management_fee_conventions',
    {
      title: 'Conventions de frais de gestion',
      description: describeTool({
        summary:
          'Lists the management fee conventions (conventions de prestations de services) of a holding with its subsidiaries: pricing (cost plus a mark-up, or a fixed amount), mark-up, share of the costs charged, allocation key (equal, revenue, custom percentages), VAT rate, accounts and subsidiaries. Subsidiaries the connection cannot read are listed without their name.',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Percentages in percent.',
        never: 'names a subsidiary outside the connection’s grant or changes anything (read only).',
      }),
      inputSchema: z.object({ companyId }),
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const conventions = await listConventions(args.companyId, group)
        return json({
          conventions: conventions.map((c) => ({
            id: c.id,
            label: c.label,
            pricing: c.pricing,
            markupPercent: c.markupBp / 100,
            costSharePercent: c.costShareBp / 100,
            fixedAmount: c.fixedAmountCents === null ? null : fromCents(c.fixedAmountCents),
            allocationKey: c.allocationKey,
            vatRatePercent: c.vatRateBp / 100,
            revenueAccount: c.revenueAccountCode,
            expenseAccount: c.expenseAccountCode,
            costAccountPrefixes: c.costAccountPrefixes,
            excludedAccountPrefixes: c.excludedAccountPrefixes,
            startDate: c.startDate,
            endDate: c.endDate,
            invoicedPeriods: c.billingCount,
            subsidiaries: c.subsidiaries.map((s) => ({
              id: s.subsidiaryId,
              name: s.name,
              accessible: s.accessible,
              sharePercent: s.sharePercentBp === null ? null : s.sharePercentBp / 100,
              startDate: s.startDate,
              endDate: s.endDate,
            })),
          })),
        })
      }),
  )

  server.registerTool(
    'preview_management_fees',
    {
      title: 'Calcul des frais de gestion',
      description: describeTool({
        summary:
          'Computes the management fees of a convention for a period: the holding’s pooled charges (validated entries, class 6 minus the excluded accounts), the service share and the mark-up (cost plus), or the fixed amount; then each subsidiary’s amount excluding tax, VAT and total, split by the key so the parts sum exactly to the total. Needs read access to the holding and to every subsidiary of the convention.',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Percentages in percent.',
        never: 'generates, posts or sends an invoice: generating management fee invoices is a decision taken in Kledg, never through MCP (read only).',
      }),
      inputSchema: z.object({
        companyId,
        conventionId: z.string().describe('Convention id, from list_management_fee_conventions.'),
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('First day of the period, yyyy-mm-dd.'),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Last day of the period, yyyy-mm-dd.'),
      }),
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const computation = await computeConventionFees(args.companyId, args.conventionId, { periodStart: args.periodStart, periodEnd: args.periodEnd }, group)
        const { result } = computation
        return json({
          convention: { id: computation.convention.id, label: computation.convention.label },
          period: computation.period,
          pricing: result.pricing,
          allocationKey: result.allocationKey,
          costPool: computation.costPool
            ? {
                total: fromCents(computation.costPool.totalCents),
                accounts: computation.costPool.accounts.map((a) => ({ code: a.code, label: a.label, amount: fromCents(a.cents) })),
                excludedAccounts: computation.costPool.excluded.map((a) => ({ code: a.code, label: a.label, amount: fromCents(a.cents) })),
              }
            : null,
          costSharePercent: result.costShareBp / 100,
          markupPercent: result.markupBp / 100,
          base: fromCents(result.baseCents),
          markup: fromCents(result.markupCents),
          totalExclTax: fromCents(result.totalExclTaxCents),
          totalVat: fromCents(result.totalVatCents),
          totalInclTax: fromCents(result.totalInclTaxCents),
          vatRatePercent: result.vatRateBp / 100,
          subsidiaries: result.parts.map((p) => ({
            id: p.subsidiaryId,
            name: p.name,
            eligibleDays: p.eligibleDays,
            revenue: p.revenueCents === null ? null : fromCents(p.revenueCents),
            sharePercent: p.sharePercentBp === null ? null : p.sharePercentBp / 100,
            amountExclTax: fromCents(p.amountExclTaxCents),
            vat: fromCents(p.vatCents),
            amountInclTax: fromCents(p.amountInclTaxCents),
          })),
          alreadyInvoiced: computation.billed,
          warnings: computation.warnings,
        })
      }),
  )
}
