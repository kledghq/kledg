/**
 * Result of the balance sheet against the income statement (PCG art. 821-1
 * and 821-3), with both statements mocked: a gap is reported in French with
 * both results and the difference, compared in cents, and the warnings of
 * both statements are passed on. The matching case on real entries is in
 * lib/reports/__tests__/statement-exports.db.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/reports/balance-sheet/generate-balance-sheet.service', () => ({ generateBalanceSheet: vi.fn() }))
vi.mock('@/lib/reports/income-statement/generate-income-statement.service', () => ({ generateIncomeStatement: vi.fn() }))

import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import { generateIncomeStatement } from '@/lib/reports/income-statement/generate-income-statement.service'
import { validateBalanceSheetAgainstIncomeStatement } from '@/lib/reports/balance-sheet/validate-income-statement.service'
import type { BalanceSheetData } from '@/lib/reports/balance-sheet/types'
import type { IncomeStatementData } from '@/lib/reports/income-statement/types'

const generatedAt = new Date('2026-01-15T10:00:00.000Z')
const section = { label: '', lines: [], total: 0, netTotal: 0 }

function balanceSheet(extra: Partial<BalanceSheetData>): BalanceSheetData {
  return { companyId: 'c', fiscalYearId: 'fy', reportVariant: 'complete', actif: section, passif: section, actifTotal: 0, passifTotal: 0, generatedAt, ...extra }
}

function incomeStatement(extra: Partial<IncomeStatementData>): IncomeStatementData {
  return {
    companyId: 'c',
    fiscalYearId: 'fy',
    reportVariant: 'complete',
    produits: { label: '', lines: [], total: 0 },
    charges: { label: '', lines: [], total: 0 },
    totalProduits: 0,
    totalCharges: 0,
    netResult: 0,
    generatedAt,
    ...extra,
  }
}

describe('validateBalanceSheetAgainstIncomeStatement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports the gap between both results in French, in cents', async () => {
    vi.mocked(generateBalanceSheet).mockResolvedValue(balanceSheet({ netResult: 1100.1, warnings: ['Compte 471000 non rattaché'] }))
    vi.mocked(generateIncomeStatement).mockResolvedValue(incomeStatement({ netResult: 1000, warnings: ['Compte 791000 non rattaché'] }))

    const result = await validateBalanceSheetAgainstIncomeStatement('c', 'fy', 'simplified')
    expect(vi.mocked(generateBalanceSheet)).toHaveBeenCalledWith('c', 'fy', 'simplified')
    expect(vi.mocked(generateIncomeStatement)).toHaveBeenCalledWith('c', 'fy', 'simplified')
    expect(result).toEqual({
      balanceSheetResult: 1100.1,
      incomeStatementResult: 1000,
      matches: false,
      difference: 100.1,
      errors: ['Le résultat du bilan (1 100,10 €) ne correspond pas au résultat du compte de résultat (1 000,00 €). Écart : 100,10 €'],
      warnings: ['Compte 471000 non rattaché', 'Compte 791000 non rattaché'],
    })
  })

  it('matches results equal to the cent despite float noise, and reads a missing result as 0', async () => {
    vi.mocked(generateBalanceSheet).mockResolvedValue(balanceSheet({ netResult: 0.1 + 0.2 }))
    vi.mocked(generateIncomeStatement).mockResolvedValue(incomeStatement({ netResult: 0.3 }))
    expect(await validateBalanceSheetAgainstIncomeStatement('c', 'fy')).toMatchObject({ matches: true, difference: 0, errors: [] })

    vi.mocked(generateBalanceSheet).mockResolvedValue(balanceSheet({}))
    vi.mocked(generateIncomeStatement).mockResolvedValue(incomeStatement({ netResult: -250 }))
    expect(await validateBalanceSheetAgainstIncomeStatement('c', 'fy')).toMatchObject({
      balanceSheetResult: 0,
      matches: false,
      difference: 250,
      errors: ['Le résultat du bilan (0,00 €) ne correspond pas au résultat du compte de résultat (-250,00 €). Écart : 250,00 €'],
    })
  })
})
