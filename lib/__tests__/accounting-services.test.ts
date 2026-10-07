import { describe, it, expect, beforeEach, vi } from 'vitest'
import { calculateAccountBalance } from '../accounting/services'
import {
  isProvisionalEntryNumber,
  nextDefinitiveEntryNumber,
  provisionalEntryNumber,
  sequentialPartOf,
} from '../accounting/services/generate-next-entry-number.service'

// Mock Prisma. $transaction runs the callback against the same mock so the
// services' transactional writes are observable on `db.*`.
vi.mock('../prisma', async () => (await import('./helpers/prisma-mock')).prismaModuleMock())

import { prisma } from '../prisma'
import { asPrismaMock } from './helpers/prisma-mock'

const db = asPrismaMock(prisma)

/** The `{ id, companyId }` filter of a scoped lookup (findOwned). */
function scoped(args: { where?: unknown } | undefined) {
  return (args?.where ?? {}) as { id?: string; companyId?: string }
}

describe('Services Comptables', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Accounts and journals exist only in company-1 (lookups are scoped by company)
    db.account.findFirst.mockImplementation(async (args) => {
      const where = scoped(args)
      return where.companyId === 'company-1'
        ? { fiscalYearId: 'fiscal-year-1', code: where.id === 'account-1' ? '512000' : '401000' }
        : null
    })
    db.journal.findFirst.mockImplementation(async (args) => {
      const where = scoped(args)
      return where.companyId === 'company-1' ? { id: where.id } : null
    })
    db.fiscalYear.findFirst.mockImplementation(async (args) => {
      const where = scoped(args)
      return where.companyId === 'company-1' ? { id: where.id } : null
    })
    db.entryLine.createMany.mockResolvedValue({ count: 2 })
  })

  describe('entry numbering', () => {
    it('reads the sequential part of entry numbers', () => {
      expect(sequentialPartOf('42')).toBe(42)
      expect(sequentialPartOf('2026-2')).toBe(2)
      expect(sequentialPartOf('OD-0042')).toBe(42)
      expect(sequentialPartOf('OD-42')).toBe(42)
      expect(sequentialPartOf('010')).toBe(10)
      expect(sequentialPartOf('999999999')).toBe(999999999)
      expect(sequentialPartOf('1000000000')).toBeNull()
      expect(sequentialPartOf('1727000000')).toBeNull()
      expect(sequentialPartOf('TR-1727000000000')).toBeNull()
      expect(sequentialPartOf('OD')).toBeNull()
      expect(sequentialPartOf('invalid')).toBeNull()
    })

    it('drafts get a provisional number, never part of the sequence', () => {
      const n = provisionalEntryNumber()
      expect(n).toMatch(/^BR-[0-9A-F]{12}$/)
      expect(isProvisionalEntryNumber(n)).toBe(true)
      expect(sequentialPartOf(n)).toBeNull()
      expect(sequentialPartOf('BR-000000000042')).toBeNull()
    })

    it('the next definitive number is one more than the indexed max of the validated entries (one query)', async () => {
      db.$queryRaw.mockResolvedValueOnce([{ max: BigInt(41) }])
      expect(await nextDefinitiveEntryNumber('fiscal-year-1')).toBe('42')
      db.$queryRaw.mockResolvedValueOnce([{ max: null }])
      expect(await nextDefinitiveEntryNumber('fiscal-year-1')).toBe('1')
      expect(db.$queryRaw).toHaveBeenCalledTimes(2)
      expect(db.accountingEntry.findMany).not.toHaveBeenCalled()
    })
  })

  describe('calculateAccountBalance', () => {
    it('devrait calculer le solde cumulé pour le bilan', async () => {
      const mockEntries = [
        {
          id: 'entry-1',
          date: new Date('2026-01-15'),
          lines: [
            { accountId: 'account-1', debit: 1000, credit: 0 },
          ],
        },
        {
          id: 'entry-2',
          date: new Date('2026-02-15'),
          lines: [
            { accountId: 'account-1', debit: 500, credit: 0 },
          ],
        },
      ]

      db.accountingEntry.findMany.mockResolvedValue(mockEntries)

      const balance = await calculateAccountBalance(
        'account-1',
        'company-1',
        {
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        },
        true // cumulative
      )

      expect(balance.debit).toBe(1500)
      expect(balance.credit).toBe(0)
      expect(balance.balance).toBe(1500)
    })

    it('devrait calculer le solde sur période pour le compte de résultat', async () => {
      const mockEntries = [
        {
          id: 'entry-1',
          date: new Date('2026-02-15'),
          lines: [
            { accountId: 'account-1', debit: 1000, credit: 0 },
          ],
        },
      ]

      db.accountingEntry.findMany.mockResolvedValue(mockEntries)

      const balance = await calculateAccountBalance(
        'account-1',
        'company-1',
        {
          startDate: new Date('2026-02-01'),
          endDate: new Date('2026-02-28'),
        },
        false // period-specific
      )

      expect(balance.debit).toBe(1000)
      expect(balance.credit).toBe(0)
      expect(balance.balance).toBe(1000)
    })

    it('devrait exclure les écritures hors période', async () => {
      // Le mock doit retourner un tableau vide car Prisma filtre déjà par période
      db.accountingEntry.findMany.mockResolvedValue([])

      const balance = await calculateAccountBalance(
        'account-1',
        'company-1',
        {
          startDate: new Date('2026-02-01'),
          endDate: new Date('2026-02-28'),
        },
        false
      )

      expect(balance.debit).toBe(0)
      expect(balance.credit).toBe(0)
      expect(balance.balance).toBe(0)
    })
  })
})
