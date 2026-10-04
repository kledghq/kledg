/**
 * Authorization matrix: real route handlers against PostgreSQL (see
 * lib/__tests__/helpers/test-db.ts), with only the session mocked.
 *
 * - viewer: 403 on every write
 * - accountant: can keep the books, but can't manage bank credentials,
 *   delete the company or manage members
 * - a member of company B: 404 on every resource of company A
 * - anonymous: 401
 * - no response carries a secret: credentials, tokens, password hashes,
 *   API key hashes (keys and values scanned in every read below)
 *
 * Skipped when the test database server is unreachable.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = await vi.hoisted(async () => {
  const { useTestDatabase } = await import('@/lib/__tests__/helpers/test-db')
  useTestDatabase('matrix')
  process.env.BETTER_AUTH_SECRET ??= 'kledg-test-secret-0123456789abcdef0123456789'
  process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
  // Routes that reach Qonto (invoice import) must never leave the machine: a closed local port answers at once
  process.env.QONTO_API_URL = 'http://127.0.0.1:9/v2'
  return { user: null as null | { id: string; email: string; name: string | null; role: string | null } }
})

vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => state.user,
}))

import { prepareTestDatabase, testDatabaseAvailable } from '@/lib/__tests__/helpers/test-db'

const available = await testDatabaseAvailable()

type Handler = (request: Request, context?: { params: Promise<Record<string, string>> }) => Promise<Response>
type Prisma = typeof import('@/lib/prisma').prisma

let prisma: Prisma
const routes: Record<string, Record<string, Handler>> = {}

const USERS = {
  admin: { id: 'u-admin', email: 'admin@test.local', name: 'Admin', role: 'admin' },
  companyAdmin: { id: 'u-cadmin', email: 'cadmin@test.local', name: 'Company admin', role: 'user' },
  accountant: { id: 'u-accountant', email: 'accountant@test.local', name: 'Accountant', role: 'user' },
  viewer: { id: 'u-viewer', email: 'viewer@test.local', name: 'Viewer', role: 'user' },
  memberB: { id: 'u-member-b', email: 'b@test.local', name: 'Member of B', role: 'user' },
} as const
type Who = keyof typeof USERS | 'anonymous'

/** Ids of the seeded rows of company A and B. */
const ids = {} as Record<string, string>

const SECRET = 'qonto-secret-key-never-returned-9876'

async function seedCompany(prefix: 'a' | 'b', name: string, slug: string, siren: string) {
  const company = await prisma.company.create({ data: { name, slug, siren } })
  await prisma.organization.create({
    data: { id: `org-${prefix}`, name, slug: `org-${slug}`, createdAt: new Date(), companyId: company.id },
  })
  const fy = await prisma.fiscalYear.create({
    data: {
      companyId: company.id,
      year: 2026,
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-12-31T00:00:00Z'),
    },
  })
  const bank = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '512000', label: 'Banque' } })
  const sales = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '706000', label: 'Ventes' } })
  const spare = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '471000', label: 'Attente' } })
  const journal = await prisma.journal.create({ data: { companyId: company.id, code: 'BQ', label: 'Banque' } })
  const entry = await prisma.accountingEntry.create({
    data: {
      companyId: company.id,
      fiscalYearId: fy.id,
      journalId: journal.id,
      entryNumber: '1',
      date: new Date('2026-03-01T00:00:00Z'),
      description: 'Vente',
      status: 'draft',
    },
  })
  await prisma.entryLine.createMany({
    data: [
      { accountingEntryId: entry.id, accountId: bank.id, accountFiscalYearId: fy.id, accountingEntryNumber: '1', debit: 100, credit: 0 },
      { accountingEntryId: entry.id, accountId: sales.id, accountFiscalYearId: fy.id, accountingEntryNumber: '1', debit: 0, credit: 100 },
    ],
  })
  const validated = await prisma.accountingEntry.create({
    data: {
      companyId: company.id,
      fiscalYearId: fy.id,
      journalId: journal.id,
      entryNumber: '2',
      date: new Date('2026-03-02T00:00:00Z'),
      description: 'Validée',
      status: 'validated',
    },
  })
  // A validated invoice and its payment on the customer account, lettered AA (unlettering succeeds, lettering again is a 409)
  const receivable = await prisma.account.create({ data: { companyId: company.id, fiscalYearId: fy.id, code: '411000', label: 'Clients' } })
  const invoice = await prisma.accountingEntry.create({
    data: { companyId: company.id, fiscalYearId: fy.id, journalId: journal.id, entryNumber: '3', date: new Date('2026-03-03T00:00:00Z'), description: 'Facture', status: 'draft' },
  })
  const payment = await prisma.accountingEntry.create({
    data: { companyId: company.id, fiscalYearId: fy.id, journalId: journal.id, entryNumber: '4', date: new Date('2026-03-04T00:00:00Z'), description: 'Règlement', status: 'draft' },
  })
  const invoiceLine = await prisma.entryLine.create({
    data: { accountingEntryId: invoice.id, accountId: receivable.id, accountFiscalYearId: fy.id, accountingEntryNumber: '3', debit: 120, credit: 0, auxiliaryAccountNumber: 'C001', letteringCode: 'AA', letteringDate: new Date('2026-03-04T00:00:00Z') },
  })
  await prisma.entryLine.create({ data: { accountingEntryId: invoice.id, accountId: sales.id, accountFiscalYearId: fy.id, accountingEntryNumber: '3', debit: 0, credit: 120 } })
  const paymentLine = await prisma.entryLine.create({
    data: { accountingEntryId: payment.id, accountId: receivable.id, accountFiscalYearId: fy.id, accountingEntryNumber: '4', debit: 0, credit: 120, auxiliaryAccountNumber: 'C001', letteringCode: 'AA', letteringDate: new Date('2026-03-04T00:00:00Z') },
  })
  await prisma.entryLine.create({ data: { accountingEntryId: payment.id, accountId: bank.id, accountFiscalYearId: fy.id, accountingEntryNumber: '4', debit: 120, credit: 0 } })
  await prisma.accountingEntry.updateMany({ where: { id: { in: [invoice.id, payment.id] } }, data: { status: 'validated' } })
  // Tiers and invoices: the customer of the lettered invoice above (posted, paid), a draft invoice and a tiers without invoices
  const customer = await prisma.tiers.create({ data: { companyId: company.id, kind: 'CUSTOMER', name: `Client ${prefix}`, auxiliaryAccountNumber: 'C001' } })
  const freeTiers = await prisma.tiers.create({ data: { companyId: company.id, kind: 'SUPPLIER', name: `Fournisseur ${prefix}`, auxiliaryAccountNumber: 'F001' } })
  const invoiceLines = (vatRateBp: number) => ({
    lines: { create: [{ position: 1, label: 'Vente', quantity: 1, unitPrice: 100, vatRateBp, totalExclTax: 100, accountCode: '706000' }] },
    vatBreakdown: { create: [{ vatRateBp, baseAmount: 100, vatAmount: vatRateBp ? 20 : 0 }] },
  })
  const postedInvoice = await prisma.invoice.create({
    data: {
      companyId: company.id, direction: 'SALE', tiersId: customer.id, number: 'V-1', issueDate: new Date('2026-03-03T00:00:00Z'), dueDate: new Date('2026-04-02T00:00:00Z'),
      totalExclTax: 100, totalVat: 20, totalInclTax: 120, entryId: invoice.id, ...invoiceLines(2000),
    },
  })
  const draftInvoice = await prisma.invoice.create({
    data: {
      companyId: company.id, direction: 'SALE', tiersId: customer.id, number: 'V-2', issueDate: new Date('2026-03-05T00:00:00Z'), dueDate: new Date('2026-04-04T00:00:00Z'),
      totalExclTax: 100, totalVat: 0, totalInclTax: 100, ...invoiceLines(0),
    },
    include: { lines: true },
  })
  Object.assign(ids, {
    [`${prefix}Tiers`]: customer.id,
    [`${prefix}FreeTiers`]: freeTiers.id,
    [`${prefix}PostedInvoice`]: postedInvoice.id,
    [`${prefix}DraftInvoice`]: draftInvoice.id,
    [`${prefix}DraftInvoiceLine`]: draftInvoice.lines[0].id,
  })
  const connection = await prisma.bankConnection.create({
    data: { companyId: company.id, login: `login-${prefix}`, secretKeyEncrypted: 'encrypted-secret' },
  })
  const bankAccount = await prisma.bankAccount.create({
    data: { bankConnectionId: connection.id, externalAccountId: `ext-${prefix}`, name: 'Compte courant' },
  })
  const transaction = await prisma.bankTransaction.create({
    data: {
      bankAccountId: bankAccount.id,
      externalTransactionId: `tx-${prefix}`,
      amount: 100,
      date: new Date('2026-03-05T00:00:00Z'),
      side: 'credit',
      label: 'Virement client',
    },
  })
  // A monthly subscription (three debits to the same counterparty), detected by /api/subscriptions
  const subscriptionPayments = []
  for (const day of ['2026-01-10', '2026-02-10', '2026-03-10']) {
    subscriptionPayments.push(
      await prisma.bankTransaction.create({
        data: { bankAccountId: bankAccount.id, externalTransactionId: `sub-${prefix}-${day}`, amount: 29.9, date: new Date(`${day}T00:00:00Z`), side: 'debit', label: 'CB LOGICIEL', counterpartyName: 'Logiciel' },
      }),
    )
  }
  ids[`${prefix}Subscription`] = subscriptionPayments[0].id
  const rule = await prisma.transactionRule.create({
    data: { companyId: company.id, name: 'Règle', entryLines: { create: [{ accountCode: '706000', lineType: 'auto', amountType: 'full', order: 0 }] } },
  })
  // Expense reports: the viewer's (company A) or the member's (company B) claimant, a report in each state, a free claimant and a category rule
  const claimant = await prisma.expenseClaimant.create({
    data: { companyId: company.id, kind: 'EMPLOYEE', name: `Salarié ${prefix}`, userId: prefix === 'a' ? 'u-viewer' : 'u-member-b', auxiliaryAccountNumber: 'S00001' },
  })
  const freeClaimant = await prisma.expenseClaimant.create({ data: { companyId: company.id, kind: 'ASSOCIE', name: `Associé ${prefix}`, auxiliaryAccountNumber: 'A00001' } })
  const expenseReport = (number: string, status: 'DRAFT' | 'SUBMITTED' | 'VALIDATED') =>
    prisma.expenseReport.create({
      data: {
        companyId: company.id,
        claimantId: claimant.id,
        number,
        status,
        periodStart: new Date('2026-03-01T00:00:00Z'),
        periodEnd: new Date('2026-03-31T00:00:00Z'),
        totalInclTax: 120,
        recoverableVat: 20,
        totalExpense: 100,
        lines: { create: [{ position: 1, date: new Date('2026-03-10T00:00:00Z'), label: 'Fournitures', category: 'SUPPLIES', accountCode: '706000', amountInclTax: 120, vatRateBp: 2000, vatAmount: 20, recoverableVat: 20, receiptKind: 'INVOICE' }] },
      },
    })
  const draftReport = await expenseReport('NDF-0001', 'DRAFT')
  const submittedReport = await expenseReport('NDF-0002', 'SUBMITTED')
  const validatedReport = await expenseReport('NDF-0003', 'VALIDATED')
  const expenseRule = await prisma.expenseCategoryRule.create({ data: { companyId: company.id, keyword: 'sncf', category: 'TRANSPORT' } })
  Object.assign(ids, {
    [`${prefix}DraftReport`]: draftReport.id,
    [`${prefix}SubmittedReport`]: submittedReport.id,
    [`${prefix}ValidatedReport`]: validatedReport.id,
    [`${prefix}FreeClaimant`]: freeClaimant.id,
    [`${prefix}ExpenseRule`]: expenseRule.id,
  })
  // Budget of the fiscal year, with a line
  const budget = await prisma.budget.create({
    data: {
      companyId: company.id,
      fiscalYearId: fy.id,
      lines: { create: [{ accountPrefix: '706', label: 'Prestations de services', amounts: { create: [{ month: '2026-01', amount: 1000 }] } }, { accountPrefix: '613', label: 'Locations' }] },
    },
    include: { lines: true },
  })
  Object.assign(ids, {
    [`${prefix}Budget`]: budget.id,
    [`${prefix}BudgetLine`]: budget.lines.find((l) => l.accountPrefix === '706')!.id,
    [`${prefix}ChargesLine`]: budget.lines.find((l) => l.accountPrefix === '613')!.id,
  })
  // Management fees: a convention without subsidiary, so no other company is involved in the role checks
  const feeConvention = await prisma.managementFeeConvention.create({
    data: { companyId: company.id, label: 'Convention', costAccountPrefixes: ['6'], excludedAccountPrefixes: ['695'], startDate: new Date('2026-01-01T00:00:00Z') },
  })
  ids[`${prefix}FeeConvention`] = feeConvention.id
  const fixedAsset = await prisma.fixedAsset.create({
    data: {
      companyId: company.id,
      label: 'Ordinateur',
      acquisitionDate: new Date('2026-01-01T00:00:00Z'),
      acquisitionValue: 1200,
      depreciationDuration: 3,
      depreciationStartDate: new Date('2026-01-01T00:00:00Z'),
      assetAccountId: spare.id,
      depreciationAccountId: spare.id,
      expenseAccountId: sales.id,
    },
  })
  const depreciation = await prisma.fixedAssetDepreciation.create({
    data: { companyId: company.id, fixedAssetId: fixedAsset.id, fiscalYearId: fy.id, periodType: 'year', year: 2026, amount: 400 },
  })
  const integration = await prisma.integration.create({
    data: {
      companyId: company.id,
      provider: 'QONTO',
      type: 'BANKING',
      name: 'Qonto',
      credentials: { login: `login-${prefix}`, secretKey: SECRET },
      credentialsEncrypted: false,
    },
  })
  const address = await prisma.address.create({
    data: { companyId: company.id, street: `1 rue ${name}`, postalCode: '75001', city: 'Paris', country: 'FR' },
  })
  const establishment = await prisma.establishment.create({
    data: { companyId: company.id, siret: `${siren}00011`, siren, name: 'Siège', isMain: true, addressId: address.id },
  })
  const shareholder = await prisma.shareholder.create({
    data: { companyId: company.id, type: 'LEGAL', name: 'Fonds', sharePercentage: 10 },
  })
  const taxRegime = await prisma.taxRegimeHistory.create({
    data: { companyId: company.id, regimeType: 'vat', regime: 'normal', startDate: new Date('2026-01-01T00:00:00Z') },
  })
  Object.assign(ids, {
    [`${prefix}Establishment`]: establishment.id,
    [`${prefix}Address`]: address.id,
    [`${prefix}Shareholder`]: shareholder.id,
    [`${prefix}TaxRegime`]: taxRegime.id,
    [`${prefix}Company`]: company.id,
    [`${prefix}Slug`]: slug,
    [`${prefix}Fy`]: fy.id,
    [`${prefix}Account`]: bank.id,
    [`${prefix}Spare`]: spare.id,
    [`${prefix}Journal`]: journal.id,
    [`${prefix}Entry`]: entry.id,
    [`${prefix}Validated`]: validated.id,
    [`${prefix}Transaction`]: transaction.id,
    [`${prefix}BankAccount`]: bankAccount.id,
    [`${prefix}Rule`]: rule.id,
    [`${prefix}Integration`]: integration.id,
    [`${prefix}FixedAsset`]: fixedAsset.id,
    [`${prefix}Depreciation`]: depreciation.id,
    [`${prefix}Receivable`]: receivable.id,
    [`${prefix}InvoiceLine`]: invoiceLine.id,
    [`${prefix}PaymentLine`]: paymentLine.id,
  })
}

