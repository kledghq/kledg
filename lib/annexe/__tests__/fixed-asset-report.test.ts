/**
 * Worked example of forms 2054-SD, 2055-SD and 2033-C-SD (DGFiP, 2026
 * editions) computed from the entries of a year, and their reconciliation
 * with the balance sheet ("Actif immobilisé", box BJ of 2050) and the fixed
 * asset register. PCG art. 832-1: the gross value at the end is the
 * algebraic sum of the previous columns; art. 832-2: entries, disposals,
 * transfers and revaluations are shown apart.
 */

import { describe, expect, it } from 'vitest'
import { buildFixedAssetReport, type RegisterAsset } from '../fixed-asset-report'
import { lineOf, FORM_2054, FORM_2055, isGrossFixedAssetAccount } from '../fixed-asset-forms'
import { amountOf, type LedgerLine } from '../movements'

let n = 0
const entry = (lines: Array<[string, number, number]>, options: { opening?: boolean; id?: string; reversalOfId?: string } = {}): LedgerLine[] => {
  const entryId = options.id ?? `e${++n}`
  return lines.map(([code, debitCents, creditCents]) => ({ entryId, reversalOfId: options.reversalOfId ?? null, opening: options.opening ?? false, code, debitCents, creditCents }))
}

// Opening: land 50 000 €, computers 3 000 € depreciated by 1 000 €.
const LINES: LedgerLine[] = [
  ...entry([['211000', 5_000_000, 0], ['218300', 300_000, 0], ['281830', 0, 100_000]], { opening: true }),
  ...entry([['218200', 2_000_000, 0]]), // vehicle bought (counterpart 404, not loaded)
  ...entry([['218300', 0, 120_000], ['281830', 40_000, 0]]), // a computer sold (675 not loaded)
  ...entry([['281830', 0, 60_000], ['281820', 0, 400_000]]), // allowances of the year (6811 not loaded)
  ...entry([['231000', 500_000, 0]]), // works in progress
  ...entry([['215400', 500_000, 0], ['231000', 0, 500_000]]), // put in service: transfer from 231 to 2154
  ...entry([['211000', 1_000_000, 0], ['105200', 0, 1_000_000]]), // legal revaluation of the land
  ...entry([['218400', 99_900, 0]], { id: 'mistake' }),
  ...entry([['218400', 0, 99_900]], { id: 'reversal', reversalOfId: 'mistake' }), // contre-passation: both left out
  ...entry([['274000', 300_000, 0]]), // loan granted
  ...entry([['207000', 1_500_000, 0]]), // goodwill bought
]

const REGISTER: RegisterAsset[] = [
  { id: 'car', label: 'Utilitaire', assetAccountCode: '218200', depreciationAccountCode: '281820', grossCents: 2_000_000, acquisitionDate: '2026-03-01', disposalDate: null, depreciationAtStartCents: 0, depreciationAtEndCents: 400_000 },
  { id: 'pc1', label: 'Ordinateur vendu', assetAccountCode: '218300', depreciationAccountCode: '281830', grossCents: 120_000, acquisitionDate: '2024-01-01', disposalDate: '2026-06-30', depreciationAtStartCents: 40_000, depreciationAtEndCents: 40_000 },
  { id: 'pc2', label: 'Serveur', assetAccountCode: '218300', depreciationAccountCode: '281830', grossCents: 180_000, acquisitionDate: '2023-01-01', disposalDate: null, depreciationAtStartCents: 60_000, depreciationAtEndCents: 120_000 },
]

const input = (patch: Partial<Parameters<typeof buildFixedAssetReport>[0]> = {}) => ({
  fiscalYear: { id: 'fy', year: 2026, startDate: '2026-01-01', endDate: '2026-12-31' },
  lines: LINES,
  impairmentCents: 0,
  balanceSheet: { grossCents: 10_480_000, depreciationCents: 520_000 },
  register: REGISTER,
  draftEntries: 0,
  ...patch,
})

