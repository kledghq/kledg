/**
 * Read tools of the financial indicators (docs/indicateurs-financiers.md):
 * get_sig, the soldes intermédiaires de gestion and the CAF of a fiscal year
 * and of the previous one, and get_financial_ratios, the BFR, net cash,
 * payment delays and ratios. Same rule as the web UI: the company guard with
 * reports:read (so the connection's company grant applies), then the service
 * scopes everything by company. Amounts in euros, ratios as fractions.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { getFinancialIndicators } from '@/lib/reports/financial-indicators/get-financial-indicators.service'
import type { FinancialIndicators } from '@/lib/reports/financial-indicators/indicators'
import { fromCents } from '@/lib/utils/money'

const input = z.object({
  companyId: z.string().describe('Company id, from list_companies.'),
  fiscalYearId: z
    .string()
    .optional()
    .describe('Fiscal year id, from list_fiscal_years. Defaults to the current fiscal year. The previous fiscal year is returned too, for comparison.'),
})

/** Every `...Cents` field of an object as euros, without the suffix. */
function euros<T extends object>(values: T): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number' && key.endsWith('Cents')) out[key.slice(0, -'Cents'.length)] = fromCents(value)
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  return out
}

const sigOf = (i: FinancialIndicators) => ({ sig: euros(i.sig), caf: euros(i.caf) })

const ratiosOf = (i: FinancialIndicators) => ({
  balanceSheet: euros(i.bilan),
  paymentDelays: euros(i.delais),
  ratios: i.ratios,
})

export function registerFinancialIndicatorTools(server: McpServer, guard: CompanyGuard) {
  const readOnly = READ_ONLY

  server.registerTool(
    'get_sig',
    {
      title: 'Soldes intermédiaires de gestion',
      description: describeTool({
        summary:
          "Returns the soldes intermédiaires de gestion (SIG) of a fiscal year and of the previous one, from the validated entries (closing entries excluded, like the income statement), per the PCG account mapping and the lines of cerfa 2052-SD/2053-SD: marge commerciale, production de l'exercice, valeur ajoutée, excédent brut d'exploitation (EBE), résultat d'exploitation, résultat courant avant impôts, résultat exceptionnel, résultat de l'exercice (equal to the income statement result), plus-values de cession, and the capacité d'autofinancement (CAF, additive method, checked against the subtractive method).",
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        never: 'changes anything (read only).',
      }),
      inputSchema: input,
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const report = await getFinancialIndicators(args.companyId, { fiscalYearId: args.fiscalYearId })
        return json({
          fiscalYear: report.fiscalYear,
          current: sigOf(report.current),
          previous: report.previous ? { fiscalYear: report.previous.fiscalYear, ...sigOf(report.previous.indicators) } : null,
        })
      }),
  )

  server.registerTool(
    'get_financial_ratios',
    {
      title: 'Ratios financiers',
      description: describeTool({
        summary:
          "Returns the balance sheet indicators and ratios of a fiscal year and of the previous one: besoin en fonds de roulement (stocks + créances clients + autres créances d'exploitation - dettes fournisseurs - dettes fiscales et sociales, from the balance sheet lines), trésorerie nette (placements + disponibilités - concours bancaires), dettes financières, capitaux propres, DSO and DPO in days (receivables and payables including VAT over sales and purchases brought to TTC with the VAT recorded on them, over the days elapsed in the year until asOf), taux de marge, taux de marque, EBE and result over turnover, and ratio d'endettement (dettes financières / capitaux propres).",
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Ratios as fractions (0.25 = 25 %), null when the denominator is zero or negative; DSO and DPO in days.',
        never: 'changes anything (read only).',
      }),
      inputSchema: input,
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        const report = await getFinancialIndicators(args.companyId, { fiscalYearId: args.fiscalYearId })
        return json({
          fiscalYear: report.fiscalYear,
          current: ratiosOf(report.current),
          previous: report.previous ? { fiscalYear: report.previous.fiscalYear, ...ratiosOf(report.previous.indicators) } : null,
        })
      }),
  )
}
