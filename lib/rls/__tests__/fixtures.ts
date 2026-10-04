/**
 * Two tenants with a row in every table that carries row level security
 * (docs/rls.md), for the isolation tests. Company `a` and company `b` get the
 * same rows, with ids `<prefix>-<table>`; company `c` only has its company
 * and organization (a second membership of the multi-company user).
 *
 * Users: `u-a` (member of a), `u-b` (member of b), `u-ac` (member of a and c),
 * `u-admin` (instance administrator, no membership), `u-banned` (member of a,
 * banned).
 */

import type { PrismaClient } from '@prisma/client'
import { withSystemContext } from '@/lib/rls/context'

export const USER_A = 'u-a'
export const USER_B = 'u-b'
export const USER_AC = 'u-ac'
export const ADMIN = 'u-admin'
export const BANNED = 'u-banned'

export const COMPANY = { a: 'company-a', b: 'company-b', c: 'company-c' } as const
type Tenant = 'a' | 'b'

/** How to name a row of each table in SQL (tables without an `id` column). */
export const ROW_KEY: Readonly<Record<string, string>> = {
  ai_access_grant_companies: `"grantId" || ':' || "companyId"`,
  company_onboarding: `"companyId"`,
}

export const rowKey = (table: string) => ROW_KEY[table] ?? `"id"`

/** Seeded keys per table and tenant. */
export type SeededKeys = Record<string, Record<Tenant, string>>

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