describe('account mapping of the forms', () => {
  it('reads 20 to 27 as gross values, never 28, 29, 269 or 279', () => {
    expect(['201000', '218300', '231000', '261000', '274000'].every(isGrossFixedAssetAccount)).toBe(true)
    expect(['281830', '291000', '269000', '279000', '512000'].some(isGrossFixedAssetAccount)).toBe(false)
  })

  it('takes the most specific line: 2135 is an installation of the buildings, 2131 a building, 232 an intangible in progress', () => {
    expect(lineOf(FORM_2054, '213500')?.id).toBe('buildingFixtures')
    expect(lineOf(FORM_2054, '213100')?.id).toBe('buildingsOwn')
    expect(lineOf(FORM_2054, '232000')?.id).toBe('otherIntangible')
    expect(lineOf(FORM_2054, '238000')?.id).toBe('advances')
    expect(lineOf(FORM_2054, '261100')?.id).toBe('otherParticipations')
    expect(lineOf(FORM_2055, '281350')?.id).toBe('buildingFixtures')
    expect(lineOf(FORM_2055, '280700')?.id).toBe('goodwill')
  })
})

describe('2054-SD of the worked example', () => {
  const report = buildFixedAssetReport(input())
  const at = (id: string, column: Parameters<typeof amountOf>[2]) => amountOf(report.form2054, id, column as never)

  it('splits opening, revaluation, acquisitions and transfers, transfers out and disposals by line', () => {
    expect(report.form2054.find((r) => r.id === 'land')).toMatchObject({ codes: { opening: 'KG', revaluation: 'KH', closing: 'LY' }, amounts: { opening: 5_000_000, revaluation: 1_000_000, increase: 0, closing: 6_000_000, origin: null } })
    expect(at('office', 'opening')).toBe(300_000)
    expect(at('office', 'disposal')).toBe(120_000)
    expect(at('office', 'closing')).toBe(180_000)
    expect(at('transport', 'increase')).toBe(2_000_000)
    expect(at('inProgress', 'increase')).toBe(500_000)
    expect(at('inProgress', 'transferOut')).toBe(500_000)
    expect(at('inProgress', 'closing')).toBe(0)
    expect(at('equipment', 'increase')).toBe(500_000)
    expect(at('otherIntangible', 'increase')).toBe(1_500_000)
    expect(at('loans', 'closing')).toBe(300_000)
  })

  it('leaves out an acquisition and its contre-passation of the same year', () => {
    expect(report.form2054.flatMap((r) => r.accounts)).not.toContain('218400')
  })

  it('totals: the gross value at the end is the algebraic sum of the columns (PCG art. 832-1)', () => {
    const total = report.form2054.find((r) => r.id === 'grandTotal')!
    expect(total.codes).toMatchObject({ opening: '0G', closing: '0L' })
    expect(total.amounts).toMatchObject({ opening: 5_300_000, revaluation: 1_000_000, increase: 4_800_000, transferOut: 500_000, disposal: 120_000, closing: 10_480_000 })
    expect(at('tangibleTotal', 'closing')).toBe(6_000_000 + 500_000 + 2_000_000 + 180_000)
    expect(at('financialTotal', 'closing')).toBe(300_000)
  })

  it('reconciles with the balance sheet and gives the annexe its rubriques', () => {
    expect(report.checks.find((c) => c.id === 'balance-sheet-gross')).toMatchObject({ booksCents: 10_480_000, otherCents: 10_480_000, ok: true })
    expect(report.rubriques.map((r) => [r.rubrique, r.openingCents, r.increaseCents, r.decreaseCents, r.closingCents])).toEqual([
      ['intangible', 0, 1_500_000, 0, 1_500_000],
      ['tangible', 5_300_000, 4_000_000, 620_000, 8_680_000],
      ['financial', 0, 300_000, 0, 300_000],
    ])
  })
})

