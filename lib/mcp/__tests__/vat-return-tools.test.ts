/**
 * MCP tools of the VAT returns (lib/mcp/vat-return-tools.ts,
 * lib/mcp/drafts/vat-returns.ts): get_vat_return reads the worksheet with
 * reports:read at every level, amounts of the books in euros and the form
 * amounts in whole euros; prepare_vat_settlement exists only with
 * kledg:write, checks entries:create and prepares a draft. Services are
 * mocked (lib/vat-returns/__tests__/vat-returns.db.test.ts runs them on
 * PostgreSQL). Kledg never files a return.
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
vi.mock('@/lib/vat-returns/load-vat-return.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vat-returns/load-vat-return.service')>()),
  loadVatReturn: vi.fn(),
}))
vi.mock('@/lib/vat-returns/prepare-vat-settlement.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vat-returns/prepare-vat-settlement.service')>()),
  prepareVatSettlement: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { loadVatReturn, type VatReturnView } from '@/lib/vat-returns/load-vat-return.service'
import { prepareVatSettlement } from '@/lib/vat-returns/prepare-vat-settlement.service'
import { writeAuditLog } from '@/lib/audit'
import type { ToolResult } from '@/lib/mcp/tool-result'

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>

function tools(canWrite: boolean) {
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

const VIEW = {
  today: '2026-10-05',
  status: 'ready',
  periods: [{ id: '2026-09', label: 'septembre 2026', form: 'CA3', start: '2026-09-01', end: '2026-09-30', filed: false }],
  period: { id: '2026-09', form: 'CA3', frequency: 'monthly', start: '2026-09-01', end: '2026-09-30', label: 'septembre 2026' },
  formTitle: 'Déclaration 3310-CA3-SD (régime réel normal)',
  deadline: { date: '2026-10-21', legalDate: '2026-10-21', estimated: false, label: 'Déclaration et paiement de la TVA de septembre 2026' },
  computation: {
    form: 'CA3',
    lines: [{ code: '08', box: '0207', label: 'Taux normal 20 %', columns: 'base-tax', baseCents: 100_040, amountCents: 20_008, base: 1_000, amount: 200, status: 'computed', hint: 'Base et TVA' }],
    result: { kind: 'due', dueEuros: 200, creditEuros: 0, booksNetCents: 20_008 },
    acomptes: null,
  },
  checks: [{ id: 'drafts', severity: 'ok', title: 'Aucune écriture en brouillon sur la période', detail: 'Toutes validées.' }],
  reliable: true,
  movements: { entries: 3, pendingCollectedCents: 0, unidentified: [], unhandled: [] },
  settlement: { reference: 'TVA-CA3-2026-09', status: 'none', entryId: null, entryNumber: null },
  filing: null,
  notFromTheBooks: ['Les opérations qui ne sont pas comptabilisées dans Kledg.'],
  sources: [{ label: 'Notice 3310-NOT-CA3-SD (n° 50449#29)', url: 'https://www.impots.gouv.fr' }],
} as unknown as VatReturnView

beforeEach(() => vi.clearAllMocks())

describe('get_vat_return', () => {
  it('checks reports:read and answers the form lines, the result and the checks, books amounts in euros', async () => {
    vi.mocked(loadVatReturn).mockResolvedValue(VIEW)
    const data = parse(await tools(false).get('get_vat_return')!({ companyId: 'c1', period: '2026-09' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(loadVatReturn).toHaveBeenCalledWith('c1', { period: '2026-09' })
    expect(data.result).toEqual({ kind: 'due', due: 200, credit: 0, booksNet: 200.08 })
    expect(data.lines[0]).toEqual({ code: '08', box: '0207', label: 'Taux normal 20 %', base: 1_000, amount: 200, booksBase: 1_000.4, booksAmount: 200.08, source: 'computed', hint: 'Base et TVA' })
    expect(data.reliable).toBe(true)
    expect(data.toFillByHand).toHaveLength(1)
    expect(data.reviewUrl).toMatch(/\/c1\/declarations-tva\?periode=2026-09$/)
  })

  it('refuses a malformed period in French', async () => {
    const result = await tools(false).get('get_vat_return')!({ companyId: 'c1', period: 'septembre' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Période invalide')
    expect(loadVatReturn).not.toHaveBeenCalled()
  })
})

describe('prepare_vat_settlement', () => {
  it('is absent from a read-only connection', () => {
    expect(tools(false).has('prepare_vat_settlement')).toBe(false)
  })

  it('checks entries:create, prepares a draft and links to it', async () => {
    vi.mocked(prepareVatSettlement).mockResolvedValue({
      status: 'created',
      reference: 'TVA-CA3-2026-09',
      entryId: 'e1',
      entryNumber: 'BR-12',
      lines: [
        { code: '445710', label: 'TVA collectée', debitCents: 20_008, creditCents: 0 },
        { code: '445510', label: 'TVA à décaisser', debitCents: 0, creditCents: 20_000 },
        { code: '758', label: 'Indemnités et autres produits', debitCents: 0, creditCents: 8 },
      ],
      message: 'Écriture de liquidation préparée en brouillon (BR-12).',
    })
    const data = parse(await tools(true).get('prepare_vat_settlement')!({ companyId: 'c1', period: '2026-09' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['create'] })
    expect(prepareVatSettlement).toHaveBeenCalledWith('c1', '2026-09', { source: 'mcp' })
    expect(data.lines[0]).toEqual({ account: '445710', label: 'TVA collectée', debit: 200.08, credit: 0 })
    expect(data.changes).toEqual({ status: 'created', entryId: 'e1', entryNumber: 'BR-12', reference: 'TVA-CA3-2026-09' })
    expect(data.reviewUrl).toMatch(/\/c1\/entries\/e1$/)
    expect(writeAuditLog).toHaveBeenCalledWith('info', expect.stringContaining('prepare_vat_settlement'), expect.objectContaining({ action: 'MCP_WRITE' }))
  })

  it('writes no audit entry when nothing changed', async () => {
    vi.mocked(prepareVatSettlement).mockResolvedValue({ status: 'unchanged', reference: 'TVA-CA3-2026-09', entryId: 'e1', entryNumber: 'BR-12', lines: [], message: 'Déjà à jour.' })
    parse(await tools(true).get('prepare_vat_settlement')!({ companyId: 'c1', period: '2026-09' }))
    expect(writeAuditLog).not.toHaveBeenCalled()
  })
})
