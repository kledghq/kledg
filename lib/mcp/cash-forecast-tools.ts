/**
 * Read tool of the cash forecast (lib/cash-forecast, page Prévision de
 * trésorerie): get_cash_forecast. Same rule as GET /api/cash-forecast: the
 * company guard with CASH_FORECAST_PERMISSION (reports:read and
 * banking:read), then the service reads everything in the company's scope.
 * The threshold, horizon and default components are company settings:
 * read with get_company_settings (section cash_forecast), changed with
 * update_company_settings (full control).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { fromCents } from '@/lib/utils/money'
import { CASH_FORECAST_COMPONENTS, COMPONENT_INFO } from '@/lib/cash-forecast/components'
import { CashForecastQuerySchema, getCashForecast } from '@/lib/cash-forecast/load-cash-forecast.service'
import { alertOf } from '@/lib/cash-forecast/alert'
import { CASH_FORECAST_PERMISSION } from '@/lib/cash-forecast/permissions'
import { parseInput } from '@/lib/api/zod-fields'
import { NOT_A_GUARANTEE } from '@/lib/cash-forecast/wording'

export function registerCashForecastTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_cash_forecast',
    {
      title: 'Prévision de trésorerie',
      description: describeTool({
        summary:
          "Projects the company's bank balance over the next 3, 6 or 12 months, by month or by week, from today's balance (the balances the banks report for euro accounts, else the 512 accounts) plus the known flows, each one a component: receivables (open 411 invoices at their due date, late ones on the first day), payables (open 401 invoices), taxes (unpaid tax deadlines whose amount is known: next VAT return, corporate tax instalments and balance, CFE; deadlines without an amount are listed in unknownTaxes, not counted), recurring (subscriptions and recurring charges detected in the bank lines), budget (planned produits and charges of the budget from next month, excluding tax, assumption) and trend (average monthly bank change of the last three complete months, assumption). By default the components and horizon saved in the company settings; budget and trend overlap the known flows. Returns each period (opening, inflows, outflows, net by component, closing, lowest balance), the lowest balance of the horizon, the minimum cash threshold and the first day the balance goes under it (alert), and optionally every flow. A projection from what the books hold today, not a guarantee.",
        access: 'read',
        permission: CASH_FORECAST_PERMISSION,
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd; a period is yyyy-mm (month) or the Monday yyyy-mm-dd (week).',
        never: 'changes the threshold or the settings (update_company_settings, section cash_forecast, does), books or pays anything (read only).',
      }),
      inputSchema: z.object({
        companyId: z.string().describe('Company id, from list_companies.'),
        horizonMonths: z.union([z.literal(3), z.literal(6), z.literal(12)]).optional().describe('3, 6 or 12; the saved horizon by default.'),
        granularity: z.enum(['month', 'week']).default('month'),
        components: z.array(z.enum(CASH_FORECAST_COMPONENTS)).optional().describe('Components to count; the saved ones by default.'),
        includeFlows: z.boolean().default(false).describe('true: also return every flow counted (day, component, label, amount, late).'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, CASH_FORECAST_PERMISSION)
        const query = parseInput(CashForecastQuerySchema, {
          horizon: args.horizonMonths === undefined ? undefined : String(args.horizonMonths),
          granularity: args.granularity,
          components: args.components === undefined ? undefined : args.components.join(','),
        })
        const view = await getCashForecast(args.companyId, query)
        const { projection } = view
        const alert = alertOf(view)
        return json({
          today: view.today,
          from: projection.start,
          to: projection.end,
          horizonMonths: projection.horizonMonths,
          granularity: projection.granularity,
          notice: NOT_A_GUARANTEE.expert,
          opening: {
            balance: fromCents(view.opening.cents),
            source: view.opening.source,
            bankAccounts: view.opening.bankAccounts,
            otherCurrencyAccountsLeftOut: view.opening.otherCurrencies,
            ledgerBalance512: view.opening.ledgerCents === null ? null : fromCents(view.opening.ledgerCents),
          },
          components: CASH_FORECAST_COMPONENTS.map((c) => ({
            id: c,
            label: COMPONENT_INFO[c].label,
            counted: projection.components.includes(c),
            assumption: COMPONENT_INFO[c].assumption,
            available: view.availability[c].available,
            whyEmpty: view.availability[c].reason,
            inflows: fromCents(projection.totals[c].inflowsCents),
            outflows: fromCents(projection.totals[c].outflowsCents),
          })),
          periods: projection.periods.map((p) => ({
            period: p.period,
            from: p.start,
            to: p.end,
            opening: fromCents(p.openingCents),
            inflows: fromCents(p.inflowsCents),
            outflows: fromCents(p.outflowsCents),
            byComponent: Object.fromEntries(Object.entries(p.byComponent).map(([c, cents]) => [c, fromCents(cents as number)])),
            closing: fromCents(p.closingCents),
            lowest: fromCents(p.lowestCents),
            lowestDay: p.lowestDay,
            belowThreshold: p.belowThreshold,
          })),
          closing: fromCents(projection.closingCents),
          lowest: { day: projection.lowest.day, balance: fromCents(projection.lowest.cents) },
          threshold: projection.thresholdCents === null ? null : fromCents(projection.thresholdCents),
          alert: alert ? { firstDayBelow: alert.day, balance: fromCents(alert.balanceCents), alreadyBelowToday: alert.already } : null,
          trend: view.trend ? { monthlyChange: fromCents(view.trend.monthlyCents), months: view.trend.months } : null,
          unknownTaxes: view.unknownTaxes,
          flows: args.includeFlows
            ? view.items
                .filter((item) => projection.components.includes(item.component))
                .map((item) => ({ day: item.day, until: item.until ?? null, component: item.component, label: item.label, amount: fromCents(item.amountCents), late: Boolean(item.overdue) }))
            : undefined,
          flowsLeftOut: view.truncated,
        })
      }),
  )
}