describe('2055-SD and 2033-C-SD of the worked example', () => {
  const report = buildFixedAssetReport(input())

  it('2055: depreciation at the start, allowances, items that left, at the end', () => {
    expect(report.form2055.find((r) => r.id === 'office')?.amounts).toEqual({ opening: 100_000, allowance: 60_000, decrease: 40_000, closing: 120_000 })
    expect(report.form2055.find((r) => r.id === 'transport')).toMatchObject({ codes: { allowance: 'QI' }, amounts: { allowance: 400_000, closing: 400_000 } })
    expect(report.form2055.find((r) => r.id === 'grandTotal')?.amounts).toEqual({ opening: 100_000, allowance: 460_000, decrease: 40_000, closing: 520_000 })
    expect(report.checks.find((c) => c.id === 'balance-sheet-depreciation')).toMatchObject({ booksCents: 520_000, ok: true })
  })

  it('2033-C: goodwill apart, revaluations in the increases, transfers in the decreases', () => {
    const rows = Object.fromEntries(report.form2033c.assets.map((r) => [r.id, r.amounts]))
    expect(rows.goodwill).toEqual({ opening: 0, increase: 1_500_000, decrease: 0, closing: 1_500_000 })
    expect(rows.otherIntangible.closing).toBe(0)
    expect(rows.land).toEqual({ opening: 5_000_000, increase: 1_000_000, decrease: 0, closing: 6_000_000 })
    expect(rows.otherTangible).toEqual({ opening: 300_000, increase: 500_000, decrease: 620_000, closing: 180_000 })
    expect(rows.grandTotal.closing).toBe(10_480_000)
    expect(report.form2033c.assets.find((r) => r.id === 'grandTotal')?.codes).toEqual({ opening: '490', increase: '492', decrease: '494', closing: '496' })
    const dep = Object.fromEntries(report.form2033c.depreciation.map((r) => [r.id, r.amounts]))
    expect(dep.otherTangible).toEqual({ opening: 100_000, allowance: 60_000, decrease: 40_000, closing: 120_000 })
    expect(dep.grandTotal.closing).toBe(520_000)
  })

  it('agrees with the register line by line', () => {
    expect(report.checks.filter((c) => !c.ok)).toEqual([])
    expect(report.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['register-acquisitions-transport', 'register-disposals-office', 'register-allowance-office', 'register-depreciation-transport']))
  })
})

describe('differences are reported, never corrected', () => {
  it('names the line and the gap when the register misses an acquisition or the balance sheet differs', () => {
    const report = buildFixedAssetReport(input({ register: REGISTER.filter((a) => a.id !== 'car'), balanceSheet: { grossCents: 10_000_000, depreciationCents: 600_000 }, impairmentCents: 80_000 }))
    const failed = report.checks.filter((c) => !c.ok).map((c) => c.id)
    expect(failed).toContain('balance-sheet-gross')
    expect(failed).not.toContain('balance-sheet-depreciation')
    expect(report.checks.find((c) => c.id === 'balance-sheet-gross')?.message).toMatch(/diffère de 4\s?800,00 €/)
    // No register asset on the transport line any more: that line is not checked
    expect(failed.some((id) => id.endsWith('transport'))).toBe(false)
  })

  it('reports an allowance not booked and an empty register', () => {
    const missing = buildFixedAssetReport(input({ lines: LINES.filter((l) => l.code !== '281820') }))
    expect(missing.checks.find((c) => c.id === 'register-allowance-transport')).toMatchObject({ ok: false, booksCents: 0, otherCents: 400_000 })
    expect(missing.checks.find((c) => c.id === 'register-allowance-transport')?.message).toMatch(/générez les dotations manquantes/)
    const empty = buildFixedAssetReport(input({ register: [], draftEntries: 2 }))
    expect(empty.warnings.join(' ')).toMatch(/Aucune immobilisation dans le registre/)
    expect(empty.warnings.join(' ')).toMatch(/2 écritures en brouillon/)
  })

  it('says when the balance sheet has no Actif immobilisé line', () => {
    const report = buildFixedAssetReport(input({ balanceSheet: null }))
    expect(report.checks.some((c) => c.id.startsWith('balance-sheet'))).toBe(false)
    expect(report.warnings[0]).toMatch(/case BJ/)
  })
})
