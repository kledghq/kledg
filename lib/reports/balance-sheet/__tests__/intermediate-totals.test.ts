/**
 * Tests for intermediate totals calculation in balance sheet
 *
 * Intermediate totals are configs with lineType 'sum'. Their value is the sum
 * of the net values of their DIRECT children (linked via parentId), computed
 * deepest first so nested sums roll up correctly. Groups organize lines and
 * display their children's subtotal.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateBalanceSheet } from '../generate-balance-sheet.service'
import { prisma } from '@/lib/prisma'
import { getAllAccountBalances } from '@/lib/reports/account-balances'
import type { BalanceSheetLine, BalanceSheetLineConfig } from '../types'
import type { AccountBalance } from '@/lib/reports/types'

vi.mock('@/lib/reports/account-balances', () => ({
  getAllAccountBalances: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    balanceSheetLineConfig: {
      findMany: vi.fn(),
    },
    fiscalYear: {
      findUnique: vi.fn(),
    },
    // The fixtures only describe an actif side, so the sheet is unbalanced on
    // purpose: the diagnostic looks for unbalanced entries and finds none.
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}))

const companyId = 'test-company-id'
const fiscalYearId = 'test-fiscal-year-id'

function cfg(
  partial: Pick<BalanceSheetLineConfig, 'id' | 'lineLabel' | 'lineType' | 'order'> &
    Partial<BalanceSheetLineConfig>
): BalanceSheetLineConfig {
  return {
    companyId,
    reportVariant: 'complete',
    parentId: null,
    section: 'actif',
    formCode: null,
    accountCodes: [],
    excludedAccountCodes: [],
    amortissementAccountCodes: [],
    filterType: partial.lineType === 'line' ? 'starts_with' : null,
    filterValue: null,
    balanceType: partial.lineType === 'line' ? 'debit' : 'auto',
    displayType: 'net',
    hideLabel: false,
    notes: null,
    version: 1,
    templateId: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  }
}

function balance(code: string, debit: number): AccountBalance {
  return {
    accountId: `acc-${code}`,
    code,
    label: code,
    debit,
    credit: 0,
    balance: debit,
  } as AccountBalance
}

function findLine(lines: BalanceSheetLine[], id: string): BalanceSheetLine | null {
  for (const line of lines) {
    if (line.id === id) return line
    if (line.children) {
      const found = findLine(line.children, id)
      if (found) return found
    }
  }
  return null
}

describe('Balance Sheet Intermediate Totals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({
      id: fiscalYearId,
      companyId,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      isClosed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)
  })

  describe('complete version', () => {
    it('should sum direct children of intermediate totals', async () => {
      const config = [
        cfg({ id: 'immo', lineLabel: 'Total actif immobilisé', lineType: 'sum', order: 18 }),
        cfg({ id: 'incorp', parentId: 'immo', lineLabel: 'Total immobilisations incorporelles', lineType: 'sum', order: 6 }),
        cfg({ id: 'frais-dev', parentId: 'incorp', lineLabel: 'Frais de développement', lineType: 'line', accountCodes: ['201'], order: 2 }),
        cfg({ id: 'concessions', parentId: 'incorp', lineLabel: 'Concessions et droits similaires', lineType: 'line', accountCodes: ['203'], order: 3 }),
        cfg({ id: 'corp', parentId: 'immo', lineLabel: 'Total immobilisations corporelles', lineType: 'sum', order: 10 }),
        cfg({ id: 'terrains', parentId: 'corp', lineLabel: 'Terrains', lineType: 'line', accountCodes: ['211'], order: 7 }),
      ]

      vi.mocked(getAllAccountBalances).mockResolvedValue([
        balance('201000', 50000),
        balance('203000', 30000),
        balance('211000', 100000),
      ])
      vi.mocked(prisma.balanceSheetLineConfig.findMany).mockResolvedValue(config as never)

      const result = await generateBalanceSheet(companyId, fiscalYearId, 'complete')

      expect(findLine(result.actif.lines, 'incorp')?.net).toBe(80000) // 50000 + 30000
      expect(findLine(result.actif.lines, 'corp')?.net).toBe(100000)
      expect(findLine(result.actif.lines, 'immo')?.net).toBe(180000) // 80000 + 100000
    })

    it('should not double count leaves through nested totals', async () => {
      const config = [
        cfg({ id: 'immo', lineLabel: 'Total actif immobilisé', lineType: 'sum', order: 18 }),
        cfg({ id: 'incorp', parentId: 'immo', lineLabel: 'Total immobilisations incorporelles', lineType: 'sum', order: 6 }),
        cfg({ id: 'frais-dev', parentId: 'incorp', lineLabel: 'Frais de développement', lineType: 'line', accountCodes: ['201'], order: 2 }),
        cfg({ id: 'corp', parentId: 'immo', lineLabel: 'Total immobilisations corporelles', lineType: 'sum', order: 10 }),
        cfg({ id: 'terrains', parentId: 'corp', lineLabel: 'Terrains', lineType: 'line', accountCodes: ['211'], order: 7 }),
      ]

      vi.mocked(getAllAccountBalances).mockResolvedValue([
        balance('201000', 50000),
        balance('211000', 100000),
      ])
      vi.mocked(prisma.balanceSheetLineConfig.findMany).mockResolvedValue(config as never)

      const result = await generateBalanceSheet(companyId, fiscalYearId, 'complete')

      expect(findLine(result.actif.lines, 'incorp')?.net).toBe(50000)
      expect(findLine(result.actif.lines, 'corp')?.net).toBe(100000)
      expect(findLine(result.actif.lines, 'immo')?.net).toBe(150000) // 50000 + 100000
    })

    it('should display group subtotals without double counting the section total', async () => {
      const config = [
        cfg({ id: 'group', lineLabel: 'Actif immobilisé', lineType: 'group', order: 1 }),
        cfg({ id: 'terrains', parentId: 'group', lineLabel: 'Terrains', lineType: 'line', accountCodes: ['211'], order: 2 }),
      ]

      vi.mocked(getAllAccountBalances).mockResolvedValue([balance('211000', 100000)])
      vi.mocked(prisma.balanceSheetLineConfig.findMany).mockResolvedValue(config as never)

      const result = await generateBalanceSheet(companyId, fiscalYearId, 'complete')

      expect(findLine(result.actif.lines, 'terrains')?.net).toBe(100000)
      // A group shows the sum of its children
      expect(findLine(result.actif.lines, 'group')?.net).toBe(100000)
      expect(result.actif.netTotal).toBe(100000)
    })
  })

  describe('simplified version', () => {
    it('should calculate totals correctly with exclusions', async () => {
      const config = [
        cfg({ id: 'total-1', reportVariant: 'simplified', lineLabel: 'Total I', lineType: 'sum', order: 5 }),
        cfg({ id: 'fonds', reportVariant: 'simplified', parentId: 'total-1', lineLabel: 'Fonds commercial', lineType: 'line', formCode: '010', accountCodes: ['207'], order: 1 }),
        cfg({
          id: 'autres',
          reportVariant: 'simplified',
          parentId: 'total-1',
          lineLabel: 'Autres',
          lineType: 'line',
          formCode: '014',
          accountCodes: ['201', '203', '205', '206', '208'],
          excludedAccountCodes: ['207'],
          order: 2,
        }),
      ]

      vi.mocked(getAllAccountBalances).mockResolvedValue([
        balance('207000', 100000),
        balance('201000', 50000),
      ])
      vi.mocked(prisma.balanceSheetLineConfig.findMany).mockResolvedValue(config as never)

      const result = await generateBalanceSheet(companyId, fiscalYearId, 'simplified')

      expect(findLine(result.actif.lines, 'fonds')?.net).toBe(100000)
      expect(findLine(result.actif.lines, 'autres')?.net).toBe(50000)
      expect(findLine(result.actif.lines, 'total-1')?.net).toBe(150000) // 100000 + 50000
    })
  })
})
