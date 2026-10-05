/**
 * Read tool of the file exports: export_report, one tool for the sixteen
 * export routes (balance sheet and income statement PDF and Excel, annexe,
 * fixed asset movements, corporate tax, VAT return, local taxes,
 * remuneration, financial indicators, aged and auxiliary balances, journal,
 * cash forecast, group). For each report, the same rule as its route:
 * - the company guard with the route's right (reports:export, the
 *   *_EXPORT constants of each feature), so the connection's grant and the
 *   user's role apply; the group exports check each subsidiary read through
 *   the guard too (mcpGroupAccess);
 * - the route's own query schema parses the parameters (same French
 *   messages), then the same service generates the file;
 * - the export rate limit of the routes.
 * The file is returned as an MCP embedded resource (lib/mcp/file-result.ts):
 * no download URL is ever created.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard, McpAccess } from '@/lib/mcp/company-access'
import { run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { fileResult, MAX_MCP_FILE_BYTES } from '@/lib/mcp/file-result'
import { mcpGroupAccess } from '@/lib/mcp/corporate-tax-tools'
import { enforceRateLimit } from '@/lib/rate-limit'
import type { GeneratedFile } from '@/lib/api/download'
import type { Permission } from '@/lib/rbac/authorize'
import type { GroupAccess } from '@/lib/management-fees/access'
import { StatementExportQuerySchema, StatementQuerySchema, JournalReportQuerySchema } from '@/lib/reports/report-query'
import {
  exportBalanceSheetExcel,
  exportBalanceSheetPdf,
  exportIncomeStatementExcel,
  exportIncomeStatementPdf,
  exportJournalExcel,
} from '@/lib/reports/export-reports.service'
import { AnnexeExportQuerySchema } from '@/lib/annexe/schemas'
import { exportAnnexe } from '@/lib/annexe/export-annexe.service'
import { exportFixedAssetMovements, FixedAssetExportQuerySchema } from '@/lib/annexe/export-fixed-asset-movements.service'
import { CorporateTaxExportQuerySchema, exportCorporateTax } from '@/lib/corporate-tax/export-corporate-tax.service'
import { CORPORATE_TAX_EXPORT } from '@/lib/corporate-tax/permissions'
import { exportVatReturn, VatReturnExportQuerySchema } from '@/lib/vat-returns/export-vat-return.service'
import { VAT_RETURN_EXPORT } from '@/lib/vat-returns/permissions'
import { exportLocalTaxes, LocalTaxesExportQuerySchema } from '@/lib/local-taxes/export-local-taxes.service'
import { LOCAL_TAXES_EXPORT } from '@/lib/local-taxes/permissions'
import { exportRemuneration, RemunerationExportQuerySchema } from '@/lib/remuneration/export-remuneration.service'
import { REMUNERATION_EXPORT } from '@/lib/remuneration/permissions'
import {
  exportFinancialIndicators,
  FinancialIndicatorsExportQuerySchema,
} from '@/lib/reports/financial-indicators/export-financial-indicators.service'
import { AgedBalanceQuerySchema, AuxiliaryBalanceQuerySchema } from '@/lib/reports/third-parties/get-third-party-reports.service'
import { exportAgedBalanceExcel, exportAuxiliaryBalanceExcel } from '@/lib/reports/third-parties/export-third-party-reports.service'
import { exportGroup, GROUP_REPORTS, GroupExportQuerySchema } from '@/lib/group/export-group.service'
import { CashForecastQuerySchema } from '@/lib/cash-forecast/load-cash-forecast.service'
import { exportCashForecast } from '@/lib/cash-forecast/export-cash-forecast.service'

const REPORT_EXPORT: Permission = { reports: ['export'] }

interface ExportDefinition {
  /** The right of the route, checked in the company. */
  permission: Permission
  /** The route's query schema and its service. */
  generate: (companyId: string, query: Record<string, string>, group: GroupAccess) => Promise<GeneratedFile>
}

/** An export: the route's schema parses the query (French messages), then its service runs. */
function exportOf<S extends z.ZodType>(
  permission: Permission,
  schema: S,
  generate: (companyId: string, query: z.output<S>, group: GroupAccess) => Promise<GeneratedFile>,
): ExportDefinition {
  return { permission, generate: async (companyId, query, group) => generate(companyId, schema.parse(query), group) }
}

