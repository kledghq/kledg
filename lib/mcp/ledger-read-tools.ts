/**
 * Read tools of the books (kledg:read): one entry, the general ledger and
 * the journal report, the fixed assets with their depreciation, and the
 * keyword rules of expense categories. Each one checks the right of the
 * matching API route through the company guard, then calls the service of
 * that route (every query is scoped by the granted company). Amounts in
 * euros (lib/mcp/euros.ts).
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { CompanyGuard } from '@/lib/mcp/company-access'
import { json, run } from '@/lib/mcp/tool-result'
import { READ_ONLY, describeTool } from '@/lib/mcp/tool-meta'
import { forAssistant } from '@/lib/mcp/euros'
import { parseInput } from '@/lib/api/zod-fields'
import { ValidationError } from '@/lib/accounting/errors'
import { getCompanyEntry } from '@/lib/accounting/services'
import { getGrandLivre } from '@/lib/reports/ledger/grand-livre'
import { getJournalReport } from '@/lib/reports/journal/get-journal-report.service'
import { JournalReportQuerySchema, LedgerPeriodQuerySchema } from '@/lib/reports/report-query'
import { getFixedAsset, getFixedAssetStats, listFixedAssets } from '@/lib/fixed-assets/read-fixed-assets.service'
import { getDepreciationStatus } from '@/lib/fixed-assets/get-depreciation-status.service'
import { listLinkCandidates } from '@/lib/fixed-assets/manage-depreciation-records.service'
import { listCategoryRules } from '@/lib/expense-reports/manage-category-rules.service'

const companyId = z.string().describe('Company id, from list_companies.')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ')

/** Lines returned at most by the ledger reports (the assistant narrows the period or the accounts). */
const MAX_LINES = 1000

export function registerLedgerReadTools(server: McpServer, guard: CompanyGuard) {
  server.registerTool(
    'get_entry',
    {
      title: 'Lire une écriture',
      description: describeTool({
        summary:
          'Returns one accounting entry with its journal, date, number (definitive once validated), status, piece reference, fiscal year and every line (account, label, debit, credit, lettering, auxiliary account). Entry ids come from list_entries.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'changes the entry (read only).',
      }),
      inputSchema: z.object({ companyId, entryId: z.string().min(1).max(64).describe('Entry id, from list_entries.') }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        return json(forAssistant(await getCompanyEntry(args.companyId, args.entryId)))
      }),
  )

  server.registerTool(
    'get_ledger_report',
    {
      title: 'Grand livre ou journal',
      description: describeTool({
        summary:
          'Returns the general ledger (report general_ledger: per account, opening balance, lines of the period with a running balance, closing balance, like the Grand livre page) or the journal report (report journal: lines per journal with totals, like the Journal page) of a period within one fiscal year. Narrow with accountPrefix (general ledger) or journalId (journal); at most 1000 lines (general ledger) or entries (journal) are returned, with truncated: true beyond.',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId,
        report: z.enum(['general_ledger', 'journal']),
        fiscalYearId: z.string().max(64).optional().describe('Fiscal year id (general ledger), from list_fiscal_years. Defaults to the one containing startDate, else the current one.'),
        startDate: day.optional(),
        endDate: day.optional(),
        accountPrefix: z.string().regex(/^\d{1,10}$/, 'Préfixe de compte invalide').optional().describe('General ledger: only the accounts whose number starts with it, e.g. 401.'),
        journalId: z.string().max(64).optional().describe('Journal report: one journal id (from list_journals), all journals by default.'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { reports: ['read'] })
        if (args.report === 'journal') {
          const query = parseInput(JournalReportQuerySchema, { journalId: args.journalId, startDate: args.startDate, endDate: args.endDate })
          const report = await getJournalReport({ companyId: args.companyId, ...query })
          let budget = MAX_LINES
          const journals = report.journals.map((journal) => {
            const entries = journal.entries.slice(0, Math.max(budget, 0))
            budget -= journal.entries.length
            return { ...journal, entries }
          })
          return json(forAssistant({ journals, grandTotals: report.grandTotals, truncated: budget < 0 }))
        }
        const query = parseInput(LedgerPeriodQuerySchema, { fiscalYearId: args.fiscalYearId, startDate: args.startDate, endDate: args.endDate })
        const ledger = await getGrandLivre({ companyId: args.companyId, ...query })
        const accounts = args.accountPrefix ? ledger.accounts.filter((a) => a.account.code.startsWith(args.accountPrefix!)) : ledger.accounts
        let budget = MAX_LINES
        const limited = accounts.map((a) => {
          const entryLines = a.entryLines.slice(0, Math.max(budget, 0))
          budget -= a.entryLines.length
          return { ...a, entryLines }
        })
        return json(forAssistant({ fiscalYear: ledger.fiscalYear, period: ledger.period, accounts: limited, totals: ledger.totals, truncated: budget < 0 }))
      }),
  )

  server.registerTool(
    'list_fixed_assets',
    {
      title: 'Lister les immobilisations',
      description: describeTool({
        summary:
          'Lists the fixed assets (immobilisations) with their accounts, values and depreciation plan, and the totals (view list). With fixedAssetId: view asset gives one asset with its depreciation records, view depreciation_status the depreciation booked and to book per fiscal year, view link_candidates (with recordId) the entries a depreciation record may be linked to.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd, rates in percent, durations in years.',
        never: 'books, changes or deletes anything (read only).',
      }),
      inputSchema: z.object({
        companyId,
        view: z.enum(['list', 'asset', 'depreciation_status', 'link_candidates']).default('list'),
        fixedAssetId: z.string().max(64).optional().describe('Fixed asset id, from the list (views asset, depreciation_status, link_candidates).'),
        recordId: z.string().max(64).optional().describe('Depreciation record id, from view asset (view link_candidates).'),
      }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        if (args.view === 'list') {
          const [assets, stats] = await Promise.all([listFixedAssets(args.companyId), getFixedAssetStats(args.companyId)])
          return json(forAssistant({ assets, stats }))
        }
        if (!args.fixedAssetId) throw new ValidationError("fixedAssetId est requis pour cette vue.")
        if (args.view === 'asset') return json(forAssistant(await getFixedAsset(args.companyId, args.fixedAssetId)))
        if (args.view === 'depreciation_status') return json(forAssistant(await getDepreciationStatus(args.companyId, args.fixedAssetId)))
        if (!args.recordId) throw new ValidationError('recordId est requis pour la vue link_candidates.')
        return json(forAssistant(await listLinkCandidates(args.companyId, args.fixedAssetId, args.recordId)))
      }),
  )

  server.registerTool(
    'list_expense_category_rules',
    {
      title: 'Règles de catégories des notes de frais',
      description: describeTool({
        summary:
          'Lists the keyword rules that give the category (and the account) of expense report lines, by priority, as the expense report editor applies them (docs/notes-de-frais.md). Change them with manage_expense_settings (full control).',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'none',
        never: 'changes a rule or an expense report (read only).',
      }),
      inputSchema: z.object({ companyId }),
      annotations: READ_ONLY,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        return json(forAssistant(await listCategoryRules(args.companyId)))
      }),
  )
}