export async function seedTenants(prisma: PrismaClient): Promise<SeededKeys> {
  return withSystemContext('test', async () => {
    const keys: SeededKeys = {}
    const record = (table: string, tenant: Tenant, key: string) => {
      keys[table] ??= { a: '', b: '' }
      keys[table][tenant] = key
    }

    await prisma.user.createMany({
      data: [
        { id: USER_A, email: 'a@rls.test', name: 'A' },
        { id: USER_B, email: 'b@rls.test', name: 'B' },
        { id: USER_AC, email: 'ac@rls.test', name: 'AC' },
        { id: ADMIN, email: 'admin@rls.test', name: 'Admin', role: 'admin' },
        { id: BANNED, email: 'banned@rls.test', name: 'Banned', banned: true },
      ],
    })
    await prisma.company.create({ data: { id: COMPANY.c, name: 'Compagnie C', slug: 'compagnie-c', siren: '333333333' } })
    await prisma.organization.create({ data: { id: 'c-organization', name: 'C', slug: 'org-c', createdAt: new Date(), companyId: COMPANY.c } })
    await prisma.member.create({ data: { id: 'ac-member-c', organizationId: 'c-organization', userId: USER_AC, createdAt: new Date() } })

    for (const p of ['a', 'b'] as const) {
      const id = (table: string) => `${p}-${table}`
      const companyId = COMPANY[p]
      const owner = p === 'a' ? USER_A : USER_B
      await prisma.company.create({
        data: { id: companyId, name: `Societe ${p}`, slug: `societe-${p}`, siren: p === 'a' ? '111111111' : '222222222' },
      })
      record('companies', p, companyId)
      await prisma.organization.create({ data: { id: id('organization'), name: p, slug: `org-${p}`, createdAt: new Date(), companyId } })
      record('organization', p, id('organization'))
      await prisma.member.create({ data: { id: id('member'), organizationId: id('organization'), userId: owner, createdAt: new Date(), role: 'owner' } })
      record('member', p, id('member'))
      if (p === 'a') {
        await prisma.member.createMany({
          data: [
            { id: 'ac-member-a', organizationId: id('organization'), userId: USER_AC, createdAt: new Date() },
            { id: 'banned-member-a', organizationId: id('organization'), userId: BANNED, createdAt: new Date() },
          ],
        })
      }
      await prisma.invitation.create({
        data: { id: id('invitation'), organizationId: id('organization'), email: `invite-${p}@rls.test`, expiresAt: day('2030-01-01'), inviterId: owner },
      })
      record('invitation', p, id('invitation'))

      await prisma.address.create({ data: { id: id('addresses'), companyId, street: '1 rue', postalCode: '75001', city: 'Paris' } })
      record('addresses', p, id('addresses'))
      await prisma.establishment.create({ data: { id: id('establishments'), companyId, siret: `${p === 'a' ? '111111111' : '222222222'}00011` } })
      record('establishments', p, id('establishments'))
      await prisma.person.create({ data: { id: id('persons'), companyId, firstName: 'Jeanne', name: p } })
      record('persons', p, id('persons'))
      await prisma.shareholder.create({
        data: { id: id('shareholders'), companyId, type: 'PHYSICAL', personId: id('persons'), sharePercentage: 100 },
      })
      record('shareholders', p, id('shareholders'))

      await prisma.fiscalYear.create({
        data: { id: id('fiscal_years'), companyId, year: 2026, startDate: day('2026-01-01'), endDate: day('2026-12-31') },
      })
      record('fiscal_years', p, id('fiscal_years'))
      await prisma.account.createMany({
        data: [
          { id: id('accounts'), companyId, fiscalYearId: id('fiscal_years'), code: '512000', label: 'Banque' },
          { id: `${p}-account-sales`, companyId, fiscalYearId: id('fiscal_years'), code: '706000', label: 'Ventes' },
        ],
      })
      record('accounts', p, id('accounts'))
      await prisma.journal.create({ data: { id: id('journals'), companyId, code: 'OD', label: 'Operations diverses' } })
      record('journals', p, id('journals'))
      await prisma.accountingEntry.create({
        data: {
          id: id('accounting_entries'),
          companyId,
          fiscalYearId: id('fiscal_years'),
          journalId: id('journals'),
          entryNumber: 'BR-1',
          date: day('2026-03-01'),
          status: 'draft',
        },
      })
      record('accounting_entries', p, id('accounting_entries'))
      await prisma.entryLine.createMany({
        data: [
          {
            id: id('entry_lines'),
            accountingEntryId: id('accounting_entries'),
            accountingEntryNumber: 'BR-1',
            accountId: id('accounts'),
            accountFiscalYearId: id('fiscal_years'),
            debit: 100,
          },
          {
            id: `${p}-entry-line-2`,
            accountingEntryId: id('accounting_entries'),
            accountingEntryNumber: 'BR-1',
            accountId: `${p}-account-sales`,
            accountFiscalYearId: id('fiscal_years'),
            credit: 100,
          },
        ],
      })
      record('entry_lines', p, id('entry_lines'))

      await prisma.bankConnection.create({ data: { id: id('bank_connections'), companyId } })
      record('bank_connections', p, id('bank_connections'))
      await prisma.bankAccount.create({
        data: { id: id('bank_accounts'), bankConnectionId: id('bank_connections'), externalAccountId: `ext-${p}`, name: 'Compte' },
      })
      record('bank_accounts', p, id('bank_accounts'))
      await prisma.bankTransaction.createMany({
        data: [
          { id: id('bank_transactions'), bankAccountId: id('bank_accounts'), externalTransactionId: `tx-${p}`, amount: 10, date: day('2026-03-02'), side: 'credit' },
          { id: `${p}-bank-transaction-2`, bankAccountId: id('bank_accounts'), externalTransactionId: `tx2-${p}`, amount: 10, date: day('2026-03-03'), side: 'credit' },
        ],
      })
      record('bank_transactions', p, id('bank_transactions'))
      await prisma.bankTransactionMatch.create({
        data: { id: id('bank_transaction_matches'), bankAccountId: id('bank_accounts'), externalTransactionId: `dup-${p}`, bankTransactionId: `${p}-bank-transaction-2` },
      })
      record('bank_transaction_matches', p, id('bank_transaction_matches'))
      await prisma.transactionMapping.create({ data: { id: id('transaction_mappings'), bankConnectionId: id('bank_connections') } })
      record('transaction_mappings', p, id('transaction_mappings'))

      await prisma.transactionRule.create({ data: { id: id('transaction_rules'), companyId, name: 'Regle' } })
      record('transaction_rules', p, id('transaction_rules'))
      await prisma.transactionRuleCondition.create({
        data: { id: id('transaction_rule_conditions'), ruleId: id('transaction_rules'), conditionType: 'label', operator: 'contains', value: 'x' },
      })
      record('transaction_rule_conditions', p, id('transaction_rule_conditions'))
      await prisma.transactionRuleEntryLine.create({
        data: { id: id('transaction_rule_entry_lines'), ruleId: id('transaction_rules'), accountCode: '706000', lineType: 'auto', amountType: 'full', order: 0 },
      })
      record('transaction_rule_entry_lines', p, id('transaction_rule_entry_lines'))

      await prisma.integration.create({
        data: { id: id('integrations'), companyId, provider: 'QONTO', type: 'BANKING', name: 'Qonto', credentials: {} },
      })
      record('integrations', p, id('integrations'))
      await prisma.integrationFeatureConfig.create({
        data: { id: id('integration_features'), integrationId: id('integrations'), feature: 'BANKING_TRANSACTIONS' },
      })
      record('integration_features', p, id('integration_features'))
      await prisma.integrationResource.create({
        data: { id: id('integration_resources'), integrationId: id('integrations'), resourceType: 'account', externalId: `res-${p}`, name: 'R', data: {} },
      })
      record('integration_resources', p, id('integration_resources'))
      await prisma.integrationSyncLog.create({
        data: { id: id('integration_sync_logs'), integrationId: id('integrations'), status: 'success', startedAt: new Date() },
      })
      record('integration_sync_logs', p, id('integration_sync_logs'))

      await prisma.importJob.create({ data: { id: id('import_jobs'), companyId, type: 'csv', fileName: 'f.csv' } })
      record('import_jobs', p, id('import_jobs'))
      await prisma.importMapping.create({ data: { id: id('import_mappings'), importJobId: id('import_jobs'), sourceColumn: 'a', targetField: 'b' } })
      record('import_mappings', p, id('import_mappings'))

      await prisma.fixedAsset.create({
        data: {
          id: id('fixed_assets'),
          companyId,
          label: 'Ordinateur',
          acquisitionDate: day('2026-01-10'),
          acquisitionValue: 1200,
          depreciationStartDate: day('2026-01-10'),
          assetAccountId: id('accounts'),
          depreciationAccountId: id('accounts'),
          expenseAccountId: id('accounts'),
        },
      })
      record('fixed_assets', p, id('fixed_assets'))
      await prisma.fixedAssetDepreciation.create({
        data: { id: id('fixed_asset_depreciations'), companyId, fixedAssetId: id('fixed_assets'), fiscalYearId: id('fiscal_years'), periodType: 'year', year: 2026, amount: 400 },
      })
      record('fixed_asset_depreciations', p, id('fixed_asset_depreciations'))
      await prisma.taxRegimeHistory.create({
        data: { id: id('tax_regime_history'), companyId, regimeType: 'IS', regime: 'reel', startDate: day('2026-01-01') },
      })
      record('tax_regime_history', p, id('tax_regime_history'))
      await prisma.attachment.create({ data: { id: id('attachments'), companyId, fileName: 'piece.pdf' } })
      record('attachments', p, id('attachments'))

      await prisma.balanceSheetLineConfig.create({
        data: { id: id('balance_sheet_line_configs'), companyId, lineLabel: 'Actif', balanceType: 'asset', order: 0 },
      })
      record('balance_sheet_line_configs', p, id('balance_sheet_line_configs'))
      await prisma.balanceSheetConfigHistory.create({
        data: { id: id('balance_sheet_config_history'), configId: id('balance_sheet_line_configs'), version: 1, data: {} },
      })
      record('balance_sheet_config_history', p, id('balance_sheet_config_history'))
      await prisma.incomeStatementLineConfig.create({
        data: { id: id('income_statement_line_configs'), companyId, lineLabel: 'Produits', balanceType: 'income', order: 0 },
      })
      record('income_statement_line_configs', p, id('income_statement_line_configs'))
      await prisma.incomeStatementConfigHistory.create({
        data: { id: id('income_statement_config_history'), configId: id('income_statement_line_configs'), version: 1, data: {} },
      })
      record('income_statement_config_history', p, id('income_statement_config_history'))
      await prisma.balanceSheetConfigTemplate.create({
        data: { id: id('balance_sheet_config_templates'), companyId, name: 'Modele', reportVariant: 'complete', configData: {} },
      })
      record('balance_sheet_config_templates', p, id('balance_sheet_config_templates'))
      await prisma.incomeStatementConfigTemplate.create({
        data: { id: id('income_statement_config_templates'), companyId, name: 'Modele', reportVariant: 'complete', configData: {} },
      })
      record('income_statement_config_templates', p, id('income_statement_config_templates'))

      await prisma.auditLog.createMany({ data: { id: id('audit_logs'), companyId, message: 'Ecriture creee', userId: owner } })
      record('audit_logs', p, id('audit_logs'))
      await prisma.companyOnboarding.create({ data: { companyId } })
      record('company_onboarding', p, companyId)
      await prisma.dashboardLayout.create({ data: { id: id('dashboard_layouts'), userId: owner, companyId, layout: {} } })
      record('dashboard_layouts', p, id('dashboard_layouts'))
      await prisma.mcpConfirmation.create({
        data: { id: id('mcp_confirmations'), tokenHash: `hash-${p}`, userId: owner, caller: 'apiKey:k', tool: 't', companyId, argsHash: 'h', expiresAt: day('2030-01-01') },
      })
      record('mcp_confirmations', p, id('mcp_confirmations'))
      await prisma.mcpPendingAction.create({
        data: { id: id('mcp_pending_actions'), userId: owner, caller: 'apiKey:k', tool: 't', companyId, args: {}, argsHash: 'h', preview: {}, expiresAt: day('2030-01-01') },
      })
      record('mcp_pending_actions', p, id('mcp_pending_actions'))
      // A grant targets an OAuth client or an API key (check constraint).
      await prisma.apikey.create({ data: { id: `${p}-key`, referenceId: owner, key: `hash-key-${p}`, createdAt: new Date(), updatedAt: new Date() } })
      await prisma.aiAccessGrant.create({ data: { id: id('ai_access_grants'), userId: owner, apiKeyId: `${p}-key`, allCompanies: false } })
      record('ai_access_grants', p, id('ai_access_grants'))
      await prisma.aiAccessGrantCompany.create({ data: { grantId: id('ai_access_grants'), companyId } })
      record('ai_access_grant_companies', p, `${id('ai_access_grants')}:${companyId}`)
      await prisma.userPreference.create({ data: { id: id('user_preferences'), userId: owner, appearance: {} } })
      record('user_preferences', p, id('user_preferences'))

      await prisma.tiers.create({ data: { id: id('tiers'), companyId, kind: 'CUSTOMER', name: 'Client', auxiliaryAccountNumber: `411${p.toUpperCase()}` } })
      record('tiers', p, id('tiers'))
      await prisma.invoice.create({
        data: {
          id: id('invoices'),
          companyId,
          direction: 'SALE',
          tiersId: id('tiers'),
          number: `F-${p}`,
          issueDate: day('2026-03-01'),
          dueDate: day('2026-03-31'),
          totalExclTax: 100,
          totalVat: 20,
          totalInclTax: 120,
        },
      })
      record('invoices', p, id('invoices'))
      await prisma.invoiceLine.create({
        data: { id: id('invoice_lines'), invoiceId: id('invoices'), position: 1, label: 'Prestation', quantity: 1, unitPrice: 100, vatRateBp: 2000, totalExclTax: 100 },
      })
      record('invoice_lines', p, id('invoice_lines'))
      await prisma.invoiceVatBreakdown.create({
        data: { id: id('invoice_vat_breakdowns'), invoiceId: id('invoices'), vatRateBp: 2000, baseAmount: 100, vatAmount: 20 },
      })
      record('invoice_vat_breakdowns', p, id('invoice_vat_breakdowns'))
      await prisma.invoicePayment.create({
        data: { id: id('invoice_payments'), invoiceId: id('invoices'), entryLineId: `${p}-entry-line-2`, amount: 50 },
      })
      record('invoice_payments', p, id('invoice_payments'))

      await prisma.expenseClaimant.create({
        data: { id: id('expense_claimants'), companyId, kind: 'EMPLOYEE', name: 'Salarie', userId: owner, auxiliaryAccountNumber: `S${p.toUpperCase()}` },
      })
      record('expense_claimants', p, id('expense_claimants'))
      await prisma.expenseReport.create({
        data: {
          id: id('expense_reports'),
          companyId,
          claimantId: id('expense_claimants'),
          number: `NDF-${p}`,
          periodStart: day('2026-03-01'),
          periodEnd: day('2026-03-31'),
          totalInclTax: 60,
          recoverableVat: 10,
          totalExpense: 50,
        },
      })
      record('expense_reports', p, id('expense_reports'))
      await prisma.expenseLine.create({
        data: {
          id: id('expense_lines'),
          reportId: id('expense_reports'),
          position: 1,
          date: day('2026-03-10'),
          label: 'Fournitures',
          category: 'SUPPLIES',
          amountInclTax: 60,
          vatRateBp: 2000,
          vatAmount: 10,
          recoverableVat: 10,
          receiptKind: 'INVOICE',
        },
      })
      record('expense_lines', p, id('expense_lines'))
      await prisma.expenseCategoryRule.create({ data: { id: id('expense_category_rules'), companyId, keyword: 'sncf', category: 'TRANSPORT' } })
      record('expense_category_rules', p, id('expense_category_rules'))

      await prisma.budget.create({ data: { id: id('budgets'), companyId, fiscalYearId: id('fiscal_years') } })
      record('budgets', p, id('budgets'))
      await prisma.budgetLine.create({ data: { id: id('budget_lines'), budgetId: id('budgets'), accountPrefix: '706', label: 'Ventes' } })
      record('budget_lines', p, id('budget_lines'))
      await prisma.budgetLineAmount.create({ data: { id: id('budget_line_amounts'), lineId: id('budget_lines'), month: '2026-03', amount: 1000 } })
      record('budget_line_amounts', p, id('budget_line_amounts'))
      await prisma.budgetRecurringItem.create({
        data: { id: id('budget_recurring_items'), lineId: id('budget_lines'), label: 'Abonnement', amount: 50, frequency: 'MONTHLY', startMonth: '2026-01' },
      })
      record('budget_recurring_items', p, id('budget_recurring_items'))
      await prisma.subscriptionDecision.create({
        data: { id: id('subscription_decisions'), companyId, counterpartyKey: 'NUAGE PRO', cadence: 'MONTHLY', referenceAmount: 29.9, status: 'CONFIRMED', budgetLineId: id('budget_lines') },
      })
      record('subscription_decisions', p, id('subscription_decisions'))
      await prisma.simpleModeEntry.create({
        data: { id: id('simple_mode_entries'), companyId, entryId: id('accounting_entries'), bankTransactionId: id('bank_transactions'), categoryId: 'telephone-internet', counterpartyKey: 'FREE PRO' },
      })
      record('simple_mode_entries', p, id('simple_mode_entries'))
      // Management fees: the company is the holding; company c stands for the subsidiary (only its id is referenced).
      await prisma.managementFeeConvention.create({
        data: { id: id('management_fee_conventions'), companyId, label: 'Convention', costAccountPrefixes: ['6'], excludedAccountPrefixes: ['695'], startDate: day('2026-01-01') },
      })
      record('management_fee_conventions', p, id('management_fee_conventions'))
      await prisma.managementFeeSubsidiary.create({
        data: { id: id('management_fee_subsidiaries'), conventionId: id('management_fee_conventions'), subsidiaryId: COMPANY.c },
      })
      record('management_fee_subsidiaries', p, id('management_fee_subsidiaries'))
      await prisma.managementFeeBilling.create({
        data: {
          id: id('management_fee_billings'),
          companyId,
          conventionId: id('management_fee_conventions'),
          subsidiaryId: COMPANY.c,
          periodStart: day('2026-01-01'),
          periodEnd: day('2026-03-31'),
          amountExclTax: 100,
          vatRateBp: 2000,
          vatAmount: 20,
          amountInclTax: 120,
          details: {},
        },
      })
      record('management_fee_billings', p, id('management_fee_billings'))
      // Provisions, impairments and investment grants (lib/provisions, lib/investment-grants)
      await prisma.provision.create({
        data: { id: id('provisions'), companyId, category: 'RISK_CHARGE', label: 'Litige', justification: 'Assignation reçue', accountCode: '1511', openedOn: day('2026-02-01') },
      })
      record('provisions', p, id('provisions'))
      await prisma.provisionAssessment.create({
        data: { id: id('provision_assessments'), companyId, provisionId: id('provisions'), fiscalYearId: id('fiscal_years'), amount: 1500 },
      })
      record('provision_assessments', p, id('provision_assessments'))
      await prisma.investmentGrant.create({
        data: { id: id('investment_grants'), companyId, label: 'Subvention', amount: 3000, grantedOn: day('2026-03-01'), spreading: 'TENTHS' },
      })
      record('investment_grants', p, id('investment_grants'))
      await prisma.investmentGrantTransfer.create({
        data: { id: id('investment_grant_transfers'), companyId, grantId: id('investment_grants'), fiscalYearId: id('fiscal_years') },
      })
      record('investment_grant_transfers', p, id('investment_grant_transfers'))
      // Approval of the accounts (lib/approval)
      await prisma.accountsApproval.create({
        data: { id: id('accounts_approvals'), companyId, fiscalYearId: id('fiscal_years'), details: {}, approvedOn: day('2026-06-15') },
      })
      record('accounts_approvals', p, id('accounts_approvals'))
    }
    return keys
  })
}
