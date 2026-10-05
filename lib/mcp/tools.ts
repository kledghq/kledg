/**
 * MCP tools exposed by a Kledg instance at /api/mcp.
 *
 * Every tool runs as the connected user and goes through the same per-company
 * access control as the web UI, narrowed to the companies granted to the
 * connection: all through `companyGuard` (lib/mcp/company-access.ts), never
 * through ad hoc checks. The write tool of this file only creates drafts: a
 * human validates them in Kledg before they count in the books. Tools that act
 * beyond drafts (full control, kledg:admin) live in lib/mcp/full-control and
 * are registered only for connections with full control.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { companyGuard, type McpAccess } from '@/lib/mcp/company-access'
import { getTrialBalance } from '@/lib/reports/trial-balance/get-trial-balance.service'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import { generateIncomeStatement } from '@/lib/reports/income-statement/generate-income-statement.service'
import { createAccountingEntry } from '@/lib/accounting/services'
import { toEntryDate } from '@/lib/accounting/entry-date'
import { assertEntryWritableInFiscalYear, GUARDED_FISCAL_YEAR_SELECT } from '@/lib/accounting/entry-guards'
import { getFiscalYearForDate } from '@/lib/accounting/fiscal-year-utils'
import { getActiveFiscalYear } from '@/lib/accounting/fiscal-year-utils'
import { writeAuditLog } from '@/lib/audit'
import { NotFoundError } from '@/lib/accounting/errors'
import { day, fail, json, run } from '@/lib/mcp/tool-result'
import { registerFullControlTools } from '@/lib/mcp/full-control'
import { getAgedBalance } from '@/lib/reports/third-parties/get-third-party-reports.service'
import type { AgedSection, BucketAmounts } from '@/lib/reports/third-parties/third-party-balances'
import { listMissingReceipts } from '@/lib/banking/missing-receipts.service'
import { fromCents, toCents } from '@/lib/utils/money'
import { listTiers } from '@/lib/tiers/manage-tiers.service'
import { getInvoice, listInvoices } from '@/lib/invoices/manage-invoices.service'
import { registerExpenseReportReadTools } from '@/lib/mcp/expense-report-tools'
import { registerBudgetReadTools } from '@/lib/mcp/budget-tools'
import { registerManagementFeeTools } from '@/lib/mcp/management-fee-tools'
import { registerGroupTools } from '@/lib/mcp/group-tools'
import { registerSubscriptionReadTools } from '@/lib/mcp/subscription-tools'
import { registerSimpleModeReadTools } from '@/lib/mcp/simple-mode-tools'
import { registerFinancialIndicatorTools } from '@/lib/mcp/financial-indicator-tools'
import { registerYearEndReadTools } from '@/lib/mcp/year-end-tools'
import { registerApprovalReadTools } from '@/lib/mcp/approval-tools'
import { registerAnnexeReadTools } from '@/lib/mcp/annexe-tools'
import { registerDeadlineReadTools } from '@/lib/mcp/deadline-tools'
import { registerCashForecastTools } from '@/lib/mcp/cash-forecast-tools'
import { registerVatReturnReadTools } from '@/lib/mcp/vat-return-tools'
import { registerCorporateTaxReadTools } from '@/lib/mcp/corporate-tax-tools'
import { registerRemunerationReadTools } from '@/lib/mcp/remuneration-tools'
import { registerLocalTaxReadTools } from '@/lib/mcp/local-tax-tools'
import { registerTrainingReadTools } from '@/lib/mcp/training-tools'
import { registerBankingReadTools } from '@/lib/mcp/banking-tools'
import { registerThirdPartyReadTools } from '@/lib/mcp/third-party-tools'
import { registerDraftTools } from '@/lib/mcp/drafts'
import { registerLedgerReadTools } from '@/lib/mcp/ledger-read-tools'
import { registerCompanySettingsTools } from '@/lib/mcp/company-settings-tools'
import { registerTransactionReadTools } from '@/lib/mcp/transaction-read-tools'
import { registerExportTools } from '@/lib/mcp/export-tools'
import { registerDocumentTools } from '@/lib/mcp/document-tools'
import { registerCompanyLookupTools } from '@/lib/mcp/company-lookup-tools'
import { READ_ONLY, describeTool, kledgPageUrl, writeAnnotations } from '@/lib/mcp/tool-meta'
import { viewMeta, withView } from '@/lib/mcp/views'
import {
  balanceSheetView,
  bankTransactionsList,
  entriesList,
  incomeStatementView,
  invoiceDocument,
  missingReceiptsList,
  trialBalanceView,
} from '@/lib/mcp/views/builders'

const MAX_ROWS = 200

/** Bucket amounts of the aged balance in euros, for the assistants. */
function agedEuros(buckets: BucketAmounts) {
  return {
    notDue: fromCents(buckets.notDue),
    overdue0to30: fromCents(buckets.days0to30),
    overdue31to60: fromCents(buckets.days31to60),
    overdue61to90: fromCents(buckets.days61to90),
    overdueOver90: fromCents(buckets.over90),
    total: fromCents(buckets.totalCents),
  }
}

