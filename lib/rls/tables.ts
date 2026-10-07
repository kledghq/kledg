/**
 * Tables of the `public` schema without row level security, each with its
 * reason (docs/rls.md#exempt-tables). Every other table has RLS enabled and
 * the four kledg_rls_* policies of the migration
 * 20261020090000_row_level_security:
 * lib/rls/__tests__/policy-coverage.db.test.ts fails on a table that is in
 * neither group, so a new table needs its policies or an entry here.
 */
export const RLS_EXEMPT_TABLES: Readonly<Record<string, string>> = {
  user: 'Better Auth: read by email at sign-in, before any identity; holds no accounting data',
  session: 'Better Auth: read by its secret token on every request, before the identity is known',
  auth_account: 'Better Auth: credentials, read by user id during sign-in',
  verification: 'Better Auth: password reset and email verification tokens, read by their value',
  apikey: 'Better Auth: API keys, read by their hash to identify the caller',
  jwks: 'Better Auth: signing keys of the OAuth provider, instance wide',
  oauthClient: 'Better Auth OAuth provider: registered assistants, instance wide',
  oauthResource: 'Better Auth OAuth provider: the MCP resource, instance wide',
  oauthClientResource: 'Better Auth OAuth provider: client to resource links',
  oauthRefreshToken: 'Better Auth OAuth provider: read by the token value',
  oauthAccessToken: 'Better Auth OAuth provider: read by the token value',
  oauthConsent: 'Better Auth OAuth provider: consents, read when an assistant authenticates',
  oauthClientAssertion: 'Better Auth OAuth provider: replay protection of client assertions',
  rateLimit: 'Rate limit counters keyed by IP or user, written before authentication',
  update_connection: 'Instance GitHub connection, instance administrators only (checked by the route); no tenant data',
  instance_versions: 'Update history of the instance, instance administrators only (checked by the route); no tenant data',
  _prisma_migrations: 'Migration history, owned by the migration tool',
}

/** Tables whose rows belong to a company through a `companyId` column (or `id` for companies). */
export const COMPANY_TABLES: readonly string[] = [
  'companies',
  'addresses',
  'establishments',
  'shareholders',
  'fiscal_years',
  'accounts',
  'journals',
  'accounting_entries',
  'entry_lines',
  'bank_connections',
  'bank_transactions',
  'transaction_rules',
  'integrations',
  'import_jobs',
  'fixed_assets',
  'fixed_asset_depreciations',
  'tax_regime_history',
  'attachments',
  'balance_sheet_line_configs',
  'income_statement_line_configs',
  'company_onboarding',
  'tiers',
  'invoices',
  'expense_claimants',
  'expense_reports',
  'expense_category_rules',
  'budgets',
  'subscription_decisions',
  'management_fee_conventions',
  'management_fee_billings',
  'provisions',
  'provision_assessments',
  'investment_grants',
  'investment_grant_transfers',
  'accounts_approvals',
  'accounting_methods',
  'accounting_changes',
  'annexe_notes',
  'simple_mode_entries',
  'vat_return_filings',
  'corporate_tax_returns',
  'remuneration_scenarios',
  'local_taxes',
  'declaration_statuses',
  'invoice_number_counters',
  'vat_deduction_years',
  'revenue_account_settings',
  'training_reports',
  'payroll_tax_years',
]

/** Child tables reachable through their parent (EXISTS policies): table -> [parent, foreign key]. */
export const CHILD_TABLES: Readonly<Record<string, readonly [parent: string, foreignKey: string]>> = {
  bank_accounts: ['bank_connections', 'bankConnectionId'],
  bank_transaction_matches: ['bank_accounts', 'bankAccountId'],
  transaction_rule_conditions: ['transaction_rules', 'ruleId'],
  transaction_rule_entry_lines: ['transaction_rules', 'ruleId'],
  transaction_mappings: ['bank_connections', 'bankConnectionId'],
  integration_features: ['integrations', 'integrationId'],
  integration_resources: ['integrations', 'integrationId'],
  integration_sync_logs: ['integrations', 'integrationId'],
  import_mappings: ['import_jobs', 'importJobId'],
  balance_sheet_config_history: ['balance_sheet_line_configs', 'configId'],
  income_statement_config_history: ['income_statement_line_configs', 'configId'],
  invoice_lines: ['invoices', 'invoiceId'],
  invoice_vat_breakdowns: ['invoices', 'invoiceId'],
  invoice_payments: ['invoices', 'invoiceId'],
  expense_lines: ['expense_reports', 'reportId'],
  budget_lines: ['budgets', 'budgetId'],
  budget_line_amounts: ['budget_lines', 'lineId'],
  budget_recurring_items: ['budget_lines', 'lineId'],
  management_fee_subsidiaries: ['management_fee_conventions', 'conventionId'],
}

/** Functions of integrity triggers that must read every row whatever the context (SECURITY DEFINER). */
export const DEFINER_TRIGGER_FUNCTIONS: readonly string[] = [
  'kledg_assert_fiscal_year_open',
  'kledg_lock_closed_year_entries',
  'kledg_lock_closed_year_entry_lines',
  'kledg_lock_closed_fiscal_years',
  'kledg_guard_accounting_entry',
  'kledg_guard_entry_line',
  'kledg_guard_company_delete',
  'kledg_delete_grant_on_consent_delete',
  'kledg_revoke_tokens_on_consent_delete',
  'kledg_narrow_tokens_on_consent_update',
  'kledg_rls_entry_line_company',
  'kledg_rls_bank_transaction_company',
  'kledg_rls_entry_moved',
  'kledg_rls_bank_account_moved',
  'kledg_rls_bank_connection_moved',
  'kledg_lock_closed_year_adjustments',
]

const TABLE_REFERENCE = /\b(?:FROM|JOIN|INTO|UPDATE)\s+((?:"public"\.)?"[^"]+"|[\w.]+|\()/gi

/**
 * Whether a statement reads or writes exempt tables only (no policy applies
 * to it). Every table after FROM, JOIN, INTO or UPDATE must be a quoted
 * exempt table; subqueries (`FROM (`, `JOIN LATERAL (`) are checked through
 * their own FROM. An unquoted or unknown name means no. A statement without
 * any table (`SELECT 1`) qualifies: whatever it calls runs without a
 * context, so a policy it meets returns nothing.
 */
export function touchesOnlyExemptTables(sql: string): boolean {
  for (const match of sql.matchAll(TABLE_REFERENCE)) {
    const reference = match[1]
    // Subqueries are checked through their own FROM; `DO UPDATE SET` names no table.
    if (reference === '(' || ['LATERAL', 'SET'].includes(reference.toUpperCase())) continue
    const quoted = /^(?:"public"\.)?"([^"]+)"$/.exec(reference)
    if (!quoted || !(quoted[1] in RLS_EXEMPT_TABLES) || quoted[1] === '_prisma_migrations') return false
  }
  return true
}