/** Every export route, by report name (route in the comment). */
export const EXPORTS = {
  /** GET /api/companies/[id]/balance-sheet/export-pdf */
  balance_sheet_pdf: exportOf(REPORT_EXPORT, StatementQuerySchema, (companyId, query) => exportBalanceSheetPdf(companyId, query)),
  /** GET /api/companies/[id]/balance-sheet/export-excel */
  balance_sheet_excel: exportOf(REPORT_EXPORT, StatementExportQuerySchema, (companyId, query) => exportBalanceSheetExcel(companyId, query)),
  /** GET /api/companies/[id]/income-statement/export-pdf */
  income_statement_pdf: exportOf(REPORT_EXPORT, StatementQuerySchema, (companyId, query) => exportIncomeStatementPdf(companyId, query)),
  /** GET /api/companies/[id]/income-statement/export-excel */
  income_statement_excel: exportOf(REPORT_EXPORT, StatementQuerySchema, (companyId, query) => exportIncomeStatementExcel(companyId, query)),
  /** GET /api/annexe/export */
  annexe: exportOf(REPORT_EXPORT, AnnexeExportQuerySchema, (companyId, query, group) => exportAnnexe(companyId, query.fiscalYearId, query.format, group)),
  /** GET /api/reports/fixed-asset-movements/export */
  fixed_asset_movements: exportOf(REPORT_EXPORT, FixedAssetExportQuerySchema, (companyId, query) => exportFixedAssetMovements(companyId, query)),
  /** GET /api/companies/[id]/corporate-tax/export */
  corporate_tax: exportOf(CORPORATE_TAX_EXPORT, CorporateTaxExportQuerySchema, (companyId, query, group) => exportCorporateTax(companyId, query, { access: group })),
  /** GET /api/companies/[id]/vat-returns/export */
  vat_return: exportOf(VAT_RETURN_EXPORT, VatReturnExportQuerySchema, (companyId, query) => exportVatReturn(companyId, query)),
  /** GET /api/companies/[id]/local-taxes/export */
  local_taxes: exportOf(LOCAL_TAXES_EXPORT, LocalTaxesExportQuerySchema, (companyId, query) => exportLocalTaxes(companyId, query)),
  /** GET /api/companies/[id]/remuneration/export */
  remuneration: exportOf(REMUNERATION_EXPORT, RemunerationExportQuerySchema, (companyId, query) => exportRemuneration(companyId, query)),
  /** GET /api/reports/financial-indicators/export */
  financial_indicators: exportOf(REPORT_EXPORT, FinancialIndicatorsExportQuerySchema, (companyId, query) => exportFinancialIndicators(companyId, query)),
  /** GET /api/reports/aged-balance/export-excel */
  aged_balance_excel: exportOf(REPORT_EXPORT, AgedBalanceQuerySchema, (companyId, query) => exportAgedBalanceExcel(companyId, query)),
  /** GET /api/reports/auxiliary-balance/export-excel */
  auxiliary_balance_excel: exportOf(REPORT_EXPORT, AuxiliaryBalanceQuerySchema, (companyId, query) => exportAuxiliaryBalanceExcel(companyId, query)),
  /** GET /api/reports/journal/export-excel */
  journal_excel: exportOf(REPORT_EXPORT, JournalReportQuerySchema, (companyId, query) => exportJournalExcel(companyId, query)),
  /** GET /api/cash-forecast/export (reports:export and banking:read) */
  cash_forecast: exportOf({ reports: ['export'], banking: ['read'] }, CashForecastQuerySchema, (companyId, query) => exportCashForecast(companyId, query)),
  /** GET /api/group/export (reports:export in the holding, reports:read in each subsidiary read) */
  group: exportOf(REPORT_EXPORT, GroupExportQuerySchema, (companyId, query, group) => exportGroup(companyId, query, group)),
} satisfies Record<string, ExportDefinition>

export type ExportReport = keyof typeof EXPORTS
const REPORTS = Object.keys(EXPORTS) as [ExportReport, ...ExportReport[]]

const text = (max: number) => z.string().max(max)

