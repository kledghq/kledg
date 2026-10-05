import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/accounting/entry-guards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/entry-guards')>()),
  assertEntryWritableInFiscalYear: vi.fn(),
}))
vi.mock('@/lib/accounting/fiscal-year-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/accounting/fiscal-year-utils')>()),
  getFiscalYearForDate: vi.fn(),
}))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  // Access control has its own tests; here every company is granted
  companyGuard: () => ({ require: async () => {}, requireFullControl: async () => {}, companyWhere: async () => ({}) }),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { clientIdOf } from '@/lib/mcp/company-access'
import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { assertEntryWritableInFiscalYear } from '@/lib/accounting/entry-guards'
import { getFiscalYearForDate } from '@/lib/accounting/fiscal-year-utils'
import { ConflictError, INTERNAL_ERROR_MESSAGE } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'

type ToolConfig = {
  description?: string
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
  inputSchema?: { shape: Record<string, unknown> }
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>

function fakeServer() {
  const tools = new Map<string, ToolConfig>()
  const handlers = new Map<string, ToolHandler>()
  return {
    tools,
    handlers,
    registerTool: (name: string, config: ToolConfig, handler: ToolHandler) => {
      tools.set(name, config)
      handlers.set(name, handler)
    },
  }
}

/** Full control tools and whether they need the user's approval in Kledg. */
const FULL_CONTROL_TOOLS: Record<string, boolean> = {
  validate_entries: true,
  reverse_entry: true,
  update_draft_entry: false,
  delete_draft_entry: true,
  reconcile_transaction: false,
  unreconcile_transaction: true,
  run_rules: true,
  list_rules: false,
  create_rule: false,
  update_rule: false,
  delete_rule: true,
  list_bank_accounts: false,
  create_bank_account: false,
  sync_bank: false,
  import_statement: true,
  create_account: false,
  create_journal: false,
  create_fixed_asset: false,
  generate_depreciation: true,
  close_fiscal_year: true,
  allocate_result: true,
  export_fec: false,
  list_unlettered_lines: false,
  letter_entry_lines: true,
  unletter_entry_lines: true,
  create_draft_invoice: true,
  manage_accounts: true,
  manage_journals: true,
  manage_fiscal_years: true,
  import_accounting_file: true,
  update_company_settings: true,
  manage_company_records: true,
  manage_statement_layout: true,
  manage_members: true,
  manage_bank_accounts: true,
  bulk_reconcile: true,
  delete_bank_transactions: true,
  duplicate_rule: false,
  sync_bank_data: false,
  upload_receipt: false,
  manage_invoice: true,
  import_qonto_invoices: true,
  delete_tiers: true,
  delete_budget_items: true,
  delete_year_end_items: true,
  manage_expense_report: true,
  manage_expense_settings: true,
  manage_management_fee_convention: true,
  auto_letter_account: true,
  manage_fixed_asset: true,
  manage_depreciation_record: true,
  archive_company: true,
  restore_company: true,
  create_company: true,
}

/** Full control tools acting outside any company (no companyId: the instance policy and a grant of every company). */
const INSTANCE_TOOLS = new Set(['create_company'])

/** Draft-level tools (kledg:write) of lib/mcp/drafts, besides create_draft_entry. */
const DRAFT_TOOLS = [
  'save_vat_deduction_settings',
  'prepare_vat_coefficient_regularisation',
  'save_training_report',
  'save_training_origins',
  'save_payroll_tax',
  'prepare_payroll_tax_entry',
  'create_budget',
  'create_budget_line',
  'update_budget_line',
  'classify_subscription',
  'add_subscription_to_budget',
  'create_provision',
  'record_provision_assessment',
  'create_investment_grant',
  'prepare_year_end_entries',
  'create_draft_expense_report',
  'update_year_end_formalities',
  'manage_accounting_methods',
  'manage_accounting_changes',
  'update_annexe_notes',
  'accept_expense_suggestion',
  'prepare_vat_settlement',
  'prepare_corporate_tax_entry',
  'mark_declaration',
  'accept_all_expense_suggestions',
  'manage_tiers',
  'duplicate_entry',
  'update_draft_invoice',
  'update_provision',
  'update_investment_grant',
  'update_draft_expense_report',
  'reclassify_doubtful_receivable',
  'save_local_taxes',
  'prepare_cfe_entry',
  'save_corporate_tax_inputs',
  'save_remuneration_scenario',
  'record_tax_filing',
  'save_depreciation_record',
  'prepare_opening_balances',
]

const user = { id: 'u1', email: 'a@b.c', name: null, role: 'user' }
const caller = { kind: 'apiKey' as const, apiKeyId: 'k1' }

describe('registerKledgTools', () => {
  it('registers read tools as read-only', () => {
    const server = fakeServer()
    registerKledgTools(server as never, { user, canWrite: false, canAdmin: false, caller, executionMode: 'validation' })
    expect([...server.tools.keys()]).toContain('list_companies')
    for (const [name, config] of server.tools) {
      expect(config.annotations?.readOnlyHint, name).toBe(true)
    }
  })

  it('registers full control tools only with kledg:admin', () => {
    const writer = fakeServer()
    registerKledgTools(writer as never, { user, canWrite: true, canAdmin: false, caller, executionMode: 'validation' })
    for (const name of Object.keys(FULL_CONTROL_TOOLS)) expect(writer.tools.has(name), name).toBe(false)

    const admin = fakeServer()
    registerKledgTools(admin as never, { user, canWrite: true, canAdmin: true, caller, executionMode: 'validation' })
    const added = [...admin.tools.keys()].filter((name) => !writer.tools.has(name)).sort()
    expect(added).toEqual(Object.keys(FULL_CONTROL_TOOLS).sort())
  })

  it('describes full control and, in validation mode, has high-impact tools approved by the user in Kledg', () => {
    const admin = fakeServer()
    registerKledgTools(admin as never, { user, canWrite: true, canAdmin: true, caller, executionMode: 'validation' })
    for (const [name, twoStep] of Object.entries(FULL_CONTROL_TOOLS)) {
      const config = admin.tools.get(name)!
      expect(config.description, name).toContain('acts as the user')
      if (INSTANCE_TOOLS.has(name)) expect(config.inputSchema?.shape, name).not.toHaveProperty('companyId')
      else expect(config.inputSchema?.shape, name).toHaveProperty('companyId')
      if (twoStep) {
        expect(config.description, name).toContain('approves or refuses the action in Kledg')
        expect(config.inputSchema?.shape, name).toHaveProperty('actionId')
        expect(config.inputSchema?.shape, name).not.toHaveProperty('dryRun')
        // No input lets the assistant confirm by itself.
        expect(config.inputSchema?.shape, name).not.toHaveProperty('confirm')
        expect(config.inputSchema?.shape, name).not.toHaveProperty('confirmationToken')
      } else {
        expect(config.inputSchema?.shape, name).not.toHaveProperty('actionId')
      }
    }
  })

  it('in automatic mode, runs high-impact tools at once with an optional dry run', () => {
    const admin = fakeServer()
    registerKledgTools(admin as never, { user, canWrite: true, canAdmin: true, caller, executionMode: 'automatic' })
    for (const [name, twoStep] of Object.entries(FULL_CONTROL_TOOLS)) {
      const config = admin.tools.get(name)!
      expect(config.inputSchema?.shape, name).not.toHaveProperty('actionId')
      expect(config.description, name).not.toContain('approvalUrl')
      if (twoStep) {
        expect(config.description, name).toContain('mode automatique')
        expect(config.inputSchema?.shape, name).toHaveProperty('dryRun')
        // The dry run is optional: an empty call shape executes.
        expect((config.inputSchema?.shape.dryRun as { safeParse: (v: unknown) => { success: boolean } }).safeParse(undefined).success, name).toBe(true)
      } else {
        expect(config.inputSchema?.shape, name).not.toHaveProperty('dryRun')
      }
    }
  })

  it('only exposes create_draft_entry and the draft tools with write access', () => {
    const readOnly = fakeServer()
    registerKledgTools(readOnly as never, { user, canWrite: false, canAdmin: false, caller, executionMode: 'validation' })
    for (const name of ['create_draft_entry', ...DRAFT_TOOLS]) expect(readOnly.tools.has(name), name).toBe(false)

    const writer = fakeServer()
    registerKledgTools(writer as never, { user, canWrite: true, canAdmin: false, caller, executionMode: 'validation' })
    const added = [...writer.tools.keys()].filter((name) => !readOnly.tools.has(name)).sort()
    expect(added).toEqual(['create_draft_entry', ...DRAFT_TOOLS].sort())
    for (const name of added) {
      expect(writer.tools.get(name)?.annotations?.readOnlyHint, name).toBe(false)
      expect(writer.tools.get(name)?.description, name).toContain('kledg:write')
      // Draft tools never follow the full control flow.
      expect(writer.tools.get(name)?.inputSchema?.shape, name).not.toHaveProperty('actionId')
    }
  })
})

describe('create_draft_entry errors', () => {
  const db = asPrismaMock(prisma)
  const args = {
    companyId: 'company-1',
    journalCode: 'OD',
    date: '2026-03-10',
    description: 'Régularisation',
    lines: [
      { accountCode: '606100', debit: 10, credit: 0 },
      { accountCode: '401000', debit: 0, credit: 10 },
    ],
  }

  async function createDraft(): Promise<ToolResult> {
    const server = fakeServer()
    registerKledgTools(server as never, { user, canWrite: true, canAdmin: false, caller, executionMode: 'validation' })
    vi.mocked(getFiscalYearForDate).mockResolvedValue({ id: 'fy-1', year: 2026 })
    db.fiscalYear.findUnique.mockResolvedValue({ id: 'fy-1', year: 2026, isClosed: false })
    return server.handlers.get('create_draft_entry')!(args)
  }

  it('never returns the message of an unexpected error to the client', async () => {
    vi.mocked(assertEntryWritableInFiscalYear).mockImplementation(() => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432 (user kledg)')
    })
    const result = await createDraft()
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe(INTERNAL_ERROR_MESSAGE)
    expect(result.content[0].text).not.toContain('ECONNREFUSED')
  })

  it('keeps the French message of a typed refusal', async () => {
    const closed = "L'exercice 2026 est clôturé : ses écritures ne peuvent plus être créées, modifiées ni supprimées."
    vi.mocked(assertEntryWritableInFiscalYear).mockImplementation(() => {
      throw new ConflictError(closed)
    })
    const result = await createDraft()
    expect(result).toEqual({ content: [{ type: 'text', text: closed }], isError: true })
  })
})

