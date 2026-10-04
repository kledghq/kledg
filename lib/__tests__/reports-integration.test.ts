/**
 * Integration tests for PCG 2026 report calculations.
 *
 * A small in-memory ledger is served through a mocked Prisma client and run
 * through the real getAllAccountBalances, generateBalanceSheet and
 * generateIncomeStatement services.
 *
 * Ledger (fiscal year 2026):
 *   1. Apport en capital      512 D 10000 / 101 C 10000
 *   2. Achat immobilisation   211 D  8000 / 512 C  8000
 *   3. Dotation amortissement 6811 D 2000 / 2811 C 2000
 *   4. Vente                  512 D  5000 / 701 C  5000
 *
 * Expected: résultat = 5000 - 2000 = 3000
 *   Actif  = immobilisations nettes 6000 + banque 7000 = 13000
 *   Passif = capital 10000 + résultat 3000            = 13000
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../prisma', () => ({
  prisma: {
    account: { findMany: vi.fn() },
    // Account totals are summed by PostgreSQL (lib/reports/ledger/aggregate.ts):
    // the mock aggregates the in-memory ledger the same way, in cents.
    $queryRaw: vi.fn(),
    fiscalYear: { findUnique: vi.fn(), findFirst: vi.fn() },
    balanceSheetLineConfig: { findMany: vi.fn() },
    incomeStatementLineConfig: { findMany: vi.fn() },
  },
}))

// Only reached when the bilan is unbalanced, which would itself fail the test.

import { Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { getAllAccountBalances, generateBalanceSheet } from '../reports/index'
import { generateIncomeStatement } from '../reports/income-statement/generate-income-statement.service'
import type { BalanceSheetLine } from '../reports/balance-sheet/types'

const companyId = 'test-company-id'
const fiscalYearId = 'fy-2026'

const accounts = [
  { id: 'acc-101', code: '101', label: 'Capital' },
  { id: 'acc-211', code: '211', label: 'Terrains' },
  { id: 'acc-2811', code: '2811', label: 'Amortissements des terrains' },
  { id: 'acc-512', code: '512', label: 'Banque' },
  { id: 'acc-6811', code: '6811', label: 'Dotations aux amortissements' },
  { id: 'acc-701', code: '701', label: 'Ventes de produits finis' },
].map((a) => ({ ...a, companyId, fiscalYearId }))

function line(accountId: string, debit: number, credit: number) {
  return {
    accountId,
    debit,
    credit,
    accountFiscalYearId: fiscalYearId,
    accountingEntry: { journal: { code: 'OD' }, reference: null },
  }
}

const entryLines = [
  line('acc-512', 10000, 0),
  line('acc-101', 0, 10000),
  line('acc-211', 8000, 0),
  line('acc-512', 0, 8000),
  line('acc-6811', 2000, 0),
  line('acc-2811', 0, 2000),
  line('acc-512', 5000, 0),
  line('acc-701', 0, 5000),
]

const baseConfig = {
  companyId,
  reportVariant: 'complete',
  parentId: null,
  formCode: null,
  excludedAccountCodes: [],
  filterType: 'starts_with',
  filterValue: null,
  hideLabel: false,
  notes: null,
  version: 1,
  templateId: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const balanceSheetConfig = [
  {
    ...baseConfig,
    id: 'bs-immo',
    section: 'actif',
    lineLabel: 'Immobilisations corporelles',
    lineType: 'line',
    accountCodes: ['21'],
    amortissementAccountCodes: ['281'],
    balanceType: 'debit',
    displayType: 'brut_amort_net',
    order: 1,
  },
  {
    ...baseConfig,
    id: 'bs-dispo',
    section: 'actif',
    lineLabel: 'Disponibilités',
    lineType: 'line',
    accountCodes: ['512'],
    amortissementAccountCodes: [],
    balanceType: 'debit',
    displayType: 'net',
    order: 2,
  },
  {
    ...baseConfig,
    id: 'bs-capital',
    section: 'passif',
    lineLabel: 'Capital',
    lineType: 'line',
    accountCodes: ['101'],
    amortissementAccountCodes: [],
    balanceType: 'credit',
    displayType: 'net',
    order: 60,
  },
  {
    ...baseConfig,
    id: 'bs-resultat',
    section: 'passif',
    lineLabel: "Résultat de l'exercice",
    lineType: 'line',
    formCode: 'DI',
    accountCodes: ['12'],
    amortissementAccountCodes: [],
    balanceType: 'credit',
    displayType: 'net',
    order: 61,
  },
]

const incomeStatementConfig = [
  { ...baseConfig, id: 'is-produits', section: 'produits', lineLabel: 'Produits', accountCodes: [], balanceType: 'auto', filterType: null, order: 1 },
  { ...baseConfig, id: 'is-ventes', parentId: 'is-produits', section: 'produits', lineLabel: 'Ventes', accountCodes: ['70'], balanceType: 'credit', order: 2 },
  { ...baseConfig, id: 'is-charges', section: 'charges', lineLabel: 'Charges', accountCodes: [], balanceType: 'auto', filterType: null, order: 50 },
  { ...baseConfig, id: 'is-dotations', parentId: 'is-charges', section: 'charges', lineLabel: 'Dotations', accountCodes: ['681'], balanceType: 'debit', order: 51 },
]

function findLine(lines: BalanceSheetLine[], id: string): BalanceSheetLine | null {
  for (const l of lines) {
    if (l.id === id) return l
    const found = l.children ? findLine(l.children, id) : null
    if (found) return found
  }
  return null
}

describe("Tests d'intégration - Calculs comptables PCG 2026", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const fiscalYear = {
      id: fiscalYearId,
      companyId,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    }
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue(fiscalYear as never)
    vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue(fiscalYear as never)
    vi.mocked(prisma.account.findMany).mockResolvedValue(accounts as never)
    vi.mocked(prisma.$queryRaw).mockImplementation((async () => {
      const totals = new Map<string, { debit: bigint; credit: bigint }>()
      for (const l of entryLines) {
        const t = totals.get(l.accountId) ?? { debit: BigInt(0), credit: BigInt(0) }
        t.debit += BigInt(l.debit * 100)
        t.credit += BigInt(l.credit * 100)
        totals.set(l.accountId, t)
      }
      return [...totals].map(([accountId, t]) => ({ accountId, ...t }))
    }) as never)
    vi.mocked(prisma.balanceSheetLineConfig.findMany).mockResolvedValue(balanceSheetConfig as never)
    vi.mocked(prisma.incomeStatementLineConfig.findMany).mockResolvedValue(incomeStatementConfig as never)
  })

  describe('getAllAccountBalances', () => {
    it('devrait calculer les soldes par compte (solde = débit - crédit)', async () => {
      const balances = await getAllAccountBalances(companyId, undefined, fiscalYearId)

      const byCode = Object.fromEntries(balances.map((b) => [b.code, b]))
      expect(byCode['211'].balance).toBe(8000)
      expect(byCode['2811'].credit).toBe(2000)
      expect(byCode['2811'].balance).toBe(-2000)
      expect(byCode['512'].balance).toBe(7000) // 10000 - 8000 + 5000
      expect(byCode['101'].balance).toBe(-10000)
    })

    it("devrait filtrer les écritures validées sur la période et l'exercice", async () => {
      const period = { startDate: new Date('2026-02-01'), endDate: new Date('2026-02-28') }

      await getAllAccountBalances(companyId, period)

      expect(prisma.fiscalYear.findFirst).toHaveBeenCalled()
      const [strings, ...values] = vi.mocked(prisma.$queryRaw).mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]]
      const query = Prisma.sql(strings, ...values)
      expect(query.text).toContain(`l."accountFiscalYearId" = $1`)
      expect(query.text).toContain(`e."status" = 'validated'`)
      expect(query.text).toContain(`e."fiscalYearId" = $3`)
      expect(query.values.slice(0, 3)).toEqual([fiscalYearId, companyId, fiscalYearId])
      // The period, as UTC calendar day bounds
      expect(query.values).toContain('2026-02-01T00:00:00.000')
      expect(query.values).toContain('2026-02-28T23:59:59.999')
    })

    it("devrait retourner une liste vide sans exercice fiscal", async () => {
      vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue(null)

      const balances = await getAllAccountBalances(companyId, {
        startDate: new Date('2030-01-01'),
        endDate: new Date('2030-12-31'),
      })

      expect(balances).toEqual([])
    })
  })

  describe('generateIncomeStatement', () => {
    it('devrait calculer correctement le compte de résultat', async () => {
      const incomeStatement = await generateIncomeStatement(companyId, fiscalYearId)

      expect(incomeStatement.totalProduits).toBe(5000)
      expect(incomeStatement.totalCharges).toBe(2000)
      expect(incomeStatement.netResult).toBe(3000)
    })
  })

  describe('generateBalanceSheet', () => {
    it('devrait générer un bilan équilibré avec le résultat en capitaux propres', async () => {
      const balanceSheet = await generateBalanceSheet(companyId, fiscalYearId)

      const immo = findLine(balanceSheet.actif.lines, 'bs-immo')
      expect(immo?.brut).toBe(8000)
      expect(immo?.amortissements).toBe(2000)
      expect(immo?.net).toBe(6000)
      expect(findLine(balanceSheet.actif.lines, 'bs-dispo')?.net).toBe(7000)

      expect(findLine(balanceSheet.passif.lines, 'bs-capital')?.net).toBe(10000)
      expect(findLine(balanceSheet.passif.lines, 'bs-resultat')?.net).toBe(3000)

      expect(balanceSheet.actifTotal).toBe(13000)
      expect(balanceSheet.passifTotal).toBe(13000)
      expect(balanceSheet.diagnostic).toBeUndefined()
    })
  })
})
