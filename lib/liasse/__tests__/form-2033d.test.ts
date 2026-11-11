/**
 * Form 2033-D-SD 2026 (lib/liasse/form-2033d.ts, provisions.ts, deficits.ts,
 * vat.ts) on plain values. Sources: form n° 2033-D-SD 2026 and notice
 * 2033-NOT-SD (box codes, lines 982 to 870, 374 and 378); CGI art. 39, 1-5°
 * (provisions deductible when listed on the relevé); CGI art. 209, I
 * (deficits carried forward); PCG art. 944-44 (VAT accounts).
 */

import { describe, expect, it } from 'vitest'
import type { LedgerLine } from '@/lib/annexe/movements'
import { cellByBox, centsOf, type LiasseForm } from '../cells'
import { buildForm2033D, type Form2033DInput } from '../form-2033d'
import { provisionMovements, type ProvisionRegisterItem } from '../provisions'
import { vatTotals } from '../vat'

const line = (entryId: string, code: string, debitCents: number, creditCents: number, extra: Partial<LedgerLine> = {}): LedgerLine => ({
  entryId,
  reversalOfId: null,
  opening: false,
  code,
  debitCents,
  creditCents,
  ...extra,
})

// Opening: a litigation provision of 1 000 €; dotation 500 €; a receivable impairment of 300 € reversed for 100 €;
// a dotation of 200 € booked by mistake and reversed (contre-passation) in the same year.
const LINES: LedgerLine[] = [
  line('an', '151100', 0, 100_000, { opening: true }),
  line('e1', '151100', 0, 50_000),
  line('e2', '491000', 0, 30_000),
  line('e3', '491000', 10_000, 0),
  line('e4', '151800', 0, 20_000),
  line('e5', '151800', 20_000, 0, { reversalOfId: 'e4' }),
]

const REGISTER: ProvisionRegisterItem[] = [
  { label: 'Litige prud’homal', category: 'RISK_CHARGE', accountCode: '151100', taxDeductible: true, movementCents: 50_000, closingCents: 150_000 },
  { label: 'Amende contestée', category: 'RISK_CHARGE', accountCode: '151400', taxDeductible: false, movementCents: 0, closingCents: 0 },
  { label: 'Client Durand', category: 'RECEIVABLE', accountCode: '491000', taxDeductible: true, movementCents: 20_000, closingCents: 20_000 },
]

function input(overrides: Partial<Form2033DInput> = {}): Form2033DInput {
  return {
    provisions: {
      movements: provisionMovements(LINES),
      register: REGISTER,
      balanceSheet: { regulated: { box: '140', cents: 0 }, riskCharges: { box: '154', cents: 150_000 } },
    },
    deficits: { known: true, openingCents: 1_200_000, imputedCents: 800_000, createdCents: 0 },
    deficitsWhy: '',
    vat: vatTotals([]),
    ...overrides,
  }
}

const value = (form: LiasseForm, box: string) => centsOf(cellByBox(form, box))

describe('form 2033-D-SD, cadre I A: relevé des provisions', () => {
  it('reads each line from the entries: start, dotations, reprises, end, with the official boxes', () => {
    const form = buildForm2033D(input())
    expect([value(form, '620'), value(form, '622'), value(form, '624'), value(form, '626')]).toEqual([100_000, 50_000, 0, 150_000])
    expect([value(form, '650'), value(form, '652'), value(form, '654'), value(form, '656')]).toEqual([0, 30_000, 10_000, 20_000])
    expect([value(form, '680'), value(form, '682'), value(form, '684'), value(form, '686')]).toEqual([100_000, 80_000, 10_000, 170_000])
    expect(cellByBox(form, '626')?.accounts).toEqual(['151100'])
  })

  it('leaves out a dotation cancelled by its contre-passation of the same year', () => {
    const movements = provisionMovements(LINES)
    expect(movements.find((m) => m.code === '151800')).toBeUndefined()
  })

  it('computes the "dont 30 %" line as zero when there is no derogatory depreciation, else asks for it', () => {
    expect(cellByBox(buildForm2033D(input()), '601')).toMatchObject({ source: 'books', value: { kind: 'amount', cents: 0 } })
    const withDerogatory = buildForm2033D(input({ provisions: { ...input().provisions, movements: provisionMovements([...LINES, line('e9', '145000', 0, 40_000)]) } }))
    expect(cellByBox(withDerogatory, '601')).toMatchObject({ source: 'manual', value: null })
    // Cadre I B: only the totals come from the books, each line of assets is to fill by hand
    expect(value(withDerogatory, '770')).toBe(40_000)
    expect(cellByBox(withDerogatory, '720')).toMatchObject({ source: 'manual' })
  })
})