async function seed() {
  for (const user of Object.values(USERS)) {
    await prisma.user.create({ data: { id: user.id, email: user.email, name: user.name ?? '', role: user.role } })
  }
  await seedCompany('a', 'Atelier Alpha', 'atelier-alpha', '111111111')
  await seedCompany('b', 'Bureau Beta', 'bureau-beta', '222222222')
  const members: Array<[string, string, string]> = [
    ['u-cadmin', 'org-a', 'companyAdmin'],
    ['u-accountant', 'org-a', 'accountant'],
    ['u-viewer', 'org-a', 'viewer'],
    ['u-member-b', 'org-b', 'companyAdmin'],
  ]
  for (const [userId, organizationId, role] of members) {
    await prisma.member.create({ data: { id: `m-${userId}`, userId, organizationId, role, createdAt: new Date() } })
  }
}

const ROUTE_MODULES = {
  entries: () => import('@/app/api/entries/route'),
  entry: () => import('@/app/api/entries/[id]/route'),
  entryDuplicate: () => import('@/app/api/entries/[id]/duplicate/route'),
  entryReverse: () => import('@/app/api/entries/[id]/reverse/route'),
  bulkValidate: () => import('@/app/api/entries/bulk-validate/route'),
  bulkDelete: () => import('@/app/api/entries/bulk-delete/route'),
  entryNextNumber: () => import('@/app/api/entries/next-number/route'),
  accounts: () => import('@/app/api/accounts/route'),
  account: () => import('@/app/api/accounts/[id]/route'),
  accountEntries: () => import('@/app/api/accounts/[id]/entries/route'),
  accountBalanceEvolution: () => import('@/app/api/accounts/[id]/balance-evolution/route'),
  accountCheckExists: () => import('@/app/api/accounts/check-exists/route'),
  pcgCompliance: () => import('@/app/api/accounts/check-pcg-compliance/route'),
  deleteNonPcg: () => import('@/app/api/accounts/delete-non-pcg/route'),
  seedPcg: () => import('@/app/api/accounts/seed-pcg/route'),
  journals: () => import('@/app/api/journals/route'),
  journal: () => import('@/app/api/journals/[id]/route'),
  rules: () => import('@/app/api/transaction-rules/route'),
  rule: () => import('@/app/api/transaction-rules/[id]/route'),
  transactions: () => import('@/app/api/transactions/route'),
  reconcile: () => import('@/app/api/transactions/[id]/reconcile/route'),
  applyRule: () => import('@/app/api/transactions/[id]/apply-rule/route'),
  bulkReconcile: () => import('@/app/api/transactions/bulk-reconcile/route'),
  bulkUnreconcile: () => import('@/app/api/transactions/bulk-unreconcile/route'),
  bulkDeleteTransactions: () => import('@/app/api/transactions/bulk-delete/route'),
  ruleDraft: () => import('@/app/api/transactions/[id]/create-rule/route'),
  suggest: () => import('@/app/api/transactions/[id]/suggest/route'),
  ruleDuplicate: () => import('@/app/api/transaction-rules/[id]/duplicate/route'),
  ruleSimulate: () => import('@/app/api/transaction-rules/[id]/simulate/route'),
  rulesSimulate: () => import('@/app/api/transaction-rules/simulate/route'),
  rulesExecute: () => import('@/app/api/transaction-rules/execute/route'),
  establishments: () => import('@/app/api/companies/[id]/establishments/route'),
  addresses: () => import('@/app/api/addresses/route'),
  address: () => import('@/app/api/addresses/[id]/route'),
  tasksCount: () => import('@/app/api/tasks/count/route'),
  dashboardWidgets: () => import('@/app/api/dashboard/widgets/route'),
  dashboardLayout: () => import('@/app/api/dashboard/layout/route'),
  appearance: () => import('@/app/api/account/appearance/route'),
  importFile: () => import('@/app/api/import/route'),
  importPreview: () => import('@/app/api/import/preview-fiscal-years/route'),
  establishment: () => import('@/app/api/companies/[id]/establishments/[establishmentId]/route'),
  shareholders: () => import('@/app/api/companies/[id]/shareholders/route'),
  persons: () => import('@/app/api/companies/[id]/persons/route'),
  shareholder: () => import('@/app/api/companies/[id]/shareholders/[shareholderId]/route'),
  taxRegimes: () => import('@/app/api/companies/[id]/tax-regimes/route'),
  deadlines: () => import('@/app/api/deadlines/route'),
  deadlineSettings: () => import('@/app/api/companies/[id]/deadline-settings/route'),
  users: () => import('@/app/api/users/route'),
  reconciliation: () => import('@/app/api/banking/reconciliation/route'),
  selectAccount: () => import('@/app/api/banking/select-account/route'),
  fiscalYears: () => import('@/app/api/companies/[id]/fiscal-years/route'),
  fiscalYear: () => import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/route'),
  close: () => import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/close/route'),
  closeSimulation: () => import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/close/simulate/route'),
  yearDepreciation: () => import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/depreciation/route'),
  resultAllocation: () => import('@/app/api/companies/[id]/fiscal-years/[fiscalYearId]/result-allocation/route'),
  company: () => import('@/app/api/companies/[id]/route'),
  companies: () => import('@/app/api/companies/route'),
  credentials: () => import('@/app/api/integrations/[id]/credentials/route'),
  integration: () => import('@/app/api/integrations/[id]/route'),
  integrations: () => import('@/app/api/integrations/route'),
  integrationFeatures: () => import('@/app/api/integrations/[id]/features/route'),
  integrationResources: () => import('@/app/api/integrations/[id]/resources/route'),
  integrationVerify: () => import('@/app/api/integrations/verify/route'),
  members: () => import('@/app/api/companies/[id]/members/route'),
  onboarding: () => import('@/app/api/companies/[id]/onboarding/route'),
  openingBalances: () => import('@/app/api/companies/[id]/opening-balances/route'),
  member: () => import('@/app/api/companies/[id]/members/[memberId]/route'),
  fec: () => import('@/app/api/fec/route'),
  balanceSheetPdf: () => import('@/app/api/companies/[id]/balance-sheet/export-pdf/route'),
  bankConnections: () => import('@/app/api/banking/connections/route'),
  bankAccounts: () => import('@/app/api/banking/accounts/route'),
  qontoStatus: () => import('@/app/api/qonto/status/route'),
  qontoConnect: () => import('@/app/api/qonto/connect/route'),
  qontoTestConnection: () => import('@/app/api/qonto/test-connection/route'),
  qontoVerify: () => import('@/app/api/qonto/verify/route'),
  importStatement: () => import('@/app/api/banking/import-statement/route'),
  grants: () => import('@/app/api/ai-access/grants/route'),
  fixedAssets: () => import('@/app/api/fixed-assets/route'),
  fixedAsset: () => import('@/app/api/fixed-assets/[id]/route'),
  fixedAssetStats: () => import('@/app/api/fixed-assets/stats/route'),
  depreciationStatus: () => import('@/app/api/fixed-assets/[id]/depreciation-status/route'),
  depreciationRecords: () => import('@/app/api/fixed-assets/[id]/depreciation/route'),
  depreciationRecord: () => import('@/app/api/fixed-assets/[id]/depreciation/[entryId]/route'),
  depreciationCandidates: () => import('@/app/api/fixed-assets/[id]/depreciation/[entryId]/candidates/route'),
  depreciationPost: () => import('@/app/api/fixed-assets/[id]/depreciation/[entryId]/post/route'),
  trialBalance: () => import('@/app/api/reports/trial-balance/route'),
  grandLivre: () => import('@/app/api/reports/grand-livre/route'),
  journalReport: () => import('@/app/api/reports/journal/route'),
  journalExcel: () => import('@/app/api/reports/journal/export-excel/route'),
  depreciationReport: () => import('@/app/api/reports/depreciation/route'),
  balanceSheet: () => import('@/app/api/companies/[id]/balance-sheet/route'),
  balanceSheetExcel: () => import('@/app/api/companies/[id]/balance-sheet/export-excel/route'),
  balanceSheetLayout: () => import('@/app/api/companies/[id]/balance-sheet/config/route'),
  balanceSheetLayoutReset: () => import('@/app/api/companies/[id]/balance-sheet/config/default/route'),
  incomeStatement: () => import('@/app/api/companies/[id]/income-statement/route'),
  incomeStatementLine: () => import('@/app/api/companies/[id]/income-statement/config/line/route'),
  lettering: () => import('@/app/api/lettering/route'),
  letteringAccounts: () => import('@/app/api/lettering/accounts/route'),
  letteringSuggestions: () => import('@/app/api/lettering/suggestions/route'),
  letteringUnletter: () => import('@/app/api/lettering/unletter/route'),
  letteringAuto: () => import('@/app/api/lettering/auto/route'),
  agedBalance: () => import('@/app/api/reports/aged-balance/route'),
  agedBalanceExcel: () => import('@/app/api/reports/aged-balance/export-excel/route'),
  financialIndicators: () => import('@/app/api/reports/financial-indicators/route'),
  financialIndicatorsExport: () => import('@/app/api/reports/financial-indicators/export/route'),
  auxiliaryBalance: () => import('@/app/api/reports/auxiliary-balance/route'),
  auxiliaryBalanceExcel: () => import('@/app/api/reports/auxiliary-balance/export-excel/route'),
  missingReceipts: () => import('@/app/api/banking/missing-receipts/route'),
  paymentTerms: () => import('@/app/api/companies/[id]/payment-terms/route'),
  tiers: () => import('@/app/api/tiers/route'),
  tiersOne: () => import('@/app/api/tiers/[id]/route'),
  tiersAttach: () => import('@/app/api/tiers/attach-auxiliary/route'),
  invoices: () => import('@/app/api/invoices/route'),
  invoice: () => import('@/app/api/invoices/[id]/route'),
  invoiceLines: () => import('@/app/api/invoices/[id]/lines/route'),
  invoicePost: () => import('@/app/api/invoices/[id]/post/route'),
  invoicePayments: () => import('@/app/api/invoices/[id]/payments/route'),
  invoicePaymentCandidates: () => import('@/app/api/invoices/[id]/payments/candidates/route'),
  invoicePayment: () => import('@/app/api/invoices/[id]/payments/[paymentId]/route'),
  invoiceSettle: () => import('@/app/api/invoices/[id]/settle/route'),
  invoiceAttachment: () => import('@/app/api/invoices/[id]/attachment/route'),
  invoicesImportQonto: () => import('@/app/api/invoices/import-qonto/route'),
  vatSettings: () => import('@/app/api/companies/[id]/vat-settings/route'),
  expenseReports: () => import('@/app/api/expense-reports/route'),
  expenseReport: () => import('@/app/api/expense-reports/[id]/route'),
  expenseWorkflow: () => import('@/app/api/expense-reports/[id]/workflow/route'),
  expensePost: () => import('@/app/api/expense-reports/[id]/post/route'),
  expenseReimbursement: () => import('@/app/api/expense-reports/[id]/reimbursement/route'),
  expenseReceipts: () => import('@/app/api/expense-reports/receipts/route'),
  expenseClaimants: () => import('@/app/api/expense-claimants/route'),
  expenseClaimant: () => import('@/app/api/expense-claimants/[id]/route'),
  expenseClaimantOptions: () => import('@/app/api/expense-claimants/options/route'),
  expenseRules: () => import('@/app/api/expense-category-rules/route'),
  expenseRule: () => import('@/app/api/expense-category-rules/[id]/route'),
  budgets: () => import('@/app/api/budgets/route'),
  budget: () => import('@/app/api/budgets/[id]/route'),
  budgetLines: () => import('@/app/api/budgets/[id]/lines/route'),
  budgetReport: () => import('@/app/api/budgets/[id]/report/route'),
  budgetLine: () => import('@/app/api/budget-lines/[id]/route'),
  feeConventions: () => import('@/app/api/management-fees/conventions/route'),
  subscriptions: () => import('@/app/api/subscriptions/route'),
  subscriptionDecision: () => import('@/app/api/subscriptions/decision/route'),
  subscriptionBudgetItem: () => import('@/app/api/subscriptions/budget-item/route'),
  feeConvention: () => import('@/app/api/management-fees/conventions/[id]/route'),
  feePreview: () => import('@/app/api/management-fees/conventions/[id]/preview/route'),
  feeInvoices: () => import('@/app/api/management-fees/conventions/[id]/invoices/route'),
  feeSubsidiaries: () => import('@/app/api/management-fees/subsidiaries/route'),
}

