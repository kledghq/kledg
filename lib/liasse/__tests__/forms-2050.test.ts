/**
 * Tables of the régime réel normal (lib/liasse/form-2056.ts, form-2057.ts,
 * form-2058b.ts, form-2058c.ts, and the 2059-E, 2059-F, 2059-G codes).
 * Sources: forms n° 2056-SD, 2057-SD, 2058-B-SD, 2058-C-SD, 2059-E-SD to
 * 2059-G-SD 2026 (liasse 2050) and notice n° 2032-NOT-SD (gross amounts
 * before impairment on 2057, K4 to YK, "le total I doit être égal au total
 * II" on 2058-C); CGI art. 39, 1-5° and 39, 2 (non deductible provisions);
 * C. com. art. L232-10 and L232-11 (allocation of the result).
 */

import { describe, expect, it } from 'vitest'
import type { AccountYear } from '@/lib/annexe/build-annexe'
import { buildCapitalForm, CAPITAL_CODES_2059F } from '../capital'
import { cellByBox, centsOf, type LiasseForm } from '../cells'
import { buildForm2056 } from '../form-2056'
import { buildForm2057 } from '../form-2057'
import { buildForm2058B } from '../form-2058b'
import { buildForm2058C } from '../form-2058c'
import { incomeStatementProvisions, provisionMovements, type ProvisionRegisterItem } from '../provisions'
import { buildValueAddedForm, VALUE_ADDED_CODES_2059E } from '../value-added'
import { vatTotals } from '../vat'

const v = (form: LiasseForm, box: string) => centsOf(cellByBox(form, box))
const year = (code: string, openingCents: number, debitCents: number, creditCents: number): AccountYear => ({ code, label: code, openingCents, debitCents, creditCents })

describe('form 2056-SD, provisions inscrites au bilan', () => {
  const lines = [
    { entryId: 'an', reversalOfId: null, opening: true, code: '151100', debitCents: 0, creditCents: 100_000 },
    { entryId: 'e1', reversalOfId: null, opening: false, code: '151400', debitCents: 0, creditCents: 20_000 },
    { entryId: 'e2', reversalOfId: null, opening: false, code: '296100', debitCents: 0, creditCents: 50_000 },
    { entryId: 'e3', reversalOfId: null, opening: false, code: '151800', debitCents: 0, creditCents: 5_000 },
  ]
  const accounts = [
    { code: '681500', debitCents: 25_000, creditCents: 0 },
    { code: '686600', debitCents: 50_000, creditCents: 0 },
    { code: '681120', debitCents: 90_000, creditCents: 0 },
  ]
  const form = buildForm2056({
    movements: provisionMovements(lines),
    register: [],
    balanceSheet: { regulated: { box: 'DK', cents: 0 }, riskCharges: { box: 'DR', cents: 125_000 } },
    incomeStatement: incomeStatementProvisions(accounts),
  })

  it('reads each line of the form from its accounts', () => {
    expect([v(form, '4A'), v(form, '4D')]).toEqual([100_000, 100_000])
    expect([v(form, '4P'), v(form, '4S')]).toEqual([20_000, 20_000])
    expect([v(form, '9V'), v(form, '9X')]).toEqual([50_000, 50_000])
    expect([v(form, '5W'), v(form, 'TV'), v(form, 'TX'), v(form, 'UB'), v(form, 'UD')]).toEqual([5_000, 25_000, 125_000, 75_000, 175_000])
  })

  it('asks to split a line without an account of its own when the account holding it moved', () => {
    // 151800 moved: the congés payés line (5R) cannot be told apart from the other provisions
    expect(cellByBox(form, '5S')).toMatchObject({ source: 'manual', value: null })
    // 14 did not move: gisements, investissement, prêts d'installation are zero
    expect(cellByBox(form, 'TA')).toMatchObject({ source: 'books', value: { kind: 'amount', cents: 0 } })
  })

  it('splits dotations by nature from the income statement and ties them to the relevé', () => {
    expect([v(form, 'UE'), v(form, 'UG'), v(form, 'UJ')]).toEqual([25_000, 50_000, 0])
    expect(form.checks.find((c) => c.id === 'income-statement-dotations')).toMatchObject({ ok: true })
    expect(form.checks.find((c) => c.id === 'balance-sheet-risk-charges')).toMatchObject({ ok: true })
  })
})

