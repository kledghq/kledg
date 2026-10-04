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
}

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
      expect(config.inputSchema?.shape, name).toHaveProperty('companyId')
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

  it('only exposes create_draft_entry with write access', () => {
    const readOnly = fakeServer()
    registerKledgTools(readOnly as never, { user, canWrite: false, canAdmin: false, caller, executionMode: 'validation' })
    expect(readOnly.tools.has('create_draft_entry')).toBe(false)

    const writer = fakeServer()
    registerKledgTools(writer as never, { user, canWrite: true, canAdmin: false, caller, executionMode: 'validation' })
    expect(writer.tools.has('create_draft_entry')).toBe(true)
    expect(writer.tools.get('create_draft_entry')?.annotations?.readOnlyHint).toBe(false)
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
    expect(tools.length).toBe(10)
    for (const tool of tools) {
      const name = /'([a-z_]+)'/.exec(tool)?.[1]
      if (name === 'list_companies') {
        expect(tool, name).toContain('await guard.companyWhere()')
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
  const toolFiles = ['entries.ts', 'banking.ts', 'ledger.ts', 'year-end.ts']
  const define = readFileSync(path.join(dir, 'define.ts'), 'utf8')

  it('checks full control first, in the single registration path', () => {
    const handler = define.slice(define.indexOf('server.registerTool('))
    const guardAt = handler.indexOf('await guard.requireFullControl(companyId, tool.permission)')
    expect(guardAt).toBeGreaterThan(0)
    for (const step of ['tool.preview(', 'tool.execute(', 'claimApprovedAction(', 'createPendingAction(']) {
      expect(handler.indexOf(step), step).toBeGreaterThan(guardAt)
    }
    expect(define.split('server.registerTool(').length).toBe(2)
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
      // Each declared tool is registered
      const registered = source.split('  register(').length - 1
      expect(registered, file).toBe(source.split('fullControlTool({').length - 1)
    }
    expect(declared).toBe(Object.keys(FULL_CONTROL_TOOLS).length)
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
