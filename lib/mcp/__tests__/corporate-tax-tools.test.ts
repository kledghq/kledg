/**
 * MCP tools of the impôt sur les sociétés (lib/mcp/corporate-tax-tools.ts,
 * lib/mcp/drafts/corporate-tax.ts): get_corporate_tax reads the worksheet
 * with reports:read at every level, amounts in euros, subsidiaries read
 * through the connection's guard; prepare_corporate_tax_entry exists only
 * with kledg:write, checks entries:create and prepares a draft. Services
 * are mocked (lib/corporate-tax/__tests__/corporate-tax.db.test.ts runs
 * them on PostgreSQL). Kledg never files a return.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const guard = vi.hoisted(() => ({
  require: vi.fn(async () => {}),
  requireFullControl: vi.fn(async () => {}),
  companyWhere: vi.fn(async () => ({})),
  companyIds: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn() }))
vi.mock('@/lib/mcp/company-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/company-access')>()),
  companyGuard: () => guard,
}))
vi.mock('@/lib/corporate-tax/load-corporate-tax.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/corporate-tax/load-corporate-tax.service')>()),
  loadCorporateTax: vi.fn(),
}))
vi.mock('@/lib/corporate-tax/prepare-corporate-tax-entries.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/corporate-tax/prepare-corporate-tax-entries.service')>()),
  prepareCorporateTaxEntry: vi.fn(),
}))

import { registerKledgTools } from '@/lib/mcp/tools'
import { loadCorporateTax, type CorporateTaxView } from '@/lib/corporate-tax/load-corporate-tax.service'
import { prepareCorporateTaxEntry } from '@/lib/corporate-tax/prepare-corporate-tax-entries.service'
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
  today: '2027-02-10',
  status: 'ready',
  fiscalYears: [{ id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false, filed: false }],
  fiscalYear: { id: 'fy26', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31', isClosed: false, filed: false },
  regime: 'simplified',
  formTitle: 'Déclaration 2065-SD et tableau 2033-B-SD (régime simplifié)',
  duration: { months: 12, days: 365 },
  computation: {
    regime: 'simplified',
    lines: [{ id: 'result', kind: 'result', origin: 'books', label: 'Bénéfice comptable de l’exercice', formLine: '312', amountCents: 6_000_040, euros: 60_000, hint: 'Résultat', source: null }],
    accountingResultCents: 6_000_040,
    resultBeforeDeficitsCents: 6_000_000,
    deficits: { known: true, openingCents: 0, capCents: 6_000_000, imputedCents: 0, createdCents: 0, closingCents: 0 },
    taxableProfitCents: 6_000_000,
    eligibility: { eligible: true, turnoverAnnualCents: 50_000_000, turnoverOk: true, capitalPaidUp: true, naturalPersons75: true },
    reducedRate: { applied: true, ceilingCents: 4_250_000, baseCents: 4_250_000, taxCents: 637_500 },
    normalRate: { baseCents: 1_750_000, taxCents: 437_500 },
    corporateTaxCents: 1_075_000,
    ifEligibleCents: null,
    socialContribution: { exempt: true, allowanceCents: 76_300_000, baseCents: 0, cents: 0 },
    creditsCents: 0,
    totalCents: 1_075_000,
  },
  answers: { capitalPaidUp: { value: true, from: 'answer' }, naturalPersons75: { value: true, from: 'shareholders' }, shareholders: { naturalBp: 10_000, totalBp: 10_000, complete: true } },
  deficits: { openingTypedCents: 0, history: [{ fiscalYearId: 'fy26', year: 2026, openingCents: 0, imputedCents: 0, createdCents: 0, closingCents: 0, basis: 'worksheet', openingTyped: true }] },
  manualLines: [],
  parentSubsidiary: [],
  checks: [{ id: 'drafts', severity: 'ok', title: 'Aucune écriture en brouillon sur l’exercice', detail: 'Toutes validées.' }],
  reliable: true,
  balance: { deadline: { date: '2027-05-18', legalDate: '2027-05-15', id: 'is-solde:2026-12-31' }, acomptesPaid: [], paidCents: 0, balanceCents: 1_075_000, acomptesBookedCents: 0 },
  acomptes: {
    referenceTaxCents: 1_075_000,
    exempt: false,
    totalCents: 1_075_200,
    items: [{ number: 1, date: '2027-03-15', legalDate: '2027-03-15', deadlineId: 'is-acompte:2027-12-31:1', amountCents: 268_800, reference: 'current', exempt: false, note: 'Un quart de l’impôt de référence.' }],
    exercice: { year: 2027, startDate: '2027-01-01', endDate: '2027-12-31', exists: false, id: null },
    drafts: [{ reference: 'IS-AC-2027-1', status: 'none', entryId: null, entryNumber: null }],
  },
  liasse: { date: '2027-05-04', legalDate: '2027-05-04' },
  charge: { reference: 'IS-2026', status: 'none', entryId: null, entryNumber: null },
  filing: null,
  notFromTheBooks: ['Les opérations qui ne sont pas comptabilisées dans Kledg.'],
  sources: [{ label: 'CGI, art. 219, I', url: 'https://www.legifrance.gouv.fr' }],
} as unknown as CorporateTaxView

beforeEach(() => vi.clearAllMocks())

describe('get_corporate_tax', () => {
  it('checks reports:read and answers the worksheet, the tax and the acomptes in euros', async () => {
    vi.mocked(loadCorporateTax).mockResolvedValue(VIEW)
    const data = parse(await tools(false).get('get_corporate_tax')!({ companyId: 'c1', fiscalYearId: 'fy26' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { reports: ['read'] })
    expect(loadCorporateTax).toHaveBeenCalledWith('c1', { fiscalYearId: 'fy26', deadline: undefined }, { access: expect.objectContaining({ userId: 'u1' }) })
    expect(data.worksheet[0]).toEqual({ formLine: '312', label: 'Bénéfice comptable de l’exercice', kind: 'result', origin: 'books', amount: 60_000.4, formEuros: 60_000, hint: 'Résultat' })
    expect(data.tax).toMatchObject({ corporateTax: 10_750, total: 10_750, reducedRate: { applied: true, tax: 6_375 } })
    expect(data.acomptes.items[0]).toMatchObject({ number: 1, amount: 2_688, deadlineId: 'is-acompte:2027-12-31:1' })
    expect(data.balance).toEqual({ deadline: '2027-05-18', acomptesPaid: 0, balance: 10_750, acomptesBooked: 0 })
    expect(data.reviewUrl).toMatch(/\/c1\/impot-societes\?exercice=fy26$/)
  })

  it('refuses an unknown deadline in French', async () => {
    const result = await tools(false).get('get_corporate_tax')!({ companyId: 'c1', deadline: 'tva-ca3:2026-09' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Échéance inconnue')
    expect(loadCorporateTax).not.toHaveBeenCalled()
  })
})

describe('prepare_corporate_tax_entry', () => {
  it('is absent from a read-only connection', () => {
    expect(tools(false).has('prepare_corporate_tax_entry')).toBe(false)
  })

  it('checks entries:create, prepares the IS charge as a draft and links to it', async () => {
    vi.mocked(prepareCorporateTaxEntry).mockResolvedValue({
      status: 'created',
      reference: 'IS-2026',
      entryId: 'e1',
      entryNumber: 'BR-12',
      lines: [
        { code: '695', label: 'Impôts sur les bénéfices', debitCents: 1_075_000, creditCents: 0 },
        { code: '444', label: 'État - Impôts sur les bénéfices', debitCents: 0, creditCents: 1_075_000 },
      ],
      message: 'Écriture préparée en brouillon.',
    })
    const data = parse(await tools(true).get('prepare_corporate_tax_entry')!({ companyId: 'c1', fiscalYearId: 'fy26', kind: 'charge' }))
    expect(guard.require).toHaveBeenCalledWith('c1', { entries: ['create'] })
    expect(prepareCorporateTaxEntry).toHaveBeenCalledWith('c1', { kind: 'charge', fiscalYearId: 'fy26' }, { source: 'mcp', access: expect.objectContaining({ userId: 'u1' }) })
    expect(data.lines[0]).toEqual({ account: '695', label: 'Impôts sur les bénéfices', debit: 10_750, credit: 0 })
    expect(data.changes).toEqual({ status: 'created', entryId: 'e1', entryNumber: 'BR-12', reference: 'IS-2026' })
    expect(data.reviewUrl).toMatch(/\/c1\/entries\/e1$/)
    expect(writeAuditLog).toHaveBeenCalledWith('info', expect.stringContaining('prepare_corporate_tax_entry'), expect.objectContaining({ action: 'MCP_WRITE' }))
  })

  it('requires the number of an acompte, and writes no audit entry when nothing changed', async () => {
    const missing = await tools(true).get('prepare_corporate_tax_entry')!({ companyId: 'c1', fiscalYearId: 'fy26', kind: 'acompte' })
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toContain('numéro de l’acompte')
    vi.mocked(prepareCorporateTaxEntry).mockResolvedValue({ status: 'unchanged', reference: 'IS-AC-2027-1', entryId: 'e2', entryNumber: 'BR-13', lines: [], message: 'Déjà à jour.' })
    parse(await tools(true).get('prepare_corporate_tax_entry')!({ companyId: 'c1', fiscalYearId: 'fy26', kind: 'acompte', number: 1 }))
    expect(prepareCorporateTaxEntry).toHaveBeenCalledWith('c1', { kind: 'acompte', fiscalYearId: 'fy26', number: 1 }, expect.anything())
    expect(writeAuditLog).not.toHaveBeenCalled()
  })
})