describe('form 2057-SD, échéances des créances et des dettes', () => {
  const accounts = [
    year('274000', 300_000, 100_000, 50_000),
    year('411000', 0, 500_000, 380_000),
    year('416000', 0, 20_000, 0),
    year('445660', 0, 10_000, 0),
    year('486000', 0, 4_000, 0),
    year('401000', 0, 100_000, 160_000),
    year('404000', 0, 0, 30_000),
    year('421000', 0, 0, 25_000),
    year('512000', 0, 10_000, 15_000),
    year('164000', -800_000, 200_000, 0),
    year('455000', 0, 0, 70_000),
  ]
  const build = (over: Partial<Parameters<typeof buildForm2057>[0]> = {}) =>
    buildForm2057({ accounts, receivableMaturities: { overOneYearCents: 0 }, debtMaturities: null, balanceSheetDebtsCents: 1_330_000, ...over })

  it('reads the gross amounts at the closing, receivables on the debit side and debts on the credit side', () => {
    const form = build()
    expect([v(form, 'UP'), v(form, 'VA'), v(form, 'UX'), v(form, 'VB'), v(form, 'VS')]).toEqual([350_000, 20_000, 120_000, 10_000, 4_000])
    expect([v(form, '8B'), v(form, '8J'), v(form, '8C'), v(form, 'VI')]).toEqual([60_000, 30_000, 25_000, 70_000])
    expect([v(form, 'VD'), v(form, 'VE')]).toEqual([100_000, 50_000])
    expect(cellByBox(form, 'VT')?.pending).toEqual(['Z1'])
  })

  it('splits the receivables when the annexe says none is due after a year, and asks otherwise', () => {
    const form = build()
    expect([v(form, 'UR'), v(form, 'US'), v(form, 'VV')]).toEqual([350_000, 0, 0])
    expect(cellByBox(build({ receivableMaturities: { overOneYearCents: 300_000 } }), 'UR')).toMatchObject({ source: 'manual' })
    expect(v(build({ receivableMaturities: { overOneYearCents: 300_000 } }), 'VV')).toBe(300_000)
    expect(cellByBox(build({ receivableMaturities: null }), 'VU')).toMatchObject({ source: 'manual' })
  })

  it('cannot tell the term at origin of the 164 loans: VG and VH by hand, with hints', () => {
    const form = build()
    expect(cellByBox(form, 'VG')).toMatchObject({ source: 'manual', hint: { kind: 'amount', cents: 5_000 } })
    expect(cellByBox(form, 'VH')).toMatchObject({ source: 'manual', hint: { kind: 'amount', cents: 600_000 } })
    expect(cellByBox(form, 'VL')).toMatchObject({ source: 'manual', hint: { kind: 'amount', cents: 70_000 } })
  })

  it('ties the total of the debts to the balance sheet (EC)', () => {
    // VG and VH are by hand: the total covers the other lines (60 000 + 30 000 + 25 000 + 70 000)
    expect(v(build(), 'VY')).toBe(185_000)
    expect(build({ balanceSheetDebtsCents: 185_000 }).checks[0]).toMatchObject({ id: 'balance-sheet-debts', ok: true })
    expect(build().checks[0].ok).toBe(false)
  })
})

describe('form 2058-B-SD', () => {
  const register: ProvisionRegisterItem[] = [
    { label: 'Amende', category: 'RISK_CHARGE', accountCode: '151400', taxDeductible: false, movementCents: 20_000, closingCents: 20_000 },
    { label: 'Litige', category: 'RISK_CHARGE', accountCode: '151100', taxDeductible: true, movementCents: 50_000, closingCents: 50_000 },
    { label: 'Titres', category: 'FIXED_ASSET', accountCode: '296100', taxDeductible: false, movementCents: -8_000, closingCents: 0 },
  ]
  const form = buildForm2058B({ deficits: { known: true, openingCents: 500_000, imputedCents: 200_000, createdCents: 0 }, deficitsWhy: '', register })

  it('follows the deficits in K4 to YK', () => {
    expect([v(form, 'K4'), v(form, 'K5'), v(form, 'K6'), v(form, 'YJ'), v(form, 'YK')]).toEqual([500_000, 200_000, 300_000, 0, 300_000])
  })

  it('puts the non deductible provisions of the register in the slots, totals YN and YO', () => {
    expect(v(form, '8X')).toBe(20_000)
    expect(v(form, '9E')).toBe(8_000)
    expect(v(form, 'YN')).toBe(20_000)
    expect(v(form, 'YO')).toBe(8_000)
    expect(cellByBox(form, 'YN')?.pending).toContain('ZV')
    expect(form.warnings).toHaveLength(2)
  })
})