describe('company access in MCP tools', () => {
  // Every tool checks companies through companyGuard (lib/mcp/company-access.ts),
  // which applies the connection's company grant before the user's role.
  const source = readFileSync(path.resolve(__dirname, '../tools.ts'), 'utf8')

  it('never checks access ad hoc, bypassing the company grant', () => {
    for (const bypass of ['requireCompanyPermission', 'requireCompanyAccess', 'getUserRolesForCompany', 'isGlobalAdmin', 'members: { some']) {
      expect(source, bypass).not.toContain(bypass)
    }
  })

  it('guards every tool that takes a company', () => {
    const tools = source.split('server.registerTool(').slice(1)
    expect(tools.length).toBe(15)
    for (const tool of tools) {
      const name = /'([a-z_]+)'/.exec(tool)?.[1]
      if (name === 'list_companies') {
        expect(tool, name).toContain('await guard.companyWhere(')
      } else {
        expect(tool, name).toMatch(/await guard\.require\((args\.)?companyId,/)
      }
    }
  })
})

describe('full control tools', () => {
  // Every full control tool is declared with fullControlTool() and registered
  // through registerFullControlTool (define.ts), which checks
  // guard.requireFullControl before any preview or action.
  const dir = path.resolve(__dirname, '../full-control')
  const toolFiles = ['entries.ts', 'banking.ts', 'ledger.ts', 'year-end.ts', 'lettering.ts', 'invoices.ts', 'chart.ts', 'settings.ts', 'bank-admin.ts', 'records.ts', 'companies.ts']
  const define = readFileSync(path.join(dir, 'define.ts'), 'utf8')

  it('checks full control first, in the single registration path', () => {
    const handler = define.slice(define.indexOf('server.registerTool('))
    const guardAt = handler.indexOf('await guard.requireFullControl(companyId, tool.permission)')
    expect(guardAt).toBeGreaterThan(0)
    for (const step of ['tool.preview(', 'tool.execute(', 'claimApprovedAction(', 'createPendingAction(']) {
      expect(handler.indexOf(step), step).toBeGreaterThan(guardAt)
    }
    // Two registration paths: company tools, and the tools outside any company (create_company).
    expect(define.split('server.registerTool(').length).toBe(3)
    const instance = define.slice(define.indexOf('export function registerInstanceTool'))
    const fullControl = instance.indexOf('if (!access.canAdmin) throw new ForbiddenError(FULL_CONTROL_REQUIRED_MESSAGE)')
    const everyCompany = instance.indexOf('if ((await guard.companyIds()) !== null) throw new ForbiddenError(ALL_COMPANIES_REQUIRED_MESSAGE)')
    expect(fullControl).toBeGreaterThan(0)
    expect(everyCompany).toBeGreaterThan(fullControl)
    for (const step of ['tool.preview(', 'tool.execute(', 'highImpactCall(']) {
      expect(instance.indexOf(step), step).toBeGreaterThan(everyCompany)
    }
  })

  it('declares every tool through fullControlTool and never registers or checks access ad hoc', () => {
    let declared = 0
    for (const file of toolFiles) {
      const source = readFileSync(path.join(dir, file), 'utf8')
      expect(source, file).not.toContain('server.registerTool(')
      for (const bypass of ['requireCompanyPermission', 'requireCompanyAccess', 'getUserRolesForCompany', 'isGlobalAdmin', 'guard.require(']) {
        expect(source, `${file}: ${bypass}`).not.toContain(bypass)
      }
      declared += source.split('fullControlTool({').length - 1
      // Tools outside any company are registered by index.ts through registerInstanceTool.
      declared += source.split('instanceTool({').length - 1
      // Each declared tool is registered
      const registered = source.split('  register(').length - 1
      expect(registered, file).toBe(source.split('fullControlTool({').length - 1)
    }
    expect(declared).toBe(Object.keys(FULL_CONTROL_TOOLS).length)
  })
})

describe('draft tools', () => {
  // Every draft tool is declared with draftTool() and registered through
  // registerDraftTool (drafts/define.ts), which parses the arguments, then
  // checks every right of the tool through the company guard before the
  // service runs.
  const dir = path.resolve(__dirname, '../drafts')
  const toolFiles = ['budgets.ts', 'year-end.ts', 'expense-reports.ts', 'approval.ts', 'simple-mode.ts', 'vat-returns.ts', 'corporate-tax.ts', 'declarations.ts', 'records.ts', 'remuneration.ts', 'annexe.ts', 'training.ts']
  const define = readFileSync(path.join(dir, 'define.ts'), 'utf8')

  it('checks the company guard first, in the single registration path', () => {
    const handler = define.slice(define.indexOf('server.registerTool('))
    const guardAt = handler.indexOf('for (const permission of permissions) await guard.require(args.companyId, permission)')
    expect(guardAt).toBeGreaterThan(0)
    expect(handler.indexOf('parseInput(inputSchema, raw)')).toBeLessThan(guardAt)
    expect(handler.indexOf('tool.execute(')).toBeGreaterThan(guardAt)
    expect(define.split('server.registerTool(').length).toBe(2)
  })

  it('declares every tool through draftTool and never registers or checks access ad hoc', () => {
    let declared = 0
    for (const file of toolFiles) {
      const source = readFileSync(path.join(dir, file), 'utf8')
      expect(source, file).not.toContain('server.registerTool(')
      for (const bypass of ['requireCompanyPermission', 'requireCompanyAccess', 'getUserRolesForCompany', 'isGlobalAdmin', 'guard.require(', 'validateEntries', 'postInvoice', 'postExpenseReport']) {
        expect(source, `${file}: ${bypass}`).not.toContain(bypass)
      }
      const count = source.split('draftTool({').length - 1
      declared += count
      expect(source.split('  register(').length - 1, file).toBe(count)
    }
    expect(declared).toBe(DRAFT_TOOLS.length)
  })
})

describe('clientIdOf', () => {
  it('reads the OAuth client of a Better Auth access token', () => {
    expect(clientIdOf({ client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', azp: 'x' })).toBe(
      'https://claude.ai/oauth/mcp-oauth-client-metadata',
    )
    expect(clientIdOf({ azp: 'dcr-client' })).toBe('dcr-client')
    expect(clientIdOf({ sub: 'u1' })).toBeNull()
    expect(clientIdOf({ client_id: '' })).toBeNull()
  })
})
