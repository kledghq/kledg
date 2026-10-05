/**
 * MCP tools of training organisations (lib/mcp/training-tools.ts,
 * lib/mcp/drafts/training.ts): the read tools check reports:read and return
 * euros; the draft tools exist only with kledg:write, check entries:create,
 * send cents to the services and are audited. Services are mocked (the
 * PostgreSQL test lib/training-report/__tests__/training-organisation.db.test.ts
 * runs them).
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
vi.mock('@/lib/vat-deduction/load-vat-deduction.service', () => ({ loadVatDeduction: vi.fn() }))
vi.mock('@/lib/vat-deduction/save-vat-deduction.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/vat-deduction/save-vat-deduction.service')>()), saveVatDeduction: vi.fn() }))
vi.mock('@/lib/vat-deduction/prepare-regularisation.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/vat-deduction/prepare-regularisation.service')>()), prepareVatRegularisation: vi.fn() }))
vi.mock('@/lib/training-report/load-training-report.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/training-report/load-training-report.service')>()), loadTrainingReport: vi.fn() }))
vi.mock('@/lib/training-report/save-training-report.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/training-report/save-training-report.service')>()),
  saveTrainingReport: vi.fn(),
  saveTrainingOrigins: vi.fn(),
}))
vi.mock('@/lib/payroll-tax/load-payroll-tax.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/payroll-tax/load-payroll-tax.service')>()), loadPayrollTax: vi.fn() }))
vi.mock('@/lib/payroll-tax/save-payroll-tax.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/payroll-tax/save-payroll-tax.service')>()), savePayrollTax: vi.fn() }))
vi.mock('@/lib/payroll-tax/prepare-payroll-tax-entry.service', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/payroll-tax/prepare-payroll-tax-entry.service')>()), preparePayrollTaxEntry: vi.fn() }))

import { registerKledgTools } from '@/lib/mcp/tools'
import { loadVatDeduction, type VatDeductionView } from '@/lib/vat-deduction/load-vat-deduction.service'
import { saveVatDeduction } from '@/lib/vat-deduction/save-vat-deduction.service'
import { prepareVatRegularisation } from '@/lib/vat-deduction/prepare-regularisation.service'
import { loadTrainingReport, type TrainingReportView } from '@/lib/training-report/load-training-report.service'
import { saveTrainingOrigins, saveTrainingReport } from '@/lib/training-report/save-training-report.service'
import { loadPayrollTax, type PayrollTaxView } from '@/lib/payroll-tax/load-payroll-tax.service'
import { savePayrollTax } from '@/lib/payroll-tax/save-payroll-tax.service'
import { preparePayrollTaxEntry } from '@/lib/payroll-tax/prepare-payroll-tax-entry.service'
import { EMPTY_TRAINING_REPORT } from '@/lib/training-report/schemas'
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

const READ = { reports: ['read'] }
const WRITE = { entries: ['create'] }

beforeEach(() => vi.clearAllMocks())

describe('read tools', () => {
  it('get_vat_deduction_coefficient reads the coefficients in euros with reports:read', async () => {
    vi.mocked(loadVatDeduction).mockResolvedValue({
      year: 2025,
      mode: 'coefficient',
      partialVatDeduction: true,
      trainingOrganisation: true,
      yearClosed: true,
      revenue: { taxableCents: 6_000_000, exemptCents: 4_000_000, toClassifyCents: 0, excludedCents: 0, numeratorCents: 6_000_000, denominatorCents: 10_000_000, accounts: [] },
      taxationPercent: 60,
      provisional: { year: 2025, taxationPercent: 50, source: 'previous-year', assujettissementPercent: 100, deductionPercent: 50 },
      definitiveDeductionPercent: 60,
      coefficientLine: '22A',
      regularisation: { deductedCents: 500_000, incurredCents: 1_000_000, incurredSource: 'books', amountCents: 100_000, form: 'CA3', line: { code: '21', box: '0059', label: 'Autre TVA à déduire' }, deadline: '2026-04-24', entryDate: '2026-03-31', draft: { reference: 'COEF-TVA-2025', status: 'none', entryId: null, entryNumber: null } },
      settings: { estimatedTaxationPercent: null, assujettissementPercent: 100, incurredVatCents: null, note: null },
      hints: [],
      sources: [],
    } as unknown as VatDeductionView)
    const data = parse(await tools(false).get('get_vat_deduction_coefficient')!({ companyId: 'c1', year: 2025 }))
    expect(guard.require).toHaveBeenCalledWith('c1', READ)
    expect(data).toMatchObject({ taxationPercent: 60, definitiveDeductionPercent: 60, revenue: { taxable: 60_000, exempt: 40_000 }, regularisation: { amount: 1_000, incurred: 10_000, line: { code: '21' } } })
    expect(data.reviewUrl).toMatch(/coefficient-tva\?annee=2025$/)
  })

  it('get_training_report reads frame C and the frames entered', async () => {
    vi.mocked(loadTrainingReport).mockResolvedValue({
      trainingOrganisation: true,
      establishments: [],
      fiscalYear: { id: 'fy25', year: 2025, startDate: '2025-01-01', endDate: '2025-12-31', isClosed: true },
      deadline: { date: '2026-04-29', extendedDate: '2026-05-31' },
      frameC: { lines: [{ code: 'c1', line: '1', label: 'Entreprises', cents: 1_000_000, euros: 10_000 }], opcoTotalEuros: 0, totalEuros: 10_000, outsideEuros: 0, unassignedCents: 0, sharePercent: 100 },
      frameD: null,
      revenue: [],
      customers: [],
      accountOrigins: [],
      data: EMPTY_TRAINING_REPORT,
      totals: { trainees: { count: 0, hours: 0 }, objectives: { count: 0, hours: 0 }, specialities: { count: 0, hours: 0 } },
      checks: [],
      sources: [],
    } as unknown as TrainingReportView)
    const data = parse(await tools(false).get('get_training_report')!({ companyId: 'c1' }))
    expect(guard.require).toHaveBeenCalledWith('c1', READ)
    expect(data.frameC).toMatchObject({ total: 10_000, sharePercent: 100, lines: [{ line: '1', euros: 10_000 }] })
    expect(data.reviewUrl).toMatch(/bilan-pedagogique-financier\?exercice=fy25$/)
  })

  it('get_payroll_tax reads the computation in euros', async () => {
    vi.mocked(loadPayrollTax).mockResolvedValue({
      year: 2026,
      covered: true,
      liability: 'liable',
      reference: { year: 2025, nonDeductibleCents: 8_000_000, totalCents: 10_000_000, toClassifyCents: 0 },
      ratio: { source: 'books', exactBasisPoints: 8_000, truncatedPercent: 80, appliedPercent: 80 },
      data: { employees: [{ id: 'e1', label: 'Formatrice', baseCents: 3_000_000 }], association: false, ratioPercent: null, previousYearTaxCents: null, note: null },
      computation: { baseCents: 3_000_000, firstBracketCents: 919_400, secondBracketCents: 1_157_700, taxBaseCents: 127_500, taxFirstCents: 39_100, taxSecondCents: 108_200, grossCents: 274_800, ratioPercent: 80, afterRatioCents: 219_800, franchise: false, decoteCents: 0, afterDecoteCents: 219_800, abatementCents: 0, dueCents: 219_800 },
      booksSalariesCents: 3_000_000,
      enteredBasesCents: 3_000_000,
      previous: { taxCents: null, source: 'none' },
      frequency: 'annual',
      schedule: [],
      draft: { reference: 'TS-2026', status: 'none', entryId: null, entryNumber: null },
      hints: [],
      sources: [],
    } as unknown as PayrollTaxView)
    const data = parse(await tools(false).get('get_payroll_tax')!({ companyId: 'c1', year: 2026 }))
    expect(guard.require).toHaveBeenCalledWith('c1', READ)
    expect(data).toMatchObject({ liability: 'liable', computation: { due: 2_198, gross: 2_748 }, employees: [{ base: 30_000 }] })
  })
})

describe('draft tools', () => {
  it('exist only with kledg:write', () => {
    const names = ['save_vat_deduction_settings', 'prepare_vat_coefficient_regularisation', 'save_training_report', 'save_training_origins', 'save_payroll_tax', 'prepare_payroll_tax_entry']
    for (const name of names) {
      expect(tools(false).has(name), name).toBe(false)
      expect(tools(true).has(name), name).toBe(true)
    }
  })

  it('save_vat_deduction_settings sends the VAT borne in cents with entries:create', async () => {
    vi.mocked(saveVatDeduction).mockResolvedValue({ saved: ['incurredVatCents'] })
    parse(await tools(true).get('save_vat_deduction_settings')!({ companyId: 'c1', year: 2025, incurredVat: 1234.5, accounts: [{ accountCode: '7061', vatTreatment: 'exempt' }] }))
    expect(guard.require).toHaveBeenCalledWith('c1', WRITE)
    expect(saveVatDeduction).toHaveBeenCalledWith('c1', expect.objectContaining({ year: 2025, incurredVatCents: 123_450, accounts: [{ accountCode: '7061', vatTreatment: 'exempt' }] }), { userId: 'u1' })
    expect(writeAuditLog).toHaveBeenCalledWith('info', expect.stringContaining('save_vat_deduction_settings'), expect.objectContaining({ action: 'MCP_WRITE' }))
  })

  it('prepare_vat_coefficient_regularisation prepares a draft', async () => {
    vi.mocked(prepareVatRegularisation).mockResolvedValue({ status: 'created', reference: 'COEF-TVA-2025', entryId: 'e1', entryNumber: 'BR-1', lines: [], message: 'Régularisation préparée' })
    const data = parse(await tools(true).get('prepare_vat_coefficient_regularisation')!({ companyId: 'c1', year: 2025 }))
    expect(prepareVatRegularisation).toHaveBeenCalledWith('c1', { year: 2025 }, { source: 'mcp' })
    expect(data.reviewUrl).toMatch(/entries\/e1$/)
  })

  it('save_training_report and save_training_origins call their services', async () => {
    vi.mocked(saveTrainingReport).mockResolvedValue({ fiscalYearId: 'fy25' })
    vi.mocked(saveTrainingOrigins).mockResolvedValue({ accounts: 1, customers: 1 })
    parse(await tools(true).get('save_training_report')!({ companyId: 'c1', fiscalYearId: 'fy25', data: { trainees: { employees: { count: 3, hours: 21 } }, charges: { totalCents: null } } }))
    expect(saveTrainingReport).toHaveBeenCalledWith('c1', expect.objectContaining({ fiscalYearId: 'fy25', data: expect.objectContaining({ trainees: expect.objectContaining({ employees: { count: 3, hours: 21 } }) }) }), { userId: 'u1' })
    parse(await tools(true).get('save_training_origins')!({ companyId: 'c1', accounts: [{ accountCode: '7061', trainingOrigin: 'c2e' }], customers: [{ tiersId: 't1', trainingOrigin: 'c1' }] }))
    expect(saveTrainingOrigins).toHaveBeenCalledWith('c1', { accounts: [{ accountCode: '7061', trainingOrigin: 'c2e' }], customers: [{ tiersId: 't1', trainingOrigin: 'c1' }] })
    const bad = await tools(true).get('save_training_origins')!({ companyId: 'c1', accounts: [{ accountCode: '7061', trainingOrigin: 'x9' }] })
    expect(bad.isError).toBe(true)
  })

  it('save_payroll_tax sends the bases in cents, prepare_payroll_tax_entry prepares the draft', async () => {
    vi.mocked(savePayrollTax).mockResolvedValue({ year: 2026, computed: { liable: true, frequency: 'annual', dueCents: 219_800 } })
    vi.mocked(preparePayrollTaxEntry).mockResolvedValue({ status: 'created', reference: 'TS-2026', entryId: 'e2', entryNumber: 'BR-2', lines: [], message: 'Écriture préparée' })
    parse(await tools(true).get('save_payroll_tax')!({ companyId: 'c1', year: 2026, data: { employees: [{ id: 'e1', label: 'Formatrice', base: 30000 }] } }))
    expect(savePayrollTax).toHaveBeenCalledWith('c1', expect.objectContaining({ year: 2026, data: expect.objectContaining({ employees: [{ id: 'e1', label: 'Formatrice', baseCents: 3_000_000 }] }) }), { userId: 'u1' })
    parse(await tools(true).get('prepare_payroll_tax_entry')!({ companyId: 'c1', year: 2026 }))
    expect(preparePayrollTaxEntry).toHaveBeenCalledWith('c1', { year: 2026 }, { source: 'mcp' })
  })
})