describe('form 2058-C-SD', () => {
  // Result 2025 of 10 000 €, allocated in 2026: 500 € legal reserve, 6 000 € dividends, the rest to report à nouveau
  const accounts = [
    year('110000', -20_000, 0, 350_000),
    year('120000', -1_000_000, 1_000_000, 0),
    year('106100', -100_000, 0, 50_000),
    year('457000', 0, 600_000, 600_000),
    year('611000', 0, 120_000, 0),
    year('613200', 0, 240_000, 0),
    year('622600', 0, 80_000, 0),
    year('622400', 0, 10_000, 0),
    year('626000', 0, 30_000, 0),
    year('635110', 0, 45_000, 0),
    year('637000', 0, 5_000, 0),
  ]
  const build = (approved: { year: number; dividendsCents: number; otherReservesCents: number } | null) =>
    buildForm2058C({ accounts, vat: vatTotals([]), approvedAllocation: approved, leasingCommitmentsCents: null, subsidiaries: { listed: 1, unreachable: 0 } })

  it('reads the allocation of the previous result in the entries of the year; total I equals total II', () => {
    const form = build({ year: 2025, dividendsCents: 600_000, otherReservesCents: 0 })
    expect([v(form, '0C'), v(form, '0D'), v(form, '0F')]).toEqual([20_000, 1_000_000, 1_020_000])
    expect([v(form, 'ZB'), v(form, 'ZE'), v(form, 'ZG'), v(form, 'ZH')]).toEqual([50_000, 600_000, 370_000, 1_020_000])
    expect(form.checks.every((c) => c.ok)).toBe(true)
  })

  it('compares the dividends with the allocation voted', () => {
    expect(build({ year: 2025, dividendsCents: 500_000, otherReservesCents: 0 }).checks.find((c) => c.id === 'approved-dividends')).toMatchObject({ ok: false })
    expect(build(null).warnings.some((w) => w.includes('Aucune affectation votée'))).toBe(true)
  })

  it('details the external charges and taxes', () => {
    const form = build(null)
    expect([v(form, 'YT'), v(form, 'XQ'), v(form, 'SS'), v(form, 'YV'), v(form, 'ST'), v(form, 'ZJ')]).toEqual([120_000, 240_000, 80_000, 10_000, 30_000, 480_000])
    expect([v(form, 'YW'), v(form, '9Z'), v(form, 'YX')]).toEqual([45_000, 5_000, 50_000])
    expect(cellByBox(form, 'ZR')?.value).toEqual({ kind: 'count', value: 1 })
    expect(cellByBox(form, 'ZK')).toMatchObject({ source: 'manual' })
  })
})

describe('forms 2059-E-SD and 2059-F-SD', () => {
  it('use the codes of the régime normal and name its notice', () => {
    const e = buildValueAddedForm({
      form: { id: '2059-E', number: '2059-E-SD' },
      notice: '2032-NOT-SD',
      codes: VALUE_ADDED_CODES_2059E,
      fiscalYear: { startDate: '2026-01-01', endDate: '2026-12-31' },
      duration: { months: 12, days: 365 },
      accounts: [{ code: '706000', debitCents: 0, creditCents: 100_000 }],
      employees: null,
    })
    expect(v(e, 'OA')).toBe(100_000)
    expect(cellByBox(e, 'YP')?.note).toContain('2032-NOT-SD')
    expect(e.required.reason).toContain('2032-NOT-SD')
    const f = buildCapitalForm({
      form: { id: '2059-F', number: '2059-F-SD', title: 'Composition du capital social' },
      codes: CAPITAL_CODES_2059F,
      identifier: 'siret',
      company: { name: 'A', siren: '111111111', siret: null, legalType: 'SAS', address: null, endDate: '2026-12-31' },
      holders: [],
      compositionChecks: [],
    })
    expect(cellByBox(f, 'P5')?.value).toEqual({ kind: 'count', value: 0 })
    expect(f.sections[0].rows.find((r) => r.label === 'N° SIRET')?.cells[0]).toMatchObject({ source: 'manual' })
  })
})
