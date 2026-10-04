/**
 * Draft-level MCP tools of the year-end work and of the approval of the
 * accounts (lib/mcp/drafts/year-end.ts, lib/mcp/drafts/approval.ts): only
 * with kledg:write, the rights of the API routes (entries:create for
 * provisions, grants and year-end drafts, closing:execute for the approval
 * data), euros converted to cents, French validation errors, drafts only,
 * what changed and the link to review it. Services are mocked (their own
 * database tests cover them; draft-tools.db.test.ts calls these tools on
 * PostgreSQL).
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
vi.mock('@/lib/provisions/manage-provisions.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/provisions/manage-provisions.service')>()),
  createProvision: vi.fn(),
  saveAssessment: vi.fn(),
}))
vi.mock('@/lib/investment-grants/manage-investment-grants.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/investment-grants/manage-investment-grants.service')>()),
  createInvestmentGrant: vi.fn(),
}))
vi.mock('@/lib/year-end/prepare-year-end-entries.service', () => ({ prepareYearEndEntries: vi.fn() }))
vi.mock('@/lib/approval/get-approval.service', () => ({ getApproval: vi.fn() }))
vi.mock('@/lib/approval/save-approval.service', () => ({ saveApproval: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { createProvision, saveAssessment } from '@/lib/provisions/manage-provisions.service'
import { createInvestmentGrant } from '@/lib/investment-grants/manage-investment-grants.service'
import { prepareYearEndEntries } from '@/lib/year-end/prepare-year-end-entries.service'
import { getApproval } from '@/lib/approval/get-approval.service'
import { saveApproval } from '@/lib/approval/save-approval.service'
import { emptyDetails } from '@/lib/approval/schemas'
import { ClosedFiscalYearError, ForbiddenError, ValidationError } from '@/lib/accounting/errors'
import type { ToolResult } from '@/lib/mcp/tool-result'

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

beforeEach(() => vi.clearAllMocks())

describe('draft year-end tools', () => {
  it('are absent from a read-only connection', () => {
    const readOnly = tools(false)
    for (const name of ['create_provision', 'record_provision_assessment', 'create_investment_grant', 'prepare_year_end_entries', 'update_year_end_formalities']) {
      expect(readOnly.has(name), name).toBe(false)
    }
  })

  it('create_provision checks entries:create and passes the balance already booked in cents', async () => {
    vi.mocked(createProvision).mockResolvedValue({ id: 'p1', label: 'Litige Martin', category: 'RISK_CHARGE', accountCode: '151', nature: 'OPERATING', taxDeductible: true, reversible: true } as never)
    const data = parse(
      await tools().get('create_provision')!({
        companyId: 'c1',
        category: 'RISK_CHARGE',
        label: 'Litige Martin',
        justification: 'Assignation prud’homale, estimation de l’avocat',
        accountCode: '1511',
        openedOn: '2026-05-02',
        alreadyBooked: 1500.25,
      }),
    )
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['create'] })
    expect(createProvision).toHaveBeenCalledWith('c1', expect.objectContaining({ category: 'RISK_CHARGE', accountCode: '1511', openedOn: '2026-05-02', carriedCents: 150_025, fixedAssetId: null }))
    expect(data).toMatchObject({ provisionId: 'p1', changes: { provisionCreated: 'p1', account: '151' } })
    expect(data.reviewUrl).toMatch(/\/c1\/provisions$/)
  })

  it('create_provision refuses a missing justification and a bad date in French', async () => {
    const result = await tools().get('create_provision')!({ companyId: 'c1', category: 'RISK_CHARGE', label: 'X', justification: '', accountCode: '151', openedOn: '02/05/2026' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/justification/)
    expect(result.content[0].text).toMatch(/Date attendue au format AAAA-MM-JJ/)
    expect(createProvision).not.toHaveBeenCalled()
  })

  it('record_provision_assessment takes exactly one of the required balance and the current value', async () => {
    vi.mocked(saveAssessment).mockResolvedValue({ provisionId: 'p1', fiscalYearId: 'fy', amountCents: 800_000, currentValueCents: null })
    const data = parse(await tools().get('record_provision_assessment')!({ companyId: 'c1', provisionId: 'p1', fiscalYearId: 'fy', requiredBalance: 8000, basis: 'Avocat' }))
    expect(saveAssessment).toHaveBeenCalledWith('c1', 'p1', { fiscalYearId: 'fy', amountCents: 800_000, basis: 'Avocat' })
    expect(data.changes).toEqual({ provisionId: 'p1', fiscalYearId: 'fy', requiredBalance: 8000, currentValue: null })
    expect(data.reviewUrl).toMatch(/\/c1\/year-end$/)

    const both = await tools().get('record_provision_assessment')!({ companyId: 'c1', provisionId: 'p1', fiscalYearId: 'fy', requiredBalance: 1, currentValue: 2 })
    expect(both).toEqual({ content: [{ type: 'text', text: "Indiquez soit le montant requis, soit la valeur actuelle de l'immobilisation" }], isError: true })
    expect(saveAssessment).toHaveBeenCalledTimes(1)
  })

  it('record_provision_assessment keeps the refusal of a closed fiscal year', async () => {
    vi.mocked(saveAssessment).mockRejectedValue(new ClosedFiscalYearError(2025))
    const result = await tools().get('record_provision_assessment')!({ companyId: 'c1', provisionId: 'p1', fiscalYearId: 'fy', requiredBalance: 10 })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/2025/)
  })

  it('create_investment_grant converts the amount to cents and answers the accounts', async () => {
    vi.mocked(createInvestmentGrant).mockResolvedValue({ id: 'g1', label: 'Région', amount: { toString: () => '12000.00' }, spreading: 'LINEAR', accountCode: '131', transferAccountCode: '139', incomeAccountCode: '747' } as never)
    const data = parse(await tools().get('create_investment_grant')!({ companyId: 'c1', label: 'Région', amount: 12000, grantedOn: '2026-03-01', spreading: 'LINEAR', durationYears: 5 }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['create'] })
    expect(createInvestmentGrant).toHaveBeenCalledWith('c1', expect.objectContaining({ amountCents: 1_200_000, spreading: 'LINEAR', durationYears: 5, fixedAssetId: null }))
    expect(data.changes).toEqual({ grantCreated: 'g1', amount: 12000, spreading: 'LINEAR', accounts: { grant: '131', transfer: '139', income: '747' } })
    const zero = await tools().get('create_investment_grant')!({ companyId: 'c1', label: 'Région', amount: 0, grantedOn: '2026-03-01', spreading: 'TENTHS' })
    expect(zero.isError).toBe(true)
  })

  it('prepare_year_end_entries answers the drafts created and the items skipped', async () => {
    vi.mocked(prepareYearEndEntries).mockResolvedValue({
      created: [
        { kind: 'provision', itemId: 'p1', label: 'Litige', entryId: 'e1', cents: 800_000 },
        { kind: 'provision', itemId: 'p2', label: 'Stock', entryId: 'e2', cents: -20_000 },
        { kind: 'grant', itemId: 'g1', label: 'Région', entryId: 'e3', cents: 240_000 },
      ],
      skipped: [{ kind: 'provision', itemId: 'p3', label: 'Client', reason: "L'écriture n° 12 est validée" }],
    })
    const data = parse(await tools().get('prepare_year_end_entries')!({ companyId: 'c1', fiscalYearId: 'fy' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['create'] })
    expect(data.changes.draftsCreated).toEqual([
      { kind: 'provision', itemId: 'p1', label: 'Litige', entryId: 'e1', amount: 8000, movement: 'dotation' },
      { kind: 'provision', itemId: 'p2', label: 'Stock', entryId: 'e2', amount: -200, movement: 'reprise' },
      { kind: 'grant', itemId: 'g1', label: 'Région', entryId: 'e3', amount: 2400, movement: 'transfer' },
    ])
    expect(data.changes.skipped).toHaveLength(1)
    expect(data.message).toBe('3 écriture(s) préparée(s) en brouillon : elles doivent être vérifiées et validées dans Kledg.')
  })

  it('refuses a role without entries:create, before the service', async () => {
    guard.require.mockRejectedValueOnce(new ForbiddenError('Accès refusé'))
    const result = await tools().get('prepare_year_end_entries')!({ companyId: 'c1', fiscalYearId: 'fy' })
    expect(result).toEqual({ content: [{ type: 'text', text: 'Accès refusé' }], isError: true })
    expect(prepareYearEndEntries).not.toHaveBeenCalled()
  })
})

describe('update_year_end_formalities', () => {
  const saved = { ...emptyDetails(), rcsCity: 'Lyon', meeting: { ...emptyDetails().meeting, place: 'Siège social' } }

  beforeEach(() => {
    vi.mocked(getApproval).mockResolvedValue({
      details: saved,
      pack: { documents: [{ id: 'minutes', title: 'Procès-verbal', required: true, missing: ['Heure de la réunion'] }, { id: 'report', title: 'Rapport', required: false, missing: [] }], warnings: [] },
    } as never)
  })

  it('checks closing:execute, merges the fields given into what is saved and answers what is still missing', async () => {
    const data = parse(
      await tools().get('update_year_end_formalities')!({
        companyId: 'c1',
        fiscalYearId: 'fy-2025',
        meeting: { date: '2026-05-20' },
        size: { category: 'micro' },
        allocation: { dividends: 5000 },
        approvedOn: '2026-05-20',
      }),
    )
    expect(guard.require).toHaveBeenCalledWith('c1', { closing: ['execute'] })
    const details = vi.mocked(saveApproval).mock.calls[0][2]
    expect(vi.mocked(saveApproval).mock.calls[0].slice(0, 2)).toEqual(['c1', 'fy-2025'])
    expect(vi.mocked(saveApproval).mock.calls[0][3]).toBe('u1')
    expect(details).toMatchObject({
      rcsCity: 'Lyon',
      meeting: { place: 'Siège social', date: '2026-05-20' },
      size: { category: 'micro', employees: null },
      allocation: { dividendsCents: 500_000, otherReservesCents: 0 },
      approvedOn: '2026-05-20',
    })
    expect(data.changes.fields).toEqual(['approvedOn', 'meeting.date', 'size.category', 'allocation.dividends'])
    expect(data.missing).toEqual([{ document: 'Procès-verbal', required: true, missing: ['Heure de la réunion'] }])
    expect(data.reviewUrl).toMatch(/\/c1\/approval$/)
  })

  it('refuses invalid values in French and keeps the service checks', async () => {
    const bad = await tools().get('update_year_end_formalities')!({ companyId: 'c1', fiscalYearId: 'fy', size: { category: 'huge' } })
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toContain('size.category')
    vi.mocked(saveApproval).mockRejectedValueOnce(new ValidationError("La date d'approbation doit être postérieure à la clôture de l'exercice (31/12/2025)."))
    const early = await tools().get('update_year_end_formalities')!({ companyId: 'c1', fiscalYearId: 'fy', approvedOn: '2025-06-01' })
    expect(early).toEqual({ content: [{ type: 'text', text: "La date d'approbation doit être postérieure à la clôture de l'exercice (31/12/2025)." }], isError: true })
  })
})