const InputSchema = z.object({
  companyId: z.string().describe('Company id, from list_companies (the holding for report group).'),
  report: z.enum(REPORTS, { error: 'Rapport inconnu' }).describe('The file to generate.'),
  fiscalYearId: text(100).optional().describe('Fiscal year id, from list_fiscal_years. Required for balance_sheet_*, income_statement_*, annexe and fixed_asset_movements; optional elsewhere (current or latest year).'),
  previousFiscalYearId: text(100).optional().describe('balance_sheet_excel: the N-1 column.'),
  variant: z.enum(['complete', 'simplified']).optional().describe('balance_sheet_*, income_statement_*: layout (complete by default).'),
  format: text(10).optional().describe('annexe: pdf or md; fixed_asset_movements, corporate_tax, vat_return, local_taxes, remuneration: pdf or csv; financial_indicators, group: csv or xlsx. The default of the route otherwise.'),
  startDate: text(30).optional().describe('auxiliary_balance_excel, journal_excel, group (transactions): first day, yyyy-mm-dd.'),
  endDate: text(30).optional().describe('auxiliary_balance_excel, journal_excel, group (transactions): last day, yyyy-mm-dd.'),
  asOf: text(30).optional().describe('aged_balance_excel: the day of the aged balance, yyyy-mm-dd.'),
  journalId: text(100).optional().describe('journal_excel: one journal (all journals by default).'),
  period: text(20).optional().describe('vat_return: the period, yyyy-mm, yyyy-Tn or yyyy (the next return due by default).'),
  year: z.number().int().optional().describe('local_taxes: the year.'),
  deadline: text(60).optional().describe('corporate_tax: a deadline id from list_tax_deadlines (is-acompte, is-solde, liasse).'),
  scenarioId: text(100).optional().describe('remuneration: a saved scenario.'),
  basis: text(20).optional().describe('remuneration: current, projection or closed.'),
  inputs: text(4000).optional().describe('remuneration: the inputs changed, as JSON (same as simulate_remuneration).'),
  horizon: text(3).optional().describe('cash_forecast: 3, 6 or 12 months (the saved horizon by default).'),
  granularity: text(10).optional().describe('cash_forecast: month or week.'),
  components: text(200).optional().describe('cash_forecast: components counted, comma separated (receivables, payables, taxes, recurring, budget, trend); the saved ones by default.'),
  groupReport: z.enum(GROUP_REPORTS).optional().describe('group: which group report (combined by default).'),
  groupFilters: z
    .record(z.string().max(40), text(200))
    .optional()
    .describe('group: other options of the group report, as in the API (prefix, account, company, search, side, reconciled, provisions, asset_sales, waivers, financial_charges, other).'),
})

type Input = z.infer<typeof InputSchema>

/** The query string of the route, from the tool's arguments (strings, like a URL query). */
export function exportQuery(args: Input): Record<string, string> {
  const { companyId: _companyId, report: _report, groupReport, groupFilters, year, ...rest } = args
  void _companyId
  void _report
  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(groupFilters ?? {})) if (key !== 'companyId') query[key] = value
  for (const [key, value] of Object.entries(rest)) if (value !== undefined) query[key] = String(value)
  if (year !== undefined) query.year = String(year)
  if (groupReport) query.report = groupReport
  return query
}

export function registerExportTools(server: McpServer, access: McpAccess, guard: CompanyGuard) {
  server.registerTool(
    'export_report',
    {
      title: 'Exporter un état en fichier',
      description: describeTool({
        summary: `Generates the file of a report, exactly as its download button in Kledg (same service, same checks), and returns it in the result as an embedded resource (base64 blob with its MIME type and file name): balance_sheet_pdf, balance_sheet_excel, income_statement_pdf, income_statement_excel, annexe (pdf or md), fixed_asset_movements (2054, 2055, 2033-C; pdf or csv), corporate_tax, vat_return, local_taxes, remuneration (pdf or csv), financial_indicators (csv or xlsx), aged_balance_excel, auxiliary_balance_excel, journal_excel, group (holding and subsidiaries; csv or xlsx). Files above ${MAX_MCP_FILE_BYTES / 1024 / 1024} MB are refused: the user downloads them from Kledg. To read the figures, prefer the matching read tool (get_balance_sheet, get_vat_return...).`,
        access: 'read',
        permission: REPORT_EXPORT,
        amounts: 'euros',
        units: 'Amounts in the file are in euros. Dates as yyyy-mm-dd.',
        never: 'creates a download link or a public URL, files a return, or changes anything (read only).',
      }),
      inputSchema: InputSchema,
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        const definition = EXPORTS[args.report]
        await guard.require(args.companyId, definition.permission)
        await enforceRateLimit('export', access.user.id)
        const file = await definition.generate(args.companyId, exportQuery(args), mcpGroupAccess(access, guard))
        return fileResult(file, `companies/${args.companyId}/exports/${args.report}`, { report: args.report })
      }),
  )
}
