/**
 * MCP tools of the annexe (lib/mcp/annexe-tools.ts, lib/mcp/drafts/annexe.ts):
 * get_annexe and get_fixed_asset_movements read with reports:read, amounts
 * in euros with the box codes of the forms; manage_accounting_methods,
 * manage_accounting_changes and update_annexe_notes only with kledg:write,
 * with the rights of the matching routes, euros converted to cents, drafts
 * only. The services are mocked (annexe-routes.db.test.ts covers them on
 * PostgreSQL); the reports are built by the real pure modules.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/annexe/get-annexe.service', () => ({ getAnnexe: vi.fn() }))
vi.mock('@/lib/annexe/save-annexe-notes.service', () => ({ saveAnnexeNotes: vi.fn() }))
vi.mock('@/lib/annexe/get-fixed-asset-movements.service', () => ({ getFixedAssetMovements: vi.fn() }))
vi.mock('@/lib/annexe/methods/manage-accounting-methods.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/annexe/methods/manage-accounting-methods.service')>()),
  getAccountingRegister: vi.fn(),
  createAccountingMethod: vi.fn(),
  updateAccountingMethod: vi.fn(),
  deleteAccountingMethod: vi.fn(),
  createAccountingChange: vi.fn(),
  updateAccountingChange: vi.fn(),
  deleteAccountingChange: vi.fn(),
  prepareAccountingChangeEntry: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { getAnnexe } from '@/lib/annexe/get-annexe.service'
import { saveAnnexeNotes } from '@/lib/annexe/save-annexe-notes.service'
import { getFixedAssetMovements } from '@/lib/annexe/get-fixed-asset-movements.service'
import { buildFixedAssetReport } from '@/lib/annexe/fixed-asset-report'
import { emptyAnnexeDetails } from '@/lib/annexe/schemas'
import {
  createAccountingChange,
  createAccountingMethod,
  deleteAccountingMethod,
  getAccountingRegister,
  prepareAccountingChangeEntry,
} from '@/lib/annexe/methods/manage-accounting-methods.service'
import { ForbiddenError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'
import type { AnnexeView } from '@/lib/annexe/get-annexe.service'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tools(canWrite = true) {
  const handlers = new Map<string, Handler>()
  registerKledgTools(
    { registerTool: (name: string, _config: unknown, handler: Handler) => handlers.set(name, handler) } as never,
    { user: { id: 'u1', email: 'a@b.c', name: 'Camille', role: 'user' }, canWrite, canAdmin: false, caller: { kind: 'apiKey', apiKeyId: 'k1' }, executionMode: 'validation' },
  )
  return handlers
}

const parse = (result: ToolResult) => {
  expect(result.isError, result.content[0].text).toBeFalsy()
  return JSON.parse(result.content[0].text)
}

const VIEW: AnnexeView = {
  company: { name: 'Atelier Lumen', siren: '111111111' },
  fiscalYear: { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: true },
  annexe: {
    list: 'small',
    listLabel: 'Petite entreprise : annexe simplifiée',
    listSource: 'C. com. art. L123-16, PCG art. 811-9',
    required: true,
    category: 'small',
    categoryLabel: 'Petite entreprise',
    categoryConfirmed: true,
    notes: [{ id: 'rules', title: 'Règles et méthodes comptables', source: 'PCG art. 831-1', blocks: [{ kind: 'paragraph', text: 'Règlement ANC n° 2014-03' }, { kind: 'table', columns: ['Sujet', 'Méthode'], rows: [['Stocks', 'CMUP']] }] }],
    missing: [{ id: 'commitments', label: 'Engagements hors bilan', source: 'PCG art. 836-1 à 836-5' }],
    warnings: [],
  },
  details: emptyAnnexeDetails(),
  saved: null,
}

beforeEach(() => vi.clearAllMocks())

describe('read tools', () => {
  it('get_annexe checks reports:read and returns the notes, what is missing and the register', async () => {
    vi.mocked(getAnnexe).mockResolvedValue(VIEW)
    vi.mocked(getAccountingRegister).mockResolvedValue({
      methods: [],
      changes: [{ id: 'ch', fiscalYearId: 'fy', fiscalYear: 2026, kind: 'METHOD_CHANGE', treatment: 'EQUITY', method: null, label: 'CMUP', description: 'x', impactCents: 100_000, taxEffectCents: 25_000, netImpactCents: 75_000, accountCode: '310000', entryDate: null, entry: null, entryExpected: true }],
    })
    const data = parse(await tools(false).get('get_annexe')!({ companyId: 'c1', fiscalYearId: 'fy' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(data.annexe).toMatchObject({ list: 'small', required: true })
    expect(data.notes[0]).toEqual({ id: 'rules', title: 'Règles et méthodes comptables', source: 'PCG art. 831-1', content: ['Règlement ANC n° 2014-03', { columns: ['Sujet', 'Méthode'], rows: [['Stocks', 'CMUP']] }] })
    expect(data.missing).toEqual([{ id: 'commitments', label: 'Engagements hors bilan', source: 'PCG art. 836-1 à 836-5' }])
    expect(data.changes[0]).toMatchObject({ impactBeforeTax: 1000, taxEffect: 250, impactAfterTax: 750 })
  })

  it('get_fixed_asset_movements returns each line with its box codes, in euros', async () => {
    vi.mocked(getFixedAssetMovements).mockResolvedValue(
      buildFixedAssetReport({
        fiscalYear: { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
        lines: [{ entryId: 'e', reversalOfId: null, opening: false, code: '218200', debitCents: 2_000_000, creditCents: 0 }],
        impairmentCents: 0,
        balanceSheet: { grossCents: 2_000_000, depreciationCents: 0 },
        register: [],
        draftEntries: 0,
      }),
    )
    const data = parse(await tools(false).get('get_fixed_asset_movements')!({ companyId: 'c1', fiscalYearId: 'fy' }))
    const transport = data.form2054.find((r: { line: string }) => r.line === 'Matériel de transport')
    expect(transport.boxes.increase).toEqual({ box: 'LA', amount: 20000 })
    expect(transport.boxes.origin).toEqual({ box: 'MR', amount: null })
    expect(data.checks[0]).toMatchObject({ books: 20000, other: 20000, ok: true })
  })

  it('refuses without the right, like the route', async () => {
    guard.require.mockRejectedValueOnce(new ForbiddenError('Action non autorisée'))
    const result = await tools(false).get('get_annexe')!({ companyId: 'c1', fiscalYearId: 'fy' })
    expect(result.isError).toBe(true)
    expect(getAnnexe).not.toHaveBeenCalled()
  })
})

describe('draft tools', () => {
  it('are absent from a read-only connection', () => {
    const readOnly = tools(false)
    for (const name of ['manage_accounting_methods', 'manage_accounting_changes', 'update_annexe_notes']) expect(readOnly.has(name), name).toBe(false)
  })

  it('manage_accounting_methods creates with entries:create and deletes with entries:delete', async () => {
    vi.mocked(createAccountingMethod).mockResolvedValue({ id: 'm1', topic: 'inventory_valuation', label: 'CMUP', description: 'Coût moyen', adoptedOn: null, referenceMethod: false })
    const created = parse(await tools().get('manage_accounting_methods')!({ companyId: 'c1', action: 'create', topic: 'inventory_valuation', label: 'CMUP', description: 'Coût moyen' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['create'] })
    expect(created.changes.created.id).toBe('m1')
    expect(created.reviewUrl).toMatch(/\/c1\/accounting-methods$/)
    parse(await tools().get('manage_accounting_methods')!({ companyId: 'c1', action: 'delete', methodId: 'm1' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['delete'] })
    expect(deleteAccountingMethod).toHaveBeenCalledWith('c1', 'm1')
    const missing = await tools().get('manage_accounting_methods')!({ companyId: 'c1', action: 'create', topic: 'inventory_valuation' })
    expect(missing.isError).toBe(true)
  })

  it('manage_accounting_changes converts euros to cents and prepares the entry as a draft', async () => {
    vi.mocked(createAccountingChange).mockResolvedValue({ id: 'ch', fiscalYearId: 'fy', fiscalYear: 2026, kind: 'ERROR_CORRECTION', treatment: 'RESULT', method: null, label: 'Facture omise', description: 'x', impactCents: -30_000, taxEffectCents: 0, netImpactCents: -30_000, accountCode: '408000', entryDate: null, entry: null, entryExpected: true })
    const created = parse(await tools().get('manage_accounting_changes')!({ companyId: 'c1', action: 'create', fiscalYearId: 'fy', kind: 'ERROR_CORRECTION', label: 'Facture omise', description: 'x', impact: -300, accountCode: '408000' }))
    expect(createAccountingChange).toHaveBeenCalledWith('c1', expect.objectContaining({ kind: 'ERROR_CORRECTION', impactCents: -30_000, accountCode: '408000' }))
    expect(created.changes.created).toMatchObject({ id: 'ch', impactAfterTax: -300, entryExpected: true })

    vi.mocked(prepareAccountingChangeEntry).mockResolvedValue({ outcome: 'created', change: { entry: { id: 'e1', entryNumber: 'BR-1', status: 'draft' } } as never })
    const prepared = parse(await tools().get('manage_accounting_changes')!({ companyId: 'c1', action: 'prepare_entry', changeId: 'ch' }))
    expect(prepared.changes).toEqual({ outcome: 'created', entry: { id: 'e1', entryNumber: 'BR-1', status: 'draft' } })
    expect(prepared.message).toMatch(/brouillon/)
    const noId = await tools().get('manage_accounting_changes')!({ companyId: 'c1', action: 'delete' })
    expect(noId.content[0].text).toMatch(/changeId est requis/)
  })

  it('update_annexe_notes merges the answers given, in cents, with closing:execute', async () => {
    vi.mocked(getAnnexe).mockResolvedValue(VIEW)
    const data = parse(
      await tools().get('update_annexe_notes')!({
        companyId: 'c1',
        fiscalYearId: 'fy',
        commitments: { items: [{ kind: 'leasing', description: 'Véhicule', amount: 12000, residual: 1000 }] },
        postClosingEvents: { none: true },
        debtsOverOneYear: 6000,
      }),
    )
    expect(guard.require).toHaveBeenCalledWith('c1', { closing: ['execute'] })
    expect(saveAnnexeNotes).toHaveBeenCalledWith(
      'c1',
      'fy',
      expect.objectContaining({
        commitments: { none: false, items: [{ kind: 'leasing', description: 'Véhicule', amountCents: 1_200_000, residualCents: 100_000 }] },
        postClosingEvents: { none: true, text: null },
        debtMaturities: { overOneYearCents: 600_000, overFiveYearsCents: 0 },
        derogations: null,
      }),
      'u1',
    )
    expect(data.changes.fields).toEqual(['postClosingEvents', 'commitments', 'debtMaturities'])
    expect(data.missing).toEqual(VIEW.annexe.missing)
  })
})