interface Call {
  label: string
  route: keyof typeof ROUTE_MODULES
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Built lazily: ids exist once the database is seeded. */
  path: () => string
  params?: () => Record<string, string>
  body?: () => unknown
  /** Multipart form fields (file upload routes), instead of a JSON body. */
  form?: () => Record<string, string>
}

async function call(who: Who, c: Call): Promise<Response> {
  state.user = who === 'anonymous' ? null : { ...USERS[who] }
  const handler = routes[c.route][c.method]
  if (!handler) throw new Error(`${c.method} not exported by ${c.route}`)
  const body = c.body?.()
  const fields = c.form?.()
  const form = new FormData()
  for (const [name, value] of Object.entries(fields ?? {})) form.set(name, value)
  const request = new NextRequest(`http://localhost${c.path()}`, {
    method: c.method,
    ...(fields ? { body: form } : body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
  return handler(request, { params: Promise.resolve(c.params?.() ?? {}) })
}

const A = () => ids.aCompany
/** The 18 fields of a FEC header (LPF art. A47 A-1): a file without lines covers no fiscal year. */
const FEC_HEADER = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef',
  'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
].join('\t')
const p = (o: Record<string, () => string>) => () => Object.fromEntries(Object.entries(o).map(([k, f]) => [k, f()]))

/** Write operations on company A (viewer: 403, non-member: 404, anonymous: 401). */
const WRITES: Call[] = [
  { label: 'create entry', route: 'entries', method: 'POST', path: () => '/api/entries', body: () => ({ companyId: A(), journalId: ids.aJournal, date: '2026-03-10', description: 'x', lines: [] }) },
  { label: 'update entry', route: 'entry', method: 'PATCH', path: () => `/api/entries/${ids.aEntry}`, params: p({ id: () => ids.aEntry }), body: () => ({ description: 'changed' }) },
  { label: 'delete entry', route: 'entry', method: 'DELETE', path: () => `/api/entries/${ids.aEntry}`, params: p({ id: () => ids.aEntry }) },
  { label: 'duplicate entry', route: 'entryDuplicate', method: 'POST', path: () => `/api/entries/${ids.aEntry}/duplicate`, params: p({ id: () => ids.aEntry }), body: () => ({}) },
  { label: 'reverse entry', route: 'entryReverse', method: 'POST', path: () => `/api/entries/${ids.aValidated}/reverse`, params: p({ id: () => ids.aValidated }), body: () => ({}) },
  { label: 'validate entries', route: 'bulkValidate', method: 'POST', path: () => '/api/entries/bulk-validate', body: () => ({ companyId: A(), entryIds: [ids.aEntry] }) },
  { label: 'delete entries', route: 'bulkDelete', method: 'POST', path: () => '/api/entries/bulk-delete', body: () => ({ companyId: A(), entryIds: [ids.aEntry] }) },
  { label: 'create account', route: 'accounts', method: 'POST', path: () => '/api/accounts', body: () => ({ companyId: A(), code: '401000', label: 'Fournisseurs', fiscalYearId: ids.aFy }) },
  { label: 'update account', route: 'account', method: 'PATCH', path: () => `/api/accounts/${ids.aAccount}`, params: p({ id: () => ids.aAccount }), body: () => ({ label: 'Banque 2' }) },
  { label: 'delete account', route: 'account', method: 'DELETE', path: () => `/api/accounts/${ids.aSpare}`, params: p({ id: () => ids.aSpare }) },
  { label: 'complete chart with PCG', route: 'pcgCompliance', method: 'POST', path: () => '/api/accounts/check-pcg-compliance', body: () => ({ companyId: A(), fiscalYearId: ids.aFy }) },
  { label: 'delete non PCG accounts', route: 'deleteNonPcg', method: 'POST', path: () => '/api/accounts/delete-non-pcg', body: () => ({ companyId: A(), fiscalYearId: ids.aFy }) },
  { label: 'seed PCG chart', route: 'seedPcg', method: 'POST', path: () => '/api/accounts/seed-pcg', form: () => ({ companyId: A(), fiscalYearId: ids.aFy }) },
  { label: 'create journal', route: 'journals', method: 'POST', path: () => '/api/journals', body: () => ({ companyId: A(), code: 'OD2', label: 'Divers' }) },
  { label: 'update journal', route: 'journal', method: 'PATCH', path: () => `/api/journals/${ids.aJournal}`, params: p({ id: () => ids.aJournal }), body: () => ({ label: 'Banque 2' }) },
  { label: 'delete journal', route: 'journal', method: 'DELETE', path: () => `/api/journals/${ids.aJournal}`, params: p({ id: () => ids.aJournal }) },
  { label: 'create rule', route: 'rules', method: 'POST', path: () => '/api/transaction-rules', body: () => ({ companyId: A(), name: 'Nouvelle règle', conditions: [], entryLines: [] }) },
  { label: 'delete rule', route: 'rule', method: 'DELETE', path: () => `/api/transaction-rules/${ids.aRule}`, params: p({ id: () => ids.aRule }) },
  { label: 'reconcile transaction', route: 'reconcile', method: 'POST', path: () => `/api/transactions/${ids.aTransaction}/reconcile`, params: p({ id: () => ids.aTransaction }), body: () => ({ entryId: ids.aEntry }) },
  { label: 'apply rule', route: 'applyRule', method: 'POST', path: () => `/api/transactions/${ids.aTransaction}/apply-rule`, params: p({ id: () => ids.aTransaction }), body: () => ({ ruleId: ids.aRule }) },
  { label: 'bulk reconcile', route: 'bulkReconcile', method: 'POST', path: () => '/api/transactions/bulk-reconcile', body: () => ({ companyId: A(), transactionIds: [ids.aTransaction] }) },
  { label: 'bulk unreconcile', route: 'bulkUnreconcile', method: 'POST', path: () => '/api/transactions/bulk-unreconcile', body: () => ({ companyId: A(), transactionIds: [ids.aTransaction] }) },
  { label: 'bulk delete transactions', route: 'bulkDeleteTransactions', method: 'POST', path: () => '/api/transactions/bulk-delete', body: () => ({ companyId: A(), transactionIds: [ids.aTransaction] }) },
  { label: 'update rule', route: 'rule', method: 'PUT', path: () => `/api/transaction-rules/${ids.aRule}`, params: p({ id: () => ids.aRule }), body: () => ({ name: 'Règle 2' }) },
  { label: 'duplicate rule', route: 'ruleDuplicate', method: 'POST', path: () => `/api/transaction-rules/${ids.aRule}/duplicate`, params: p({ id: () => ids.aRule }) },
  { label: 'run rules', route: 'rulesExecute', method: 'POST', path: () => '/api/transaction-rules/execute', body: () => ({ companyId: A(), autoApply: false }) },
  { label: 'create establishment', route: 'establishments', method: 'POST', path: () => `/api/companies/${A()}/establishments`, params: p({ id: A }), body: () => ({ siret: '99999999900011' }) },
  { label: 'update establishment', route: 'establishment', method: 'PATCH', path: () => `/api/companies/${A()}/establishments/${ids.aEstablishment}`, params: p({ id: A, establishmentId: () => ids.aEstablishment }), body: () => ({ name: 'Agence' }) },
  { label: 'delete establishment', route: 'establishment', method: 'DELETE', path: () => `/api/companies/${A()}/establishments/${ids.aEstablishment}`, params: p({ id: A, establishmentId: () => ids.aEstablishment }) },
  { label: 'create address', route: 'addresses', method: 'POST', path: () => '/api/addresses', body: () => ({ companyId: A(), street: '2 rue Neuve', postalCode: '69001', city: 'Lyon' }) },
  { label: 'import file', route: 'importFile', method: 'POST', path: () => '/api/import', form: () => ({ companyId: A(), type: 'csv' }) },
  { label: 'create person', route: 'persons', method: 'POST', path: () => `/api/companies/${A()}/persons`, params: p({ id: A }), body: () => ({ firstName: 'Jeanne', name: 'Martin' }) },
  { label: 'create shareholder', route: 'shareholders', method: 'POST', path: () => `/api/companies/${A()}/shareholders`, params: p({ id: A }), body: () => ({ type: 'LEGAL', name: 'Holding', sharePercentage: 5 }) },
  { label: 'update shareholder', route: 'shareholder', method: 'PATCH', path: () => `/api/companies/${A()}/shareholders/${ids.aShareholder}`, params: p({ id: A, shareholderId: () => ids.aShareholder }), body: () => ({ notes: 'x' }) },
  { label: 'delete shareholder', route: 'shareholder', method: 'DELETE', path: () => `/api/companies/${A()}/shareholders/${ids.aShareholder}`, params: p({ id: A, shareholderId: () => ids.aShareholder }) },
  { label: 'add tax regime', route: 'taxRegimes', method: 'POST', path: () => `/api/companies/${A()}/tax-regimes`, params: p({ id: A }), body: () => ({ regimeType: 'vat', regime: 'simplified', startDate: '2026-07-01' }) },
  { label: 'update tax regime', route: 'taxRegimes', method: 'PATCH', path: () => `/api/companies/${A()}/tax-regimes`, params: p({ id: A }), body: () => ({ id: ids.aTaxRegime, notes: 'x' }) },
  { label: 'delete tax regime', route: 'taxRegimes', method: 'DELETE', path: () => `/api/companies/${A()}/tax-regimes?id=${ids.aTaxRegime}`, params: p({ id: A }) },
  { label: 'update deadline settings', route: 'deadlineSettings', method: 'PUT', path: () => `/api/companies/${A()}/deadline-settings`, params: p({ id: A }), body: () => ({ vatFilingDay: 21, vatCa3Frequency: 'auto', vatSimplifiedAcomptes: true, isAcomptes: false, cfeAcompte: false, das2: false, cvae: false, accountsFiledOnline: true }) },
  { label: 'change member role', route: 'member', method: 'PATCH', path: () => `/api/companies/${A()}/members/m-u-viewer`, params: p({ id: A, memberId: () => 'm-u-viewer' }), body: () => ({ role: 'accountant' }) },
  { label: 'reconciliation', route: 'reconciliation', method: 'POST', path: () => '/api/banking/reconciliation', body: () => ({ transactionId: ids.aTransaction, entryId: ids.aEntry }) },
  { label: 'select bank account', route: 'selectAccount', method: 'POST', path: () => '/api/banking/select-account', body: () => ({ companyId: A(), accountId: ids.aBankAccount }) },
  { label: 'undo reconciliation', route: 'reconciliation', method: 'DELETE', path: () => `/api/banking/reconciliation?transactionId=${ids.aTransaction}` },
  { label: 'import bank statement', route: 'importStatement', method: 'POST', path: () => '/api/banking/import-statement', form: () => ({ companyId: A(), bankAccountId: ids.aBankAccount, mode: 'preview' }) },
  { label: 'connect Qonto', route: 'qontoConnect', method: 'POST', path: () => '/api/qonto/connect', body: () => ({ companyId: A(), login: 'acme', secretKey: 'typed-secret' }) },
  { label: 'test Qonto connection', route: 'qontoTestConnection', method: 'POST', path: () => '/api/qonto/test-connection', body: () => ({ companyId: A() }) },
  { label: 'verify Qonto credentials', route: 'qontoVerify', method: 'POST', path: () => '/api/qonto/verify', body: () => ({ companyId: A(), login: 'acme', secretKey: 'typed-secret' }) },
  { label: 'create fiscal year', route: 'fiscalYears', method: 'POST', path: () => `/api/companies/${A()}/fiscal-years`, params: p({ id: A }), body: () => ({ year: 2027 }) },
  { label: 'update fiscal year dates', route: 'fiscalYear', method: 'PATCH', path: () => `/api/companies/${A()}/fiscal-years/${ids.aFy}`, params: p({ id: A, fiscalYearId: () => ids.aFy }), body: () => ({ startDate: '2026-01-01', endDate: '2026-12-30' }) },
  { label: 'delete fiscal year', route: 'fiscalYear', method: 'DELETE', path: () => `/api/companies/${A()}/fiscal-years/${ids.aFy}`, params: p({ id: A, fiscalYearId: () => ids.aFy }) },
  { label: 'simulate closing', route: 'closeSimulation', method: 'GET', path: () => `/api/companies/${A()}/fiscal-years/${ids.aFy}/close/simulate`, params: p({ id: A, fiscalYearId: () => ids.aFy }) },
  { label: 'generate depreciation entries', route: 'yearDepreciation', method: 'POST', path: () => `/api/companies/${A()}/fiscal-years/${ids.aFy}/depreciation`, params: p({ id: A, fiscalYearId: () => ids.aFy }) },
  { label: 'allocate result', route: 'resultAllocation', method: 'POST', path: () => `/api/companies/${A()}/fiscal-years/${ids.aFy}/result-allocation`, params: p({ id: A, fiscalYearId: () => ids.aFy }), body: () => ({ date: '2026-06-30' }) },
  { label: 'close fiscal year', route: 'close', method: 'POST', path: () => `/api/companies/${A()}/fiscal-years/${ids.aFy}/close`, params: p({ id: A, fiscalYearId: () => ids.aFy }), body: () => ({}) },
  { label: 'update company', route: 'company', method: 'PATCH', path: () => `/api/companies/${A()}`, params: p({ id: A }), body: () => ({ name: 'Renamed' }) },
  { label: 'delete company', route: 'company', method: 'DELETE', path: () => `/api/companies/${A()}`, params: p({ id: A }) },
  { label: 'read bank credentials', route: 'credentials', method: 'GET', path: () => `/api/integrations/${ids.aIntegration}/credentials`, params: p({ id: () => ids.aIntegration }) },
  { label: 'update integration', route: 'integration', method: 'PUT', path: () => `/api/integrations/${ids.aIntegration}`, params: p({ id: () => ids.aIntegration }), body: () => ({ name: 'Qonto 2' }) },
  { label: 'create integration', route: 'integrations', method: 'POST', path: () => '/api/integrations', body: () => ({ companyId: A(), provider: 'PONTO', type: 'BANKING', credentials: { clientId: 'ponto-client', clientSecret: 'ponto-secret' } }) },
  { label: 'integration features', route: 'integrationFeatures', method: 'POST', path: () => `/api/integrations/${ids.aIntegration}/features`, params: p({ id: () => ids.aIntegration }), body: () => ({ features: [{ feature: 'BANKING_ACCOUNTS', enabled: false }] }) },
  { label: 'integration synced resources', route: 'integrationResources', method: 'POST', path: () => `/api/integrations/${ids.aIntegration}/resources`, params: p({ id: () => ids.aIntegration }), body: () => ({ resourceIds: [] }) },
  { label: 'verify bank credentials', route: 'integrationVerify', method: 'POST', path: () => '/api/integrations/verify', body: () => ({ companyId: A(), provider: 'QONTO', credentials: { login: 'l', secretKey: 's' } }) },
  { label: 'add member', route: 'members', method: 'POST', path: () => `/api/companies/${A()}/members`, params: p({ id: A }), body: () => ({ email: 'new@test.local', role: 'viewer' }) },
  { label: 'remove member', route: 'member', method: 'DELETE', path: () => `/api/companies/${A()}/members/m-u-viewer`, params: p({ id: A, memberId: () => 'm-u-viewer' }) },
  { label: 'export FEC', route: 'fec', method: 'GET', path: () => `/api/fec?companyId=${A()}` },
  { label: 'hide onboarding checklist', route: 'onboarding', method: 'POST', path: () => `/api/companies/${A()}/onboarding`, params: p({ id: A }), body: () => ({ action: 'dismiss' }) },
  { label: 'create fixed asset', route: 'fixedAssets', method: 'POST', path: () => '/api/fixed-assets', body: () => ({ companyId: A(), label: 'Serveur', acquisitionDate: '2026-02-01', acquisitionValue: 900, depreciationDuration: 3, depreciationStartDate: '2026-02-01', assetAccountId: ids.aSpare, depreciationAccountId: ids.aSpare, expenseAccountId: ids.aAccount }) },
  { label: 'update fixed asset', route: 'fixedAsset', method: 'PATCH', path: () => `/api/fixed-assets/${ids.aFixedAsset}`, params: p({ id: () => ids.aFixedAsset }), body: () => ({ comment: 'Poste 2' }) },
  { label: 'delete fixed asset', route: 'fixedAsset', method: 'DELETE', path: () => `/api/fixed-assets/${ids.aFixedAsset}`, params: p({ id: () => ids.aFixedAsset }) },
  { label: 'record depreciation', route: 'depreciationRecords', method: 'POST', path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation`, params: p({ id: () => ids.aFixedAsset }), body: () => ({ fiscalYearId: ids.aFy, periodType: 'year', amount: 350 }) },
  { label: 'link depreciation entry', route: 'depreciationRecord', method: 'PATCH', path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation/${ids.aDepreciation}`, params: p({ id: () => ids.aFixedAsset, entryId: () => ids.aDepreciation }), body: () => ({ accountingEntryId: null }) },
  { label: 'delete depreciation record', route: 'depreciationRecord', method: 'DELETE', path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation/${ids.aDepreciation}`, params: p({ id: () => ids.aFixedAsset, entryId: () => ids.aDepreciation }) },
  { label: 'book depreciation record', route: 'depreciationPost', method: 'POST', path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation/${ids.aDepreciation}/post`, params: p({ id: () => ids.aFixedAsset, entryId: () => ids.aDepreciation }), body: () => ({}) },
  { label: 'export journal', route: 'journalExcel', method: 'GET', path: () => `/api/reports/journal/export-excel?companyId=${A()}` },
  { label: 'export balance sheet', route: 'balanceSheetExcel', method: 'GET', path: () => `/api/companies/${A()}/balance-sheet/export-excel?fiscalYearId=${ids.aFy}`, params: p({ id: A }) },
  { label: 'reset balance sheet layout', route: 'balanceSheetLayoutReset', method: 'POST', path: () => `/api/companies/${A()}/balance-sheet/config/default`, params: p({ id: A }), body: () => ({ variant: 'simplified' }) },
  { label: 'create income statement line', route: 'incomeStatementLine', method: 'POST', path: () => `/api/companies/${A()}/income-statement/config/line`, params: p({ id: A }), body: () => ({ lineLabel: 'Divers', accountCodes: ['758'] }) },
  { label: 'letter lines', route: 'lettering', method: 'POST', path: () => '/api/lettering', body: () => ({ companyId: A(), accountId: ids.aReceivable, lineIds: [ids.aInvoiceLine, ids.aPaymentLine] }) },
  { label: 'unletter lines', route: 'letteringUnletter', method: 'POST', path: () => '/api/lettering/unletter', body: () => ({ companyId: A(), accountId: ids.aReceivable, code: 'AA' }) },
  { label: 'automatic lettering', route: 'letteringAuto', method: 'POST', path: () => '/api/lettering/auto', body: () => ({ companyId: A(), accountId: ids.aReceivable }) },
  { label: 'export aged balance', route: 'agedBalanceExcel', method: 'GET', path: () => `/api/reports/aged-balance/export-excel?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'export financial indicators', route: 'financialIndicatorsExport', method: 'GET', path: () => `/api/reports/financial-indicators/export?companyId=${A()}&fiscalYearId=${ids.aFy}&format=csv` },
  { label: 'export auxiliary balance', route: 'auxiliaryBalanceExcel', method: 'GET', path: () => `/api/reports/auxiliary-balance/export-excel?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'update payment terms', route: 'paymentTerms', method: 'PUT', path: () => `/api/companies/${A()}/payment-terms`, params: p({ id: A }), body: () => ({ days: 45, endOfMonth: true }) },
  { label: 'create tiers', route: 'tiers', method: 'POST', path: () => '/api/tiers', body: () => ({ companyId: A(), kind: 'CUSTOMER', name: 'Nouveau client' }) },
  { label: 'update tiers', route: 'tiersOne', method: 'PATCH', path: () => `/api/tiers/${ids.aTiers}`, params: p({ id: () => ids.aTiers }), body: () => ({ name: 'Client renommé' }) },
  { label: 'delete tiers', route: 'tiersOne', method: 'DELETE', path: () => `/api/tiers/${ids.aFreeTiers}`, params: p({ id: () => ids.aFreeTiers }) },
  { label: 'create tiers from auxiliary accounts', route: 'tiersAttach', method: 'POST', path: () => '/api/tiers/attach-auxiliary', body: () => ({ companyId: A() }) },
  {
    label: 'create invoice',
    route: 'invoices',
    method: 'POST',
    path: () => '/api/invoices',
    body: () => ({ companyId: A(), direction: 'SALE', tiersId: ids.aTiers, number: 'V-9', issueDate: '2026-03-10', lines: [{ label: 'A', quantity: '1', unitPriceCents: 1000, vatRateBp: 0 }] }),
  },
  {
    label: 'update invoice',
    route: 'invoice',
    method: 'PATCH',
    path: () => `/api/invoices/${ids.aDraftInvoice}`,
    params: p({ id: () => ids.aDraftInvoice }),
    body: () => ({ tiersId: ids.aTiers, number: 'V-2', issueDate: '2026-03-05', lines: [{ label: 'B', quantity: '2', unitPriceCents: 1000, vatRateBp: 0 }] }),
  },
  { label: 'update invoice line accounts', route: 'invoiceLines', method: 'PATCH', path: () => `/api/invoices/${ids.aDraftInvoice}/lines`, params: p({ id: () => ids.aDraftInvoice }), body: () => ({ lines: [{ id: ids.aDraftInvoiceLine, accountCode: '706000' }] }) },
  { label: 'delete invoice', route: 'invoice', method: 'DELETE', path: () => `/api/invoices/${ids.aDraftInvoice}`, params: p({ id: () => ids.aDraftInvoice }) },
  { label: 'post invoice', route: 'invoicePost', method: 'POST', path: () => `/api/invoices/${ids.aDraftInvoice}/post`, params: p({ id: () => ids.aDraftInvoice }) },
  { label: 'unpost invoice', route: 'invoicePost', method: 'DELETE', path: () => `/api/invoices/${ids.aPostedInvoice}/post`, params: p({ id: () => ids.aPostedInvoice }) },
  { label: 'record invoice payment', route: 'invoicePayments', method: 'POST', path: () => `/api/invoices/${ids.aPostedInvoice}/payments`, params: p({ id: () => ids.aPostedInvoice }), body: () => ({ entryLineId: ids.aPaymentLine }) },
  { label: 'remove invoice payment', route: 'invoicePayment', method: 'DELETE', path: () => `/api/invoices/${ids.aPostedInvoice}/payments/none`, params: p({ id: () => ids.aPostedInvoice, paymentId: () => 'none' }) },
  { label: 'settle invoice', route: 'invoiceSettle', method: 'POST', path: () => `/api/invoices/${ids.aPostedInvoice}/settle`, params: p({ id: () => ids.aPostedInvoice }) },
  { label: 'import invoices from Qonto', route: 'invoicesImportQonto', method: 'POST', path: () => '/api/invoices/import-qonto', body: () => ({ companyId: A() }) },
  { label: 'update VAT settings', route: 'vatSettings', method: 'PUT', path: () => `/api/companies/${A()}/vat-settings`, params: p({ id: A }), body: () => ({ servicesVatOnDebits: true }) },
  { label: 'book opening balances', route: 'openingBalances', method: 'POST', path: () => `/api/companies/${A()}/opening-balances`, params: p({ id: A }), body: () => ({ lines: [{ accountCode: '512000', debitCents: 10_000, creditCents: 0 }, { accountCode: '471000', debitCents: 0, creditCents: 10_000 }] }) },
  { label: 'validate expense report', route: 'expenseWorkflow', method: 'POST', path: () => `/api/expense-reports/${ids.aSubmittedReport}/workflow`, params: p({ id: () => ids.aSubmittedReport }), body: () => ({ action: 'validate' }) },
  { label: 'return expense report', route: 'expenseWorkflow', method: 'POST', path: () => `/api/expense-reports/${ids.aSubmittedReport}/workflow`, params: p({ id: () => ids.aSubmittedReport }), body: () => ({ action: 'return', note: 'Joindre la facture' }) },
  { label: 'post expense report', route: 'expensePost', method: 'POST', path: () => `/api/expense-reports/${ids.aValidatedReport}/post`, params: p({ id: () => ids.aValidatedReport }) },
  { label: 'unpost expense report', route: 'expensePost', method: 'DELETE', path: () => `/api/expense-reports/${ids.aValidatedReport}/post`, params: p({ id: () => ids.aValidatedReport }) },
  { label: 'expense reimbursement candidates', route: 'expenseReimbursement', method: 'GET', path: () => `/api/expense-reports/${ids.aValidatedReport}/reimbursement`, params: p({ id: () => ids.aValidatedReport }) },
  { label: 'reimburse expense report', route: 'expenseReimbursement', method: 'POST', path: () => `/api/expense-reports/${ids.aValidatedReport}/reimbursement`, params: p({ id: () => ids.aValidatedReport }), body: () => ({ entryLineIds: ['none'] }) },
  { label: 'create expense claimant', route: 'expenseClaimants', method: 'POST', path: () => '/api/expense-claimants', body: () => ({ companyId: A(), kind: 'DIRIGEANT', name: 'Dirigeant' }) },
  { label: 'update expense claimant', route: 'expenseClaimant', method: 'PATCH', path: () => `/api/expense-claimants/${ids.aFreeClaimant}`, params: p({ id: () => ids.aFreeClaimant }), body: () => ({ accountCode: '4551' }) },
  { label: 'delete expense claimant', route: 'expenseClaimant', method: 'DELETE', path: () => `/api/expense-claimants/${ids.aFreeClaimant}`, params: p({ id: () => ids.aFreeClaimant }) },
  { label: 'expense claimant options', route: 'expenseClaimantOptions', method: 'GET', path: () => `/api/expense-claimants/options?companyId=${A()}` },
  { label: 'create expense category rule', route: 'expenseRules', method: 'POST', path: () => '/api/expense-category-rules', body: () => ({ companyId: A(), keyword: 'uber', category: 'TRANSPORT' }) },
  { label: 'update expense category rule', route: 'expenseRule', method: 'PATCH', path: () => `/api/expense-category-rules/${ids.aExpenseRule}`, params: p({ id: () => ids.aExpenseRule }), body: () => ({ priority: 2 }) },
  { label: 'delete expense category rule', route: 'expenseRule', method: 'DELETE', path: () => `/api/expense-category-rules/${ids.aExpenseRule}`, params: p({ id: () => ids.aExpenseRule }) },
  { label: 'create budget', route: 'budgets', method: 'POST', path: () => '/api/budgets', body: () => ({ companyId: A(), fiscalYearId: ids.aFy }) },
  { label: 'delete budget', route: 'budget', method: 'DELETE', path: () => `/api/budgets/${ids.aBudget}`, params: p({ id: () => ids.aBudget }) },
  { label: 'create budget line', route: 'budgetLines', method: 'POST', path: () => `/api/budgets/${ids.aBudget}/lines`, params: p({ id: () => ids.aBudget }), body: () => ({ accountPrefix: '6064' }) },
  { label: 'update budget line', route: 'budgetLine', method: 'PATCH', path: () => `/api/budget-lines/${ids.aBudgetLine}`, params: p({ id: () => ids.aBudgetLine }), body: () => ({ amounts: [{ month: '2026-02', amountCents: 5_000 }] }) },
  { label: 'delete budget line', route: 'budgetLine', method: 'DELETE', path: () => `/api/budget-lines/${ids.aBudgetLine}`, params: p({ id: () => ids.aBudgetLine }) },
  { label: 'decide on a subscription', route: 'subscriptionDecision', method: 'PUT', path: () => '/api/subscriptions/decision', body: () => ({ companyId: A(), subscriptionId: ids.aSubscription, status: 'ignored' }) },
  { label: 'add a subscription to the budget', route: 'subscriptionBudgetItem', method: 'POST', path: () => '/api/subscriptions/budget-item', body: () => ({ companyId: A(), subscriptionId: ids.aSubscription, budgetLineId: ids.aChargesLine }) },
  { label: 'create management fee convention', route: 'feeConventions', method: 'POST', path: () => '/api/management-fees/conventions', body: () => ({ companyId: A(), label: 'Convention', startDate: '2026-01-01', subsidiaries: [] }) },
  { label: 'update management fee convention', route: 'feeConvention', method: 'PATCH', path: () => `/api/management-fees/conventions/${ids.aFeeConvention}`, params: p({ id: () => ids.aFeeConvention }), body: () => ({ label: 'Convention', startDate: '2026-01-01', subsidiaries: [] }) },
  { label: 'delete management fee convention', route: 'feeConvention', method: 'DELETE', path: () => `/api/management-fees/conventions/${ids.aFeeConvention}`, params: p({ id: () => ids.aFeeConvention }) },
  { label: 'invoice management fees', route: 'feeInvoices', method: 'POST', path: () => `/api/management-fees/conventions/${ids.aFeeConvention}/invoices`, params: p({ id: () => ids.aFeeConvention }), body: () => ({ periodStart: '2026-01-01', periodEnd: '2026-03-31' }) },
]

/** Reads of company A (viewer: allowed, non-member: 404, anonymous: 401). */
const READS: Call[] = [
  { label: 'list entries', route: 'entries', method: 'GET', path: () => `/api/entries?companyId=${A()}` },
  { label: 'onboarding checklist', route: 'onboarding', method: 'GET', path: () => `/api/companies/${A()}/onboarding`, params: p({ id: A }) },
  { label: 'opening balances target', route: 'openingBalances', method: 'GET', path: () => `/api/companies/${A()}/opening-balances`, params: p({ id: A }) },
  { label: 'get entry', route: 'entry', method: 'GET', path: () => `/api/entries/${ids.aEntry}`, params: p({ id: () => ids.aEntry }) },
  { label: 'get account', route: 'account', method: 'GET', path: () => `/api/accounts/${ids.aAccount}`, params: p({ id: () => ids.aAccount }) },
  { label: 'list accounts', route: 'accounts', method: 'GET', path: () => `/api/accounts?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'account ledger', route: 'accountEntries', method: 'GET', path: () => `/api/accounts/${ids.aAccount}/entries`, params: p({ id: () => ids.aAccount }) },
  { label: 'account balance evolution', route: 'accountBalanceEvolution', method: 'GET', path: () => `/api/accounts/${ids.aAccount}/balance-evolution`, params: p({ id: () => ids.aAccount }) },
  { label: 'account number exists', route: 'accountCheckExists', method: 'GET', path: () => `/api/accounts/check-exists?companyId=${A()}&code=512000&fiscalYearId=${ids.aFy}` },
  { label: 'next entry number', route: 'entryNextNumber', method: 'GET', path: () => `/api/entries/next-number?companyId=${A()}&date=2026-03-10` },
  { label: 'get fiscal year', route: 'fiscalYear', method: 'GET', path: () => `/api/companies/${A()}/fiscal-years/${ids.aFy}`, params: p({ id: A, fiscalYearId: () => ids.aFy }) },
  { label: 'unposted depreciation', route: 'yearDepreciation', method: 'GET', path: () => `/api/companies/${A()}/fiscal-years/${ids.aFy}/depreciation`, params: p({ id: A, fiscalYearId: () => ids.aFy }) },
  { label: 'result allocation preview', route: 'resultAllocation', method: 'GET', path: () => `/api/companies/${A()}/fiscal-years/${ids.aFy}/result-allocation`, params: p({ id: A, fiscalYearId: () => ids.aFy }) },
  { label: 'list journals', route: 'journals', method: 'GET', path: () => `/api/journals?companyId=${A()}` },
  { label: 'list transactions', route: 'transactions', method: 'GET', path: () => `/api/transactions?companyId=${A()}` },
  { label: 'reconciliation overview', route: 'reconciliation', method: 'GET', path: () => `/api/banking/reconciliation?companyId=${A()}` },
  { label: 'list fiscal years', route: 'fiscalYears', method: 'GET', path: () => `/api/companies/${A()}/fiscal-years`, params: p({ id: A }) },
  { label: 'get company', route: 'company', method: 'GET', path: () => `/api/companies/${A()}`, params: p({ id: A }) },
  { label: 'list members', route: 'members', method: 'GET', path: () => `/api/companies/${A()}/members`, params: p({ id: A }) },
  { label: 'list integrations', route: 'integrations', method: 'GET', path: () => `/api/integrations?companyId=${A()}` },
  { label: 'list fixed assets', route: 'fixedAssets', method: 'GET', path: () => `/api/fixed-assets?companyId=${A()}` },
  { label: 'get fixed asset', route: 'fixedAsset', method: 'GET', path: () => `/api/fixed-assets/${ids.aFixedAsset}`, params: p({ id: () => ids.aFixedAsset }) },
  { label: 'fixed asset totals', route: 'fixedAssetStats', method: 'GET', path: () => `/api/fixed-assets/stats?companyId=${A()}` },
  { label: 'depreciation status', route: 'depreciationStatus', method: 'GET', path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation-status`, params: p({ id: () => ids.aFixedAsset }) },
  { label: 'depreciation link candidates', route: 'depreciationCandidates', method: 'GET', path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation/${ids.aDepreciation}/candidates`, params: p({ id: () => ids.aFixedAsset, entryId: () => ids.aDepreciation }) },
  { label: 'trial balance', route: 'trialBalance', method: 'GET', path: () => `/api/reports/trial-balance?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'general ledger', route: 'grandLivre', method: 'GET', path: () => `/api/reports/grand-livre?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'journal report', route: 'journalReport', method: 'GET', path: () => `/api/reports/journal?companyId=${A()}` },
  { label: 'depreciation report', route: 'depreciationReport', method: 'GET', path: () => `/api/reports/depreciation?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'balance sheet', route: 'balanceSheet', method: 'GET', path: () => `/api/companies/${A()}/balance-sheet?fiscalYearId=${ids.aFy}`, params: p({ id: A }) },
  { label: 'income statement', route: 'incomeStatement', method: 'GET', path: () => `/api/companies/${A()}/income-statement?fiscalYearId=${ids.aFy}`, params: p({ id: A }) },
  { label: 'balance sheet layout', route: 'balanceSheetLayout', method: 'GET', path: () => `/api/companies/${A()}/balance-sheet/config`, params: p({ id: A }) },
  { label: 'list rules', route: 'rules', method: 'GET', path: () => `/api/transaction-rules?companyId=${A()}` },
  { label: 'rule draft from a transaction', route: 'ruleDraft', method: 'GET', path: () => `/api/transactions/${ids.aTransaction}/create-rule`, params: p({ id: () => ids.aTransaction }) },
  { label: 'rule suggestions', route: 'suggest', method: 'GET', path: () => `/api/transactions/${ids.aTransaction}/suggest`, params: p({ id: () => ids.aTransaction }) },
  { label: 'simulate rule', route: 'ruleSimulate', method: 'POST', path: () => `/api/transaction-rules/${ids.aRule}/simulate`, params: p({ id: () => ids.aRule }), body: () => ({ transactionExample: { amount: 10, side: 'debit' } }) },
  { label: 'simulate rule data', route: 'rulesSimulate', method: 'POST', path: () => '/api/transaction-rules/simulate', body: () => ({ companyId: A(), ruleData: { entryLines: [{ accountCode: '706000', lineType: 'auto', amountType: 'full' }] }, transactionExample: { amount: 10, side: 'credit' } }) },
  { label: 'list establishments', route: 'establishments', method: 'GET', path: () => `/api/companies/${A()}/establishments`, params: p({ id: A }) },
  { label: 'search addresses', route: 'addresses', method: 'GET', path: () => `/api/addresses?companyId=${A()}&search=Paris` },
  { label: 'get address', route: 'address', method: 'GET', path: () => `/api/addresses/${ids.aAddress}?companyId=${A()}`, params: p({ id: () => ids.aAddress }) },
  { label: 'tasks count', route: 'tasksCount', method: 'GET', path: () => `/api/tasks/count?companyId=${A()}` },
  { label: 'dashboard widget data', route: 'dashboardWidgets', method: 'GET', path: () => `/api/dashboard/widgets?companyId=${A()}&source=ledger&fiscalYearId=${ids.aFy}` },
  { label: 'dashboard bank accounts widget', route: 'dashboardWidgets', method: 'GET', path: () => `/api/dashboard/widgets?companyId=${A()}&source=bank-accounts` },
  { label: 'own dashboard layout', route: 'dashboardLayout', method: 'GET', path: () => `/api/dashboard/layout?companyId=${A()}` },
  { label: 'preview FEC fiscal years', route: 'importPreview', method: 'POST', path: () => '/api/import/preview-fiscal-years', body: () => ({ companyId: A(), content: `${FEC_HEADER}\n` }) },
  { label: 'list persons', route: 'persons', method: 'GET', path: () => `/api/companies/${A()}/persons`, params: p({ id: A }) },
  { label: 'list shareholders', route: 'shareholders', method: 'GET', path: () => `/api/companies/${A()}/shareholders`, params: p({ id: A }) },
  { label: 'lettering lines', route: 'lettering', method: 'GET', path: () => `/api/lettering?companyId=${A()}&accountId=${ids.aReceivable}` },
  { label: 'letterable accounts', route: 'letteringAccounts', method: 'GET', path: () => `/api/lettering/accounts?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'lettering suggestions', route: 'letteringSuggestions', method: 'GET', path: () => `/api/lettering/suggestions?companyId=${A()}&accountId=${ids.aReceivable}` },
  { label: 'aged balance', route: 'agedBalance', method: 'GET', path: () => `/api/reports/aged-balance?companyId=${A()}&fiscalYearId=${ids.aFy}&asOf=2026-06-30` },
  { label: 'financial indicators', route: 'financialIndicators', method: 'GET', path: () => `/api/reports/financial-indicators?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'dashboard financial indicators widget', route: 'dashboardWidgets', method: 'GET', path: () => `/api/dashboard/widgets?companyId=${A()}&source=indicators&fiscalYearId=${ids.aFy}` },
  { label: 'auxiliary balance', route: 'auxiliaryBalance', method: 'GET', path: () => `/api/reports/auxiliary-balance?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'missing receipts', route: 'missingReceipts', method: 'GET', path: () => `/api/banking/missing-receipts?companyId=${A()}&fiscalYearId=${ids.aFy}&minAmount=10` },
  { label: 'payment terms', route: 'paymentTerms', method: 'GET', path: () => `/api/companies/${A()}/payment-terms`, params: p({ id: A }) },
  { label: 'list tiers', route: 'tiers', method: 'GET', path: () => `/api/tiers?companyId=${A()}` },
  { label: 'read tiers', route: 'tiersOne', method: 'GET', path: () => `/api/tiers/${ids.aTiers}`, params: p({ id: () => ids.aTiers }) },
  { label: 'list invoices', route: 'invoices', method: 'GET', path: () => `/api/invoices?companyId=${A()}&direction=SALE` },
  { label: 'read invoice', route: 'invoice', method: 'GET', path: () => `/api/invoices/${ids.aPostedInvoice}`, params: p({ id: () => ids.aPostedInvoice }) },
  { label: 'invoice payment candidates', route: 'invoicePaymentCandidates', method: 'GET', path: () => `/api/invoices/${ids.aPostedInvoice}/payments/candidates`, params: p({ id: () => ids.aPostedInvoice }) },
  { label: 'VAT settings', route: 'vatSettings', method: 'GET', path: () => `/api/companies/${A()}/vat-settings`, params: p({ id: A }) },
  { label: 'tax regime history', route: 'taxRegimes', method: 'GET', path: () => `/api/companies/${A()}/tax-regimes?regimeType=vat`, params: p({ id: A }) },
  { label: 'deadlines of a fiscal year', route: 'deadlines', method: 'GET', path: () => `/api/deadlines?companyId=${A()}&fiscalYearId=${ids.aFy}` },
  { label: 'deadline settings', route: 'deadlineSettings', method: 'GET', path: () => `/api/companies/${A()}/deadline-settings`, params: p({ id: A }) },
  { label: 'dashboard deadlines widget', route: 'dashboardWidgets', method: 'GET', path: () => `/api/dashboard/widgets?companyId=${A()}&source=deadlines` },
  { label: 'list expense reports', route: 'expenseReports', method: 'GET', path: () => `/api/expense-reports?companyId=${A()}` },
  { label: 'read own expense report', route: 'expenseReport', method: 'GET', path: () => `/api/expense-reports/${ids.aDraftReport}`, params: p({ id: () => ids.aDraftReport }) },
  { label: 'list expense claimants', route: 'expenseClaimants', method: 'GET', path: () => `/api/expense-claimants?companyId=${A()}` },
  { label: 'list expense category rules', route: 'expenseRules', method: 'GET', path: () => `/api/expense-category-rules?companyId=${A()}` },
  { label: 'list expense receipts', route: 'expenseReceipts', method: 'GET', path: () => `/api/expense-reports/receipts?companyId=${A()}` },
  { label: 'list budgets', route: 'budgets', method: 'GET', path: () => `/api/budgets?companyId=${A()}` },
  { label: 'read budget', route: 'budget', method: 'GET', path: () => `/api/budgets/${ids.aBudget}`, params: p({ id: () => ids.aBudget }) },
  { label: 'budget against the books', route: 'budgetReport', method: 'GET', path: () => `/api/budgets/${ids.aBudget}/report`, params: p({ id: () => ids.aBudget }) },
  { label: 'list detected subscriptions', route: 'subscriptions', method: 'GET', path: () => `/api/subscriptions?companyId=${A()}` },
  { label: 'list management fee conventions', route: 'feeConventions', method: 'GET', path: () => `/api/management-fees/conventions?companyId=${A()}` },
  { label: 'read management fee convention', route: 'feeConvention', method: 'GET', path: () => `/api/management-fees/conventions/${ids.aFeeConvention}`, params: p({ id: () => ids.aFeeConvention }) },
  { label: 'list management fee invoices', route: 'feeInvoices', method: 'GET', path: () => `/api/management-fees/conventions/${ids.aFeeConvention}/invoices`, params: p({ id: () => ids.aFeeConvention }) },
  { label: 'list subsidiaries of a holding', route: 'feeSubsidiaries', method: 'GET', path: () => `/api/management-fees/subsidiaries?companyId=${A()}` },
]

/** What the accountant must not do. */
const ACCOUNTANT_FORBIDDEN = new Set([
  'delete company',
  'update company',
  'read bank credentials',
  'update integration',
  'create integration',
  'integration features',
  'integration synced resources',
  'verify bank credentials',
  'select bank account',
  'connect Qonto',
  'test Qonto connection',
  'verify Qonto credentials',
  'add member',
  'remove member',
  'reset balance sheet layout',
  'create income statement line',
  'change member role',
  'bulk delete transactions',
  'create establishment',
  'create address',
  'update establishment',
  'delete establishment',
  'create person',
  'create shareholder',
  'update shareholder',
  'delete shareholder',
  'add tax regime',
  'update tax regime',
  'delete tax regime',
  'update payment terms',
  'update deadline settings',
  'update VAT settings',
])

describe.skipIf(!available)('authorization matrix', () => {
  beforeAll(async () => {
    await prepareTestDatabase('matrix')
    ;({ prisma } = await import('@/lib/prisma'))
    for (const [name, load] of Object.entries(ROUTE_MODULES)) {
      routes[name] = (await load()) as unknown as Record<string, Handler>
    }
  }, 60_000)

  // Every write is attempted on fresh data: seed before each group.
  const reseed = async () => {
    await prepareTestDatabase('matrix')
    await seed()
  }

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  describe('anonymous', () => {
    beforeAll(reseed)
    it.each([...WRITES, ...READS].map((c) => [c.label, c] as const))('%s: 401', async (_label, c) => {
      expect((await call('anonymous', c)).status).toBe(401)
    })
  })

  describe('viewer of company A', () => {
    beforeAll(reseed)
    it.each(WRITES.map((c) => [c.label, c] as const))('%s: 403', async (_label, c) => {
      const response = await call('viewer', c)
      expect(response.status).toBe(403)
      const { error } = (await response.json()) as { error: string }
      expect(error).toMatch(/[Aa]ction (non autorisée|réservée)/)
    })

    it.each(READS.map((c) => [c.label, c] as const))('%s: 200', async (_label, c) => {
      expect((await call('viewer', c)).status).toBe(200)
    })

    it('reads by slug as well as by id', async () => {
      const bySlug = await call('viewer', { ...READS[0], path: () => `/api/entries?companyId=${ids.aSlug}` })
      expect(bySlug.status).toBe(200)
      const entries = (await bySlug.json()) as Array<{ companyId: string }>
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.every((e) => e.companyId === ids.aCompany)).toBe(true)
    })
  })

  describe('accountant of company A', () => {
    beforeAll(reseed)
    it.each(WRITES.filter((c) => ACCOUNTANT_FORBIDDEN.has(c.label)).map((c) => [c.label, c] as const))(
      '%s: 403',
      async (_label, c) => {
        expect((await call('accountant', c)).status).toBe(403)
      },
    )

    it.each(WRITES.filter((c) => !ACCOUNTANT_FORBIDDEN.has(c.label)).map((c) => [c.label, c] as const))(
      '%s: allowed by role (not 401/403/404)',
      async (_label, c) => {
        await reseed() // earlier writes may have deleted the rows this one uses
        expect([401, 403, 404]).not.toContain((await call('accountant', c)).status)
      },
    )

    it('cannot reconcile a transaction with an entry of company B', async () => {
      await reseed()
      const response = await call('accountant', {
        label: 'cross reconcile',
        route: 'reconcile',
        method: 'POST',
        path: () => `/api/transactions/${ids.aTransaction}/reconcile`,
        params: p({ id: () => ids.aTransaction }),
        body: () => ({ entryId: ids.bEntry }),
      })
      expect(response.status).toBe(404)
      expect((await prisma.bankTransaction.findUnique({ where: { id: ids.aTransaction } }))?.reconciledWith).toBeNull()
    })

    it("cannot record depreciation on company B's fiscal year nor link company B's entry", async () => {
      await reseed()
      const onForeignYear = await call('accountant', {
        label: 'cross depreciation',
        route: 'depreciationRecords',
        method: 'POST',
        path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation`,
        params: p({ id: () => ids.aFixedAsset }),
        body: () => ({ fiscalYearId: ids.bFy, periodType: 'year', amount: 10 }),
      })
      expect(onForeignYear.status).toBe(404)
      const foreignEntry = await call('accountant', {
        label: 'cross link',
        route: 'depreciationRecord',
        method: 'PATCH',
        path: () => `/api/fixed-assets/${ids.aFixedAsset}/depreciation/${ids.aDepreciation}`,
        params: p({ id: () => ids.aFixedAsset, entryId: () => ids.aDepreciation }),
        body: () => ({ accountingEntryId: ids.bValidated }),
      })
      expect(foreignEntry.status).toBe(404)
      expect((await prisma.fixedAssetDepreciation.findUnique({ where: { id: ids.aDepreciation } }))?.accountingEntryId).toBeNull()
    })

    it("cannot read a report of company B's fiscal year", async () => {
      const response = await call('accountant', {
        label: 'cross balance sheet',
        route: 'balanceSheet',
        method: 'GET',
        path: () => `/api/companies/${A()}/balance-sheet?fiscalYearId=${ids.bFy}`,
        params: p({ id: A }),
      })
      expect(response.status).toBe(404)
    })

    it("cannot record an invoice for company B's tiers, nor a payment line of company B", async () => {
      await reseed()
      const crossTiers = await call('accountant', {
        label: 'cross tiers invoice',
        route: 'invoices',
        method: 'POST',
        path: () => '/api/invoices',
        body: () => ({ companyId: A(), direction: 'SALE', tiersId: ids.bTiers, number: 'X-1', issueDate: '2026-03-10', lines: [{ label: 'A', quantity: '1', unitPriceCents: 1000, vatRateBp: 0 }] }),
      })
      expect(crossTiers.status).toBe(404)
      expect(await prisma.invoice.count({ where: { number: 'X-1' } })).toBe(0)
      await prisma.entryLine.updateMany({ where: { id: ids.aInvoiceLine }, data: { letteringCode: null, letteringDate: null } })
      const crossPayment = await call('accountant', {
        label: 'cross payment',
        route: 'invoicePayments',
        method: 'POST',
        path: () => `/api/invoices/${ids.aPostedInvoice}/payments`,
        params: p({ id: () => ids.aPostedInvoice }),
        body: () => ({ entryLineId: ids.bPaymentLine }),
      })
      expect(crossPayment.status).toBe(404)
      expect(await prisma.invoicePayment.count()).toBe(0)
    })

    it('reads the document route of an invoice without a Qonto document as 404, never another company', async () => {
      const own = await call('viewer', { label: 'attachment', route: 'invoiceAttachment', method: 'GET', path: () => `/api/invoices/${ids.aPostedInvoice}/attachment`, params: p({ id: () => ids.aPostedInvoice }) })
      expect(own.status).toBe(404)
      expect(((await own.json()) as { error: string }).error).toMatch(/Aucun document/)
      const foreign = await call('memberB', { label: 'attachment', route: 'invoiceAttachment', method: 'GET', path: () => `/api/invoices/${ids.aPostedInvoice}/attachment`, params: p({ id: () => ids.aPostedInvoice }) })
      expect(foreign.status).toBe(404)
      expect(((await foreign.json()) as { error: string }).error).not.toMatch(/Aucun document/)
    })

    it("cannot create an entry with company B's journal or accounts", async () => {
      const response = await call('accountant', {
        label: 'cross entry',
        route: 'entries',
        method: 'POST',
        path: () => '/api/entries',
        body: () => ({
          companyId: A(),
          journalId: ids.bJournal,
          date: '2026-03-10',
          description: 'x',
          lines: [
            { accountId: ids.bAccount, debit: 10, credit: 0 },
            { accountId: ids.aAccount, debit: 0, credit: 10 },
          ],
        }),
      })
      expect(response.status).toBe(400)
      expect(await prisma.accountingEntry.count({ where: { companyId: A(), description: 'x' } })).toBe(0)
    })
  })

  describe('company admin of company A', () => {
    beforeAll(reseed)
    it('reads bank credentials masked, never the secret', async () => {
      const response = await call('companyAdmin', WRITES.find((c) => c.label === 'read bank credentials')!)
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).not.toContain(SECRET)
      expect(text).toContain('9876')
    })

    it('never receives bank secrets in list responses', async () => {
      for (const c of READS.filter((r) => ['list integrations', 'list transactions'].includes(r.label))) {
        const text = await (await call('companyAdmin', c)).text()
        expect(text, c.label).not.toContain(SECRET)
        expect(text, c.label).not.toContain('encrypted-secret')
        expect(text, c.label).not.toContain('secretKeyEncrypted')
      }
    })

    it('manages bank connections without reading a secret back', async () => {
      for (const label of ['create integration', 'integration features', 'integration synced resources']) {
        const response = await call('companyAdmin', WRITES.find((c) => c.label === label)!)
        expect(response.status, label).toBeLessThan(300)
        const text = await response.text()
        expect(text, label).not.toContain('ponto-secret')
        expect(text, label).not.toContain(SECRET)
        expect(text, label).not.toContain('"credentials"')
      }
    })

    it('cannot delete the company (instance administrators only, books kept 10 years)', async () => {
      expect((await call('companyAdmin', WRITES.find((c) => c.label === 'delete company')!)).status).toBe(403)
      expect(await prisma.company.count({ where: { id: ids.aCompany } })).toBe(1)
    })

    it('cannot manage members (instance administrators only)', async () => {
      expect((await call('companyAdmin', WRITES.find((c) => c.label === 'add member')!)).status).toBe(403)
      expect((await call('companyAdmin', WRITES.find((c) => c.label === 'change member role')!)).status).toBe(403)
    })

    it('manages the company settings', async () => {
      for (const label of ['create establishment', 'update shareholder', 'add tax regime', 'update deadline settings']) {
        expect((await call('companyAdmin', WRITES.find((c) => c.label === label)!)).status, label).toBeLessThan(300)
      }
    })

    it('cannot search the users of the instance (instance administrators only)', async () => {
      const search: Call = { label: 'users', route: 'users', method: 'GET', path: () => '/api/users?search=test' }
      expect((await call('companyAdmin', search)).status).toBe(403)
      expect((await call('anonymous', search)).status).toBe(401)
      expect((await call('admin', search)).status).toBe(200)
    })
  })

  describe('own appearance preferences (any signed-in user, no company)', () => {
    beforeAll(reseed)
    const appearance = (method: 'GET' | 'PUT', body?: unknown): Call => ({
      label: `appearance ${method}`,
      route: 'appearance',
      method,
      path: () => '/api/account/appearance',
      ...(body === undefined ? {} : { body: () => body }),
    })
    const read = async (who: Who) =>
      (await (await call(who, appearance('GET'))).json()) as { appearance: { palette: string; custom: { light: Record<string, string> } }; isDefault: boolean }

    it('anonymous: 401 on read and write', async () => {
      expect((await call('anonymous', appearance('GET'))).status).toBe(401)
      expect((await call('anonymous', appearance('PUT', { palette: 'pastel' }))).status).toBe(401)
      expect(await prisma.userPreference.count()).toBe(0)
    })

    it('every role saves its own colours, a viewer included (a preference, not a change to the books)', async () => {
      for (const who of ['viewer', 'accountant', 'companyAdmin', 'memberB', 'admin'] as const) {
        expect((await call(who, appearance('GET'))).status, who).toBe(200)
      }
      expect((await call('viewer', appearance('PUT', { palette: 'custom', base: 'sobre', custom: { light: { revenue: '#0072B2' }, dark: {} } }))).status).toBe(200)
      expect((await call('memberB', appearance('PUT', { palette: 'contraste' }))).status).toBe(200)
    })

    it("reads only one's own preferences: another user's choice never shows", async () => {
      const viewer = await read('viewer')
      expect(viewer).toMatchObject({ isDefault: false, appearance: { palette: 'custom', custom: { light: { revenue: '#0072b2' } } } })
      expect((await read('memberB')).appearance.palette).toBe('contraste')
      expect(await read('accountant')).toMatchObject({ isDefault: true, appearance: { palette: 'sobre' } })
      const rows = await prisma.userPreference.findMany({ select: { userId: true }, orderBy: { userId: 'asc' } })
      expect(rows.map((r) => r.userId)).toEqual(['u-member-b', 'u-viewer'])
    })

    it('cannot write for another user and refuses invalid colours', async () => {
      expect((await call('accountant', appearance('PUT', { palette: 'pastel', userId: 'u-viewer' }))).status).toBe(400)
      expect((await call('accountant', appearance('PUT', { palette: 'custom', custom: { light: { revenue: 'red' } } }))).status).toBe(400)
      expect((await call('accountant', appearance('PUT', { palette: 'neon' }))).status).toBe(400)
      expect((await read('viewer')).appearance.palette).toBe('custom')
      expect(await prisma.userPreference.count({ where: { userId: 'u-accountant' } })).toBe(0)
    })
  })

  describe('own expense reports (expenses:submit, every role)', () => {
    beforeAll(reseed)
    const lines = [{ date: '2026-03-10', label: 'Fournitures', category: 'SUPPLIES', amountInclTaxCents: 2_400, vatRateBp: 2000, receiptKind: 'INVOICE' }]
    const OWN: Call[] = [
      { label: 'create own expense report', route: 'expenseReports', method: 'POST', path: () => '/api/expense-reports', body: () => ({ companyId: A(), periodStart: '2026-03-01', periodEnd: '2026-03-31', lines }) },
      { label: 'update own draft', route: 'expenseReport', method: 'PATCH', path: () => `/api/expense-reports/${ids.aDraftReport}`, params: p({ id: () => ids.aDraftReport }), body: () => ({ periodStart: '2026-03-01', periodEnd: '2026-03-31', lines }) },
      { label: 'submit own draft', route: 'expenseWorkflow', method: 'POST', path: () => `/api/expense-reports/${ids.aDraftReport}/workflow`, params: p({ id: () => ids.aDraftReport }), body: () => ({ action: 'submit' }) },
    ]

    it.each(OWN.map((c) => [c.label, c] as const))('%s: anonymous 401, member of B 404', async (_label, c) => {
      expect((await call('anonymous', c)).status).toBe(401)
      expect((await call('memberB', c)).status).toBe(404)
    })

    it('a viewer records, edits and submits their own report, never validates it', async () => {
      const [create, update, submit] = OWN
      expect((await call('viewer', create)).status).toBe(201)
      expect((await call('viewer', update)).status).toBe(200)
      expect((await call('viewer', submit)).status).toBe(200)
      const validate = await call('viewer', { ...submit, body: () => ({ action: 'validate' }) })
      expect(validate.status).toBe(403)
      expect((await prisma.expenseReport.findUniqueOrThrow({ where: { id: ids.aDraftReport } })).status).toBe('SUBMITTED')
    })

    it("a viewer never reaches another person's report; a validator does", async () => {
      const own = await prisma.expenseClaimant.findFirstOrThrow({ where: { userId: 'u-viewer' } })
      await prisma.expenseClaimant.update({ where: { id: own.id }, data: { userId: 'u-accountant' } })
      try {
        const read: Call = { label: 'read', route: 'expenseReport', method: 'GET', path: () => `/api/expense-reports/${ids.aValidatedReport}`, params: p({ id: () => ids.aValidatedReport }) }
        expect((await call('viewer', read)).status).toBe(404)
        expect((await call('accountant', read)).status).toBe(200)
        const list = await call('viewer', { label: 'list', route: 'expenseReports', method: 'GET', path: () => `/api/expense-reports?companyId=${A()}` })
        expect(((await list.json()) as { items: unknown[] }).items).toEqual([])
      } finally {
        await prisma.expenseClaimant.update({ where: { id: own.id }, data: { userId: 'u-viewer' } })
      }
    })
  })

  describe('member of company B', () => {
    beforeAll(reseed)
    it.each([...WRITES, ...READS].map((c) => [c.label, c] as const))('%s on company A: 404', async (_label, c) => {
      // Member routes and company deletion are reserved to instance administrators: 403 before any lookup
      const adminOnly = (c.route === 'members' && c.method !== 'GET') || c.route === 'member' || c.label === 'delete company'
      const expected = adminOnly ? 403 : 404
      expect((await call('memberB', c)).status).toBe(expected)
    })

    it('gets 404 on the company slug too', async () => {
      expect((await call('memberB', { ...READS[0], path: () => `/api/entries?companyId=${ids.aSlug}` })).status).toBe(404)
    })

    it('only lists its own company', async () => {
      const response = await call('memberB', { label: 'companies', route: 'companies', method: 'GET', path: () => '/api/companies' })
      const companies = (await response.json()) as Array<{ id: string }>
      expect(companies.map((c) => c.id)).toEqual([ids.bCompany])
    })
  })

  describe('reconciled entry dates', () => {
    beforeAll(reseed)
    it('only re-dates draft entries of the company, in an open fiscal year', async () => {
      const { updateEntryDatesFromReconciledTransactions } = await import(
        '@/lib/services/banking/update-entry-dates-from-transactions.service'
      )
      // A: draft entry reconciled; B: validated entry reconciled
      await prisma.bankTransaction.update({ where: { id: ids.aTransaction }, data: { reconciled: true, reconciledWith: ids.aEntry } })
      await prisma.bankTransaction.update({ where: { id: ids.bTransaction }, data: { reconciled: true, reconciledWith: ids.bValidated } })

      await updateEntryDatesFromReconciledTransactions({ companyId: ids.bCompany })
      expect((await prisma.accountingEntry.findUnique({ where: { id: ids.aEntry } }))?.date.toISOString()).toBe('2026-03-01T00:00:00.000Z')
      expect((await prisma.accountingEntry.findUnique({ where: { id: ids.bValidated } }))?.date.toISOString()).toBe('2026-03-02T00:00:00.000Z')

      const { entriesUpdated } = await updateEntryDatesFromReconciledTransactions({ companyId: ids.aCompany })
      expect(entriesUpdated).toBe(1)
      expect((await prisma.accountingEntry.findUnique({ where: { id: ids.aEntry } }))?.date.toISOString()).toBe('2026-03-05T00:00:00.000Z')

      // Set the date first: once the year is closed the database refuses any change.
      await prisma.accountingEntry.update({ where: { id: ids.aEntry }, data: { date: new Date('2026-03-01T00:00:00Z') } })
      await prisma.fiscalYear.update({ where: { id: ids.aFy }, data: { isClosed: true } })
      expect((await updateEntryDatesFromReconciledTransactions({ companyId: ids.aCompany })).entriesUpdated).toBe(0)
    })
  })

  describe('responses never carry secrets', () => {
    /** Values seeded in secret columns: none may appear in any response. */
    const SECRETS = {
      bankSecret: SECRET,
      bankSecretEncrypted: 'encrypted-secret',
      passwordHash: 'scrypt-password-hash-never-returned',
      sessionToken: 'session-token-never-returned',
      apiKeyHash: 'api-key-hash-never-returned',
      githubToken: 'github-token-encrypted-never-returned',
      oauthSecret: 'oauth-client-secret-never-returned',
    }
    /** Keys that name a secret: a response object never has them, whatever their value. */
    const FORBIDDEN_KEYS = new Set([
      'password',
      'secretKey',
      'secretKeyEncrypted',
      'credentials',
      'token',
      'tokenEncrypted',
      'accessToken',
      'refreshToken',
      'idToken',
      'clientSecret',
      'key',
    ])

    /** Reads beyond the matrix that return connections, accounts or users. */
    const SECRET_READS: Call[] = [
      { label: 'bank connections', route: 'bankConnections', method: 'GET', path: () => `/api/banking/connections?companyId=${A()}` },
      { label: 'bank accounts', route: 'bankAccounts', method: 'GET', path: () => `/api/banking/accounts?companyId=${A()}` },
      { label: 'qonto status', route: 'qontoStatus', method: 'GET', path: () => `/api/qonto/status?companyId=${A()}` },
      { label: 'AI access grants', route: 'grants', method: 'GET', path: () => '/api/ai-access/grants' },
    ]
    const ADMIN_READS: Call[] = [{ label: 'users search', route: 'users', method: 'GET', path: () => '/api/users?search=test' }]

    function forbiddenKeysOf(value: unknown, path = '$'): string[] {
      if (Array.isArray(value)) return value.flatMap((item, i) => forbiddenKeysOf(item, `${path}[${i}]`))
      if (!value || typeof value !== 'object') return []
      return Object.entries(value).flatMap(([key, child]) => [
        ...(FORBIDDEN_KEYS.has(key) ? [`${path}.${key}`] : []),
        ...forbiddenKeysOf(child, `${path}.${key}`),
      ])
    }

    beforeAll(async () => {
      await reseed()
      const now = new Date()
      await prisma.authAccount.create({
        data: { id: 'acc-cadmin', accountId: 'u-cadmin', providerId: 'credential', userId: 'u-cadmin', password: SECRETS.passwordHash, createdAt: now, updatedAt: now },
      })
      await prisma.session.create({
        data: { id: 's-cadmin', token: SECRETS.sessionToken, userId: 'u-cadmin', expiresAt: new Date(now.getTime() + 3_600_000), createdAt: now, updatedAt: now },
      })
      await prisma.apikey.create({ data: { id: 'key-cadmin', referenceId: 'u-cadmin', key: SECRETS.apiKeyHash, name: 'Claude', createdAt: now, updatedAt: now } })
      await prisma.updateConnection.create({ data: { owner: 'kledghq', repo: 'kledg', tokenEncrypted: SECRETS.githubToken, tokenLast4: 'abcd' } })
      await prisma.bankConnection.update({ where: { id: (await prisma.bankAccount.findUniqueOrThrow({ where: { id: ids.aBankAccount } })).bankConnectionId }, data: { integrationId: ids.aIntegration, provider: 'QONTO' } })
    })

    const cases = (['companyAdmin', 'admin'] as const).flatMap((who) =>
      [...READS, ...SECRET_READS, ...(who === 'admin' ? ADMIN_READS : [])].map((c) => [`${who}: ${c.label}`, who, c] as const),
    )

    it.each(cases)('%s', async (_label, who, c) => {
      const response = await call(who, c)
      expect(response.status, c.label).toBe(200)
      const text = await response.text()
      for (const [name, secret] of Object.entries(SECRETS)) expect(text, `${c.label} leaks ${name}`).not.toContain(secret)
      expect(forbiddenKeysOf(JSON.parse(text)), c.label).toEqual([])
    })

    it('reads bank credentials only masked, through their own route', async () => {
      const text = await (await call('companyAdmin', WRITES.find((w) => w.label === 'read bank credentials')!)).text()
      for (const secret of Object.values(SECRETS)) expect(text).not.toContain(secret)
    })
  })
})