describe('form 2033-D-SD, cadre I C: provisions non déductibles', () => {
  it('lists the dotations of the register marked non deductible; total 780 says what is still to fill', () => {
    const register = [...REGISTER, { label: 'Pénalités de retard', category: 'RISK_CHARGE' as const, accountCode: '151400', taxDeductible: false, movementCents: 7_500, closingCents: 7_500 }]
    const form = buildForm2033D(input({ provisions: { ...input().provisions, register } }))
    const total = cellByBox(form, '780')
    expect(total).toMatchObject({ value: { kind: 'amount', cents: 7_500 }, source: 'record' })
    expect(total?.pending).toEqual(['Indemnités pour congés à payer, charges sociales et fiscales correspondantes', 'Charges à payer non déductibles'])
    expect(form.warnings.some((w) => w.includes('ligne 322 du 2033-B-SD'))).toBe(true)
  })
})

describe('form 2033-D-SD, checks', () => {
  it('ties the provisions to the balance sheet and to the register', () => {
    const form = buildForm2033D(input())
    expect(form.checks.find((c) => c.id === 'balance-sheet-risk-charges')).toMatchObject({ ok: true })
    // The register follows 200 € of receivable impairment at the end, the books 200 €
    expect(form.checks.find((c) => c.id === 'register-customers')).toMatchObject({ ok: true })
    const differing = buildForm2033D(input({ provisions: { ...input().provisions, balanceSheet: { regulated: { box: '140', cents: 0 }, riskCharges: { box: '154', cents: 140_000 } } } }))
    expect(differing.checks.find((c) => c.id === 'balance-sheet-risk-charges')?.message).toContain('compte 15 est rangé ailleurs')
  })

  it('flags dotations no provision of the register explains (their deductibility is unknown)', () => {
    const form = buildForm2033D(input({ provisions: { ...input().provisions, register: [] } }))
    expect(form.warnings.find((w) => w.includes('ne correspondent à aucune provision du registre'))).toContain('800,00')
  })
})

describe('form 2033-D-SD, cadre II: déficits reportables', () => {
  it('carries the worksheet: 982, 983, 984 = 982 - 983, 860 and 870 = 984 + 860; 982 bis stays to fill', () => {
    const form = buildForm2033D(input())
    expect([value(form, '982'), value(form, '983'), value(form, '984'), value(form, '860'), value(form, '870')]).toEqual([1_200_000, 800_000, 400_000, 0, 400_000])
    expect(cellByBox(form, '982 bis')).toMatchObject({ source: 'manual', value: null })
    expect(cellByBox(form, '984')?.pending).toEqual(['982 bis'])
  })

  it('asks for the deficits when the opening is unknown', () => {
    const form = buildForm2033D(input({ deficits: { known: false, openingCents: 0, imputedCents: 0, createdCents: 50_000 }, deficitsWhy: 'Déficits inconnus' }))
    expect(cellByBox(form, '982')).toMatchObject({ source: 'manual', note: 'Déficits inconnus' })
    expect(value(form, '860')).toBe(50_000)
    expect(cellByBox(form, '870')).toMatchObject({ source: 'manual' })
  })
})

describe('form 2033-D-SD, cadre III: TVA (374, 378)', () => {
  it('sums the VAT of the year without the settlement entries and the VAT not yet due (44574)', () => {
    const vat = vatTotals([
      { code: '445710', debitCents: 2_000, creditCents: 50_000, settlement: false, opening: false },
      { code: '445740', debitCents: 0, creditCents: 9_000, settlement: false, opening: false },
      { code: '445660', debitCents: 30_000, creditCents: 1_000, settlement: false, opening: false },
      { code: '445710', debitCents: 48_000, creditCents: 0, settlement: true, opening: false },
      { code: '445620', debitCents: 4_000, creditCents: 0, settlement: false, opening: false },
    ])
    expect(vat).toMatchObject({ collectedCents: 48_000, deductibleCents: 29_000, collectedAccounts: ['445710'], deductibleAccounts: ['445660'] })
    const form = buildForm2033D(input({ vat }))
    expect([value(form, '374'), value(form, '378')]).toEqual([48_000, 29_000])
    expect(cellByBox(form, '399')).toMatchObject({ source: 'manual' })
    expect(cellByBox(form, '693')).toMatchObject({ source: 'manual' })
  })
})