async function resolveFiscalYear(companyId: string, fiscalYearId?: string) {
  const fiscalYear = fiscalYearId
    ? await prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId } })
    : await getActiveFiscalYear(companyId)
  if (!fiscalYear) throw new NotFoundError('Exercice introuvable pour cette société.')
  return fiscalYear
}

const companyId = z.string().describe('Company id, from list_companies.')
const fiscalYearId = z
  .string()
  .optional()
  .describe('Fiscal year id, from list_fiscal_years. Defaults to the current fiscal year.')
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ')

export function registerKledgTools(server: McpServer, access: McpAccess) {
  const { user, canWrite } = access
  const guard = companyGuard(access)
  const readOnly = READ_ONLY

  server.registerTool(
    'list_companies',
    {
      title: 'Lister les sociétés',
      description: describeTool({
        summary:
          'Lists the companies this connection can access on this Kledg instance (the user may have limited it to some of their companies), with their SIREN, legal form, fiscal regimes and current fiscal year. Start here to get company ids. Archived companies (read-only) are left out unless includeArchived is true; they then carry their archivedAt.',
        access: 'read',
        permission: 'membership',
        amounts: 'none',
        never: "lists a company outside the connection's grant, and never changes anything (read only).",
      }),
      inputSchema: z.object({
        includeArchived: z.boolean().optional().describe('true: also the archived companies (read-only, restore_company restores them).'),
      }),
      annotations: readOnly,
    },
    ({ includeArchived }) =>
      run(async () => {
        const companies = await prisma.company.findMany({
          where: await guard.companyWhere({ includeArchived: includeArchived === true }),
          select: {
            archivedAt: true,
            id: true,
            name: true,
            siren: true,
            legalType: true,
            vatRegime: true,
            corporateTaxRegime: true,
            isVatExempt: true,
            fiscalYears: {
              where: { isClosed: false },
              orderBy: { startDate: 'desc' },
              take: 1,
              select: { id: true, year: true, startDate: true, endDate: true },
            },
          },
          orderBy: { name: 'asc' },
        })
        return json(
          companies.map(({ fiscalYears, archivedAt, ...c }) => ({
            ...c,
            ...(includeArchived === true && { archivedAt: archivedAt?.toISOString() ?? null }),
            currentFiscalYear: fiscalYears[0]
              ? { ...fiscalYears[0], startDate: day(fiscalYears[0].startDate), endDate: day(fiscalYears[0].endDate) }
              : null,
          })),
        )
      }),
  )

  server.registerTool(
    'list_fiscal_years',
    {
      title: 'Lister les exercices',
      description: describeTool({
        summary:
          'Lists the fiscal years of a company with their dates and whether they are closed.',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'none',
        units: 'Dates as yyyy-mm-dd.',
        never: 'changes anything (read only).',
      }),
      inputSchema: z.object({ companyId }),
      annotations: readOnly,
    },
    ({ companyId }) =>
      run(async () => {
        await guard.require(companyId, { reports: ['read'] })
        const years = await prisma.fiscalYear.findMany({
          where: { companyId },
          orderBy: { startDate: 'desc' },
          select: { id: true, year: true, startDate: true, endDate: true, isClosed: true },
        })
        return json(years.map((y) => ({ ...y, startDate: day(y.startDate), endDate: day(y.endDate) })))
      }),
  )

  server.registerTool(
    'list_journals',
    {
      title: 'Lister les journaux',
      description: describeTool({
        summary:
          'Lists the accounting journals of a company (code and label, e.g. AC achats, VE ventes, BQ banque, OD opérations diverses).',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'none',
        never: 'changes anything (read only).',
      }),
      inputSchema: z.object({ companyId }),
      annotations: readOnly,
    },
    ({ companyId }) =>
      run(async () => {
        await guard.require(companyId, { entries: ['read'] })
        const journals = await prisma.journal.findMany({
          where: { companyId },
          orderBy: { code: 'asc' },
          select: { code: true, label: true },
        })
        return json(journals)
      }),
  )

  server.registerTool(
    'search_accounts',
    {
      title: 'Rechercher des comptes',
      description: describeTool({
        summary:
          'Searches the chart of accounts (PCG 2026) of a company in a fiscal year by account number prefix or label. Use it to find the right account before proposing an entry.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'none',
        never: 'creates an account (create_account does, in full control); changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId,
        fiscalYearId,
        query: z.string().optional().describe('Account number prefix (e.g. "606", "401") or words of the label. PCG account numbers have 4 or more digits, e.g. 6064, 44566, 401.'),
      }),
      annotations: readOnly,
    },
    ({ companyId, fiscalYearId, query }) =>
      run(async () => {
        await guard.require(companyId, { entries: ['read'] })
        const fiscalYear = await resolveFiscalYear(companyId, fiscalYearId)
        const q = query?.trim()
        const accounts = await prisma.account.findMany({
          where: {
            companyId,
            fiscalYearId: fiscalYear.id,
            ...(q &&
              (/^\d+$/.test(q)
                ? { code: { startsWith: q } }
                : { label: { contains: q, mode: 'insensitive' as const } })),
          },
          orderBy: { code: 'asc' },
          take: MAX_ROWS,
          select: { code: true, label: true },
        })
        return json(accounts)
      }),
  )

  server.registerTool(
    'get_trial_balance',
    {
      title: 'Balance générale',
      description: describeTool({
        summary:
          'Returns the trial balance (balance générale) of a company between two dates: debit, credit and balance per account.',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'changes anything (read only).',
      }),
      inputSchema: z.object({ companyId, startDate: isoDate, endDate: isoDate }),
      annotations: readOnly,
      _meta: viewMeta('statement'),
    },
    ({ companyId, startDate, endDate }) =>
      run(async () => {
        await guard.require(companyId, { reports: ['read'] })
        const data = await getTrialBalance(companyId, new Date(startDate), new Date(endDate))
        return withView(json(data), () => trialBalanceView(companyId, data))
      }),
  )

  server.registerTool(
    'get_balance_sheet',
    {
      title: 'Bilan',
      description: describeTool({
        summary:
          'Returns the balance sheet (bilan actif / passif, PCG 2026 layout) of a company for a fiscal year, complete or simplified.',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        never: 'changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId,
        fiscalYearId,
        variant: z.enum(['complete', 'simplified']).default('simplified'),
      }),
      annotations: readOnly,
      _meta: viewMeta('statement'),
    },
    ({ companyId, fiscalYearId, variant }) =>
      run(async () => {
        await guard.require(companyId, { reports: ['read'] })
        const fiscalYear = await resolveFiscalYear(companyId, fiscalYearId)
        const data = await generateBalanceSheet(companyId, fiscalYear.id, variant)
        return withView(json(data), () => balanceSheetView(companyId, fiscalYear, variant, data))
      }),
  )

  server.registerTool(
    'get_income_statement',
    {
      title: 'Compte de résultat',
      description: describeTool({
        summary:
          'Returns the income statement (compte de résultat: produits, charges, résultat) of a company for a fiscal year, complete or simplified.',
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        never: 'changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId,
        fiscalYearId,
        variant: z.enum(['complete', 'simplified']).default('simplified'),
      }),
      annotations: readOnly,
      _meta: viewMeta('statement'),
    },
    ({ companyId, fiscalYearId, variant }) =>
      run(async () => {
        await guard.require(companyId, { reports: ['read'] })
        const fiscalYear = await resolveFiscalYear(companyId, fiscalYearId)
        const data = await generateIncomeStatement(companyId, fiscalYear.id, variant)
        return withView(json(data), () => incomeStatementView(companyId, fiscalYear, variant, data))
      }),
  )

  server.registerTool(
    'list_entries',
    {
      title: 'Lister les écritures',
      description: describeTool({
        summary:
          'Lists accounting entries (écritures) with their id, number, status (draft or validated) and lines, newest first. Filter by date range, journal code, account number prefix or status.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId,
        fiscalYearId,
        from: isoDate.optional(),
        to: isoDate.optional(),
        journalCode: z.string().optional(),
        accountCode: z.string().optional().describe('Only entries with a line on an account starting with this number.'),
        status: z.enum(['draft', 'validated']).optional(),
        limit: z.number().int().min(1).max(MAX_ROWS).default(50),
      }),
      annotations: readOnly,
      _meta: viewMeta('actions'),
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        const fiscalYear = await resolveFiscalYear(args.companyId, args.fiscalYearId)
        // Accounts of the year matching the prefix first (a few hundred rows at
        // most): filtering lines through a code prefix on every account of the
        // instance does not use an index.
        const accountIds = args.accountCode
          ? (
              await prisma.account.findMany({
                where: { companyId: args.companyId, fiscalYearId: fiscalYear.id, code: { startsWith: args.accountCode } },
                select: { id: true },
              })
            ).map((a) => a.id)
          : null
        const entries = await prisma.accountingEntry.findMany({
          where: {
            companyId: args.companyId,
            fiscalYearId: fiscalYear.id,
            ...(args.status && { status: args.status }),
            ...((args.from || args.to) && {
              date: {
                ...(args.from && { gte: new Date(args.from) }),
                ...(args.to && { lte: new Date(args.to) }),
              },
            }),
            ...(args.journalCode && { journal: { code: args.journalCode } }),
            ...(accountIds && { lines: { some: { accountId: { in: accountIds } } } }),
          },
          orderBy: [{ date: 'desc' }, { entryNumber: 'desc' }],
          take: args.limit,
          select: {
            id: true,
            entryNumber: true,
            date: true,
            description: true,
            reference: true,
            status: true,
            journal: { select: { code: true } },
            lines: {
              select: { debit: true, credit: true, description: true, account: { select: { code: true, label: true } } },
            },
          },
        })
        const result = entries.map((e) => ({
          id: e.id,
          number: e.entryNumber,
          date: day(e.date),
          journal: e.journal.code,
          description: e.description,
          reference: e.reference,
          status: e.status,
          lines: e.lines.map((l) => ({
            account: l.account.code,
            accountLabel: l.account.label,
            debit: l.debit,
            credit: l.credit,
            label: l.description,
          })),
        }))
        return withView(json(result), () => entriesList(args.companyId, access, args, fiscalYear, result))
      }),
  )

  server.registerTool(
    'list_bank_transactions',
    {
      title: 'Lister les transactions bancaires',
      description: describeTool({
        summary:
          'Lists bank transactions of a company, newest first, with amount, side (debit: money out, credit: money in), label, counterparty and reconciliation state. By default only transactions not yet reconciled with an accounting entry, which are the ones that need work.',
        access: 'read',
        permission: { banking: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd, VAT rates in percent.',
        never: 'reconciles or changes a transaction (read only).',
      }),
      inputSchema: z.object({
        companyId,
        onlyUnreconciled: z.boolean().default(true),
        from: isoDate.optional(),
        to: isoDate.optional(),
        limit: z.number().int().min(1).max(MAX_ROWS).default(50),
      }),
      annotations: readOnly,
      _meta: viewMeta('actions'),
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { banking: ['read'] })
        const transactions = await prisma.bankTransaction.findMany({
          where: {
            bankAccount: { bankConnection: { companyId: args.companyId } },
            ...(args.onlyUnreconciled && { reconciled: false }),
            ...((args.from || args.to) && {
              date: {
                ...(args.from && { gte: new Date(args.from) }),
                ...(args.to && { lte: new Date(args.to) }),
              },
            }),
          },
          orderBy: { date: 'desc' },
          take: args.limit,
          select: {
            id: true,
            date: true,
            amount: true,
            side: true,
            label: true,
            counterpartyName: true,
            reference: true,
            vatRate: true,
            reconciled: true,
            bankAccount: { select: { name: true } },
          },
        })
        const result = transactions.map((t) => ({ ...t, date: day(t.date), bankAccount: t.bankAccount.name }))
        return withView(json(result), () => bankTransactionsList(args.companyId, access, args, result))
      }),
  )

  server.registerTool(
    'get_aged_balance',
    {
      title: 'Balance âgée',
      description: describeTool({
        summary:
          "Returns the aged balance (balance âgée) of a company on a day: unlettered customer (411) and supplier (401) lines per tiers (auxiliary account, else account), bucketed by days past their due date (not due, 0-30, 31-60, 61-90, over 90 days). Due date = entry date + the company's payment terms (30 days by default, capped at 60 days or 45 days end of month by Code de commerce art. L441-10). Positive when owed.",
        access: 'read',
        permission: { reports: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'letters lines or sends a reminder (read only).',
      }),
      inputSchema: z.object({
        companyId,
        fiscalYearId,
        asOf: isoDate.optional().describe('Report day (yyyy-mm-dd) within the fiscal year. Defaults to today.'),
        kind: z.enum(['customers', 'suppliers', 'all']).default('all').describe('customers (créances clients), suppliers (dettes fournisseurs) or both.'),
      }),
      annotations: readOnly,
    },
    ({ companyId, fiscalYearId, asOf, kind }) =>
      run(async () => {
        await guard.require(companyId, { reports: ['read'] })
        const report = await getAgedBalance(companyId, { fiscalYearId, asOf })
        const section = (s: AgedSection) => ({
          totals: agedEuros(s.totals),
          tiers: s.tiers.slice(0, MAX_ROWS).map((t) => ({
            tiers: t.code,
            label: t.label,
            accounts: t.accountCodes,
            oldestDueDate: t.oldestDueDate,
            ...agedEuros(t.buckets),
          })),
          truncated: s.tiers.length > MAX_ROWS,
        })
        return json({
          fiscalYear: report.fiscalYear,
          asOf: report.asOf,
          paymentTerms: report.terms,
          ...(kind !== 'suppliers' && { customers: section(report.customers) }),
          ...(kind !== 'customers' && { suppliers: section(report.suppliers) }),
        })
      }),
  )

  server.registerTool(
    'list_missing_receipts',
    {
      title: 'Justificatifs manquants',
      description: describeTool({
        summary:
          'Lists bank transactions without a supporting document (justificatif, Code de commerce art. L123-22: kept 10 years), newest first, at or above an amount threshold, over a fiscal year or a period, optionally for one bank account. Receipts are attached at the bank (Qonto) and synced into Kledg.',
        access: 'read',
        permission: { banking: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'attaches or requests a receipt (read only).',
      }),
      inputSchema: z.object({
        companyId,
        fiscalYearId: z.string().optional().describe('Fiscal year id, from list_fiscal_years: its dates bound the list.'),
        from: isoDate.optional(),
        to: isoDate.optional(),
        bankAccountId: z.string().optional(),
        minAmount: z.number().min(0).max(1e12).default(0).describe('Threshold in euros: transactions of at least this amount.'),
        side: z.enum(['debit', 'credit', 'all']).default('all').describe('debit: money out (purchases), credit: money in.'),
        limit: z.number().int().min(1).max(MAX_ROWS).default(50),
      }),
      annotations: readOnly,
      _meta: viewMeta('actions'),
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { banking: ['read'] })
        const result = await listMissingReceipts(args.companyId, {
          fiscalYearId: args.fiscalYearId,
          startDate: args.from,
          endDate: args.to,
          bankAccountId: args.bankAccountId,
          minAmount: toCents(args.minAmount) ?? 0,
          side: args.side,
          limit: args.limit,
        })
        const out = {
          period: result.period,
          threshold: fromCents(result.thresholdCents),
          count: result.count,
          total: fromCents(result.totalCents),
          truncated: result.truncated,
          transactions: result.transactions.map((t) => ({
            id: t.id,
            date: t.date,
            label: t.label,
            counterparty: t.counterpartyName,
            amount: fromCents(t.amountCents),
            bankAccount: t.bankAccount.displayName || t.bankAccount.name,
            reconciled: t.reconciled,
          })),
        }
        return withView(json(out), () => missingReceiptsList(args.companyId, access, args, out))
      }),
  )

  server.registerTool(
    'list_tiers',
    {
      title: 'Clients et fournisseurs',
      description: describeTool({
        summary:
          'Lists the customers and suppliers (tiers) of a company with their auxiliary account number (FEC CompAuxNum, used by lettering and the aged balance), identifiers, default accounts and payment terms. Use the id or the auxiliary number with list_invoices and create_draft_invoice.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'none',
        units: 'VAT rates in percent, payment terms in days.',
        never: 'changes anything (read only).',
      }),
      inputSchema: z.object({
        companyId,
        kind: z.enum(['CUSTOMER', 'SUPPLIER']).optional(),
        search: z.string().max(100).optional().describe('Part of the name, auxiliary number, SIREN or VAT number.'),
        limit: z.number().int().min(1).max(MAX_ROWS).default(100),
      }),
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        const result = await listTiers(args.companyId, { kind: args.kind, search: args.search, limit: args.limit })
        return json({
          total: result.total,
          truncated: result.truncated,
          tiers: result.tiers.map((t) => ({
            id: t.id,
            kind: t.kind,
            name: t.name,
            auxiliaryAccountNumber: t.auxiliaryAccountNumber,
            siren: t.siren,
            vatNumber: t.vatNumber,
            collectiveAccount: t.collectiveAccountCode,
            defaultAccount: t.defaultAccountCode,
            defaultVatRatePercent: t.defaultVatRateBp === null ? null : t.defaultVatRateBp / 100,
            paymentTerms: t.paymentTermsDays === null ? null : { days: t.paymentTermsDays, endOfMonth: t.paymentTermsEndOfMonth },
            invoiceCount: t._count.invoices,
          })),
        })
      }),
  )

  server.registerTool(
    'list_invoices',
    {
      title: 'Factures',
      description: describeTool({
        summary:
          'Lists the purchase or sales invoices recorded in Kledg, newest first, with their totals, status (draft, posted, partially_paid, paid: derived from lettering and the bank payments recorded) and amount still due.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'euros',
        units: 'Dates as yyyy-mm-dd.',
        never: 'issues, sends or posts an invoice: Kledg records invoices (entered or imported from Qonto), it does not issue them (read only).',
      }),
      inputSchema: z.object({
        companyId,
        direction: z.enum(['SALE', 'PURCHASE']),
        status: z.enum(['all', 'draft', 'posted']).default('all'),
        tiersId: z.string().optional(),
        search: z.string().max(100).optional().describe('Part of the number, label or tiers name.'),
        from: isoDate.optional(),
        to: isoDate.optional(),
        limit: z.number().int().min(1).max(MAX_ROWS).default(50),
      }),
      annotations: readOnly,
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        const page = await listInvoices(args.companyId, {
          direction: args.direction,
          status: args.status,
          tiersId: args.tiersId,
          search: args.search,
          startDate: args.from,
          endDate: args.to,
          limit: args.limit,
        })
        return json({
          truncated: page.nextCursor !== null,
          invoices: page.items.map((i) => ({
            id: i.id,
            number: i.number,
            creditNote: i.typeCode === '381',
            issueDate: i.issueDate,
            dueDate: i.dueDate,
            tiers: i.tiers.name,
            tiersAuxiliaryAccount: i.tiers.auxiliaryAccountNumber,
            totalExclTax: fromCents(i.totalExclTaxCents),
            totalVat: fromCents(i.totalVatCents),
            totalInclTax: fromCents(i.totalInclTaxCents),
            paid: fromCents(i.paidCents),
            remaining: fromCents(i.remainingCents),
            status: i.status,
            entryNumber: i.entry?.entryNumber ?? null,
            source: i.source,
          })),
        })
      }),
  )

  server.registerTool(
    'get_invoice',
    {
      title: 'Facture',
      description: describeTool({
        summary:
          'One invoice with its lines (quantity, unit price excluding tax, VAT rate, account), VAT breakdown per rate, entry, payments recorded from the bank and status.',
        access: 'read',
        permission: { entries: ['read'] },
        amounts: 'euros',
        units: 'VAT rates in percent.',
        never: 'issues, sends or posts an invoice (read only).',
      }),
      inputSchema: z.object({ companyId, invoiceId: z.string().describe('Invoice id, from list_invoices.') }),
      annotations: readOnly,
      _meta: viewMeta('document'),
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['read'] })
        const invoice = await getInvoice(args.companyId, args.invoiceId)
        const out = {
          id: invoice.id,
          direction: invoice.direction,
          number: invoice.number,
          creditNote: invoice.typeCode === '381',
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          tiers: invoice.tiers,
          parties: invoice.parties,
          status: invoice.status,
          lines: invoice.lines.map((l) => ({
            label: l.label,
            quantity: l.quantity,
            unitPrice: fromCents(l.unitPriceCents),
            vatRatePercent: l.vatRateBp / 100,
            totalExclTax: fromCents(l.totalExclTaxCents),
            accountCode: l.accountCode,
            nature: l.nature,
            fixedAsset: l.fixedAsset,
          })),
          vatBreakdown: invoice.vatBreakdown.map((b) => ({ ratePercent: b.vatRateBp / 100, base: fromCents(b.baseCents), vat: fromCents(b.vatCents) })),
          totalExclTax: fromCents(invoice.totalExclTaxCents),
          totalVat: fromCents(invoice.totalVatCents),
          totalInclTax: fromCents(invoice.totalInclTaxCents),
          paid: fromCents(invoice.paidCents),
          remaining: fromCents(invoice.remainingCents),
          lettering: invoice.letteringCode,
          entry: invoice.entry,
          payments: invoice.payments.map((p) => ({ amount: fromCents(p.amountCents), entryNumber: p.entry.entryNumber, date: p.entry.date })),
          source: invoice.source,
        }
        return withView(json(out), () => invoiceDocument(args.companyId, out))
      }),
  )

  registerExpenseReportReadTools(server, access, guard)
  registerBudgetReadTools(server, guard)
  registerManagementFeeTools(server, access, guard)
  registerGroupTools(server, access, guard)
  registerSubscriptionReadTools(server, guard)
  registerSimpleModeReadTools(server, guard)
  registerFinancialIndicatorTools(server, guard)
  registerYearEndReadTools(server, guard)
  registerApprovalReadTools(server, guard)
  registerAnnexeReadTools(server, access, guard)
  registerDeadlineReadTools(server, guard)
  registerCashForecastTools(server, guard)
  registerVatReturnReadTools(server, guard)
  registerCorporateTaxReadTools(server, access, guard)
  registerRemunerationReadTools(server, guard)
  registerLocalTaxReadTools(server, guard)
  registerTrainingReadTools(server, guard)
  registerBankingReadTools(server, guard)
  registerThirdPartyReadTools(server, guard)
  registerLedgerReadTools(server, guard)
  registerCompanySettingsTools(server, guard)
  registerTransactionReadTools(server, guard)
  registerExportTools(server, access, guard)
  registerDocumentTools(server, guard)
  registerCompanyLookupTools(server, access)

  // Full control (kledg:admin): validate, reconcile, import, close... Never
  // registered without it; each tool checks it again through the guard.
  if (access.canAdmin) registerFullControlTools(server, access, guard)

  // Only clients granted kledg:write (and API keys of that level) can prepare drafts.
  if (!canWrite) return

  // Draft-level tools of the recent features (budgets, subscriptions, year-end
  // work, expense reports, approval of the accounts): lib/mcp/drafts.
  registerDraftTools(server, access, guard)

  server.registerTool(
    'create_draft_entry',
    {
      title: 'Proposer une écriture',
      description: describeTool({
        summary:
          'Creates a DRAFT accounting entry. Debits must equal credits. A person reviews and validates it in Kledg, which then gives it its definitive number. Use search_accounts and list_journals first to pick existing account numbers and journal codes. Answers the entry id and the link to review it.',
        access: 'write',
        permission: { entries: ['create'] },
        amounts: 'euros',
        never: 'validates or posts the entry, and never writes in a closed fiscal year.',
      }),
      inputSchema: z.object({
        companyId,
        journalCode: z.string().describe('Journal code, e.g. "AC", "VE", "BQ", "OD".'),
        date: isoDate,
        description: z.string().min(1),
        reference: z.string().optional(),
        lines: z
          .array(
            z.object({
              accountCode: z.string().describe('Existing account number from search_accounts.'),
              debit: z.number().min(0).default(0),
              credit: z.number().min(0).default(0),
              label: z.string().optional(),
            }),
          )
          .min(2),
      }),
      annotations: writeAnnotations({ destructive: false, idempotent: false }),
    },
    (args) =>
      run(async () => {
        await guard.require(args.companyId, { entries: ['create'] })
        const date = toEntryDate(args.date)
        const found = await getFiscalYearForDate(args.companyId, date)
        const fiscalYear = found
          ? await prisma.fiscalYear.findUnique({ where: { id: found.id }, select: GUARDED_FISCAL_YEAR_SELECT })
          : null
        if (!fiscalYear) return fail(`Aucun exercice ne couvre le ${args.date}.`)
        // Same guard as every entry route (closed year, date inside the year). Its
        // typed errors keep their French message through run(); anything else
        // becomes the generic message, the detail only in the log.
        assertEntryWritableInFiscalYear(fiscalYear, date, 'create')

        const journal = await prisma.journal.findFirst({
          where: { companyId: args.companyId, code: args.journalCode },
        })
        if (!journal) return fail(`Journal ${args.journalCode} introuvable. Utilisez list_journals.`)

        const codes = [...new Set(args.lines.map((l) => l.accountCode))]
        const accounts = await prisma.account.findMany({
          where: { companyId: args.companyId, fiscalYearId: fiscalYear.id, code: { in: codes } },
          select: { id: true, code: true },
        })
        const byCode = new Map(accounts.map((a) => [a.code, a.id]))
        const missing = codes.filter((c) => !byCode.has(c))
        if (missing.length) return fail(`Comptes introuvables : ${missing.join(', ')}. Utilisez search_accounts.`)

        const entry = await createAccountingEntry({
          companyId: args.companyId,
          journalId: journal.id,
          date,
          description: args.description,
          reference: args.reference,
          status: 'draft',
          fiscalYearId: fiscalYear.id,
          lines: args.lines.map((l) => ({
            accountId: byCode.get(l.accountCode)!,
            debit: l.debit,
            credit: l.credit,
            description: l.label,
          })),
        })

        await writeAuditLog('info', `Draft entry created via MCP: ${args.description}`, {
          action: 'CREATE_ACCOUNTING_ENTRY',
          companyId: args.companyId,
          metadata: { entryId: entry.id, source: 'mcp', userId: user.id },
        })

        return json({
          created: true,
          status: 'draft',
          entryId: entry.id,
          changes: { entryCreated: entry.id, status: 'draft' },
          reviewUrl: kledgPageUrl(args.companyId, 'entries'),
          message:
            'Écriture créée en brouillon : elle doit être validée dans Kledg, qui lui attribuera alors son numéro définitif.',
        })
      }),
  )
}
