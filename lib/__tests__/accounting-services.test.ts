import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generateNextEntryNumber, calculateAccountBalance } from '../accounting/services'
import {
  isProvisionalEntryNumber,
  maxSequentialPart,
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

  describe('generateNextEntryNumber', () => {
    const mockFiscalYearId = 'fiscal-year-1'

    it('devrait retourner "1" si aucune écriture n\'existe', async () => {
      db.accountingEntry.findMany.mockResolvedValue([])

      const number = await generateNextEntryNumber('company-1', mockFiscalYearId)

      expect(number).toBe('1')
    })

    it('devrait incrémenter le numéro de la dernière écriture', async () => {
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: '3' },
      ])

      const number = await generateNextEntryNumber('company-1', mockFiscalYearId)

      // Le service extrait "3", l'incrémente à 4
      expect(number).toBe('4')
    })

    it('devrait trouver le numéro maximum parmi plusieurs écritures', async () => {
      // Test pour vérifier que le tri numérique fonctionne correctement
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: '1' },
        { entryNumber: '10' },
        { entryNumber: '2' },
        { entryNumber: '100' },
      ])

      const number = await generateNextEntryNumber('company-1', mockFiscalYearId)

      // Le service doit trouver le maximum numérique (100) et l'incrémenter à 101
      expect(number).toBe('101')
    })

    it('ignores legacy timestamp numbers (TR-<timestamp>) instead of jumping to them', async () => {
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: '1' },
        { entryNumber: 'TR-1727000000000' },
        { entryNumber: '1727000000' },
        { entryNumber: '2' },
        { entryNumber: 'AN-0007' },
      ])

      expect(await generateNextEntryNumber('company-1', mockFiscalYearId)).toBe('8')
    })

    it('starts at 1 when only legacy timestamp numbers exist', async () => {
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: 'TR-1727000000000' },
        { entryNumber: 'sans numéro' },
      ])

      expect(await generateNextEntryNumber('company-1', mockFiscalYearId)).toBe('1')
    })

    it('reads the sequential part of entry numbers', () => {
      expect(sequentialPartOf('42')).toBe(42)
      expect(sequentialPartOf('2026-2')).toBe(2)
      expect(sequentialPartOf('OD-0042')).toBe(42)
      expect(sequentialPartOf('999999999')).toBe(999999999)
      expect(sequentialPartOf('1000000000')).toBeNull()
      expect(sequentialPartOf('TR-1727000000000')).toBeNull()
      expect(sequentialPartOf('OD')).toBeNull()
    })

    it('devrait gérer les numéros avec format personnalisé', async () => {
      // Le service extrait le dernier nombre dans le format (le numéro séquentiel)
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: '2026-2' },
      ])

      const number = await generateNextEntryNumber('company-1', mockFiscalYearId)

      // Le service extrait le dernier nombre (2) et l'incrémente à 3
      expect(number).toBe('3')
    })

    it('devrait gérer les formats avec préfixe', async () => {
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: 'OD-42' },
        { entryNumber: 'OD-1' },
      ])

      const number = await generateNextEntryNumber('company-1', mockFiscalYearId)

      // Le service doit trouver le maximum (42) et l'incrémenter à 43
      expect(number).toBe('43')
    })

    it('devrait gérer les anciens formats avec zéros à gauche', async () => {
      // Pour la compatibilité avec les anciennes écritures qui ont des zéros
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: '001' },
        { entryNumber: '002' },
        { entryNumber: '010' },
      ])

      const number = await generateNextEntryNumber('company-1', mockFiscalYearId)

      // Le service doit extraire 1, 2, 10, trouver le max (10) et retourner "11"
      expect(number).toBe('11')
    })

    it('devrait retourner "1" si le numéro est invalide', async () => {
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: 'invalid' },
      ])

      const number = await generateNextEntryNumber('company-1', mockFiscalYearId)

      expect(number).toBe('1')
    })

    it('devrait utiliser une numérotation par exercice fiscal', async () => {
      // Les numéros d'écriture sont uniques par exercice fiscal
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: '1' }, // Journal OD
        { entryNumber: '2' }, // Journal AC
        { entryNumber: '3' }, // Journal BQ
        { entryNumber: '10' }, // Journal VT
      ])

      const number = await generateNextEntryNumber('company-1', mockFiscalYearId)

      // Le service doit trouver le maximum pour cet exercice (10) et l'incrémenter à 11
      expect(number).toBe('11')
    })
  })

  describe('numbering at validation', () => {
    it('drafts get a provisional number, never part of the sequence', () => {
      const n = provisionalEntryNumber()
      expect(n).toMatch(/^BR-[0-9A-F]{12}$/)
      expect(isProvisionalEntryNumber(n)).toBe(true)
      expect(sequentialPartOf(n)).toBeNull()
      expect(sequentialPartOf('BR-000000000042')).toBeNull()
      expect(maxSequentialPart(['1', 'BR-000000000099', '2'])).toBe(2)
    })

    it('the next definitive number only counts validated entries of the fiscal year', async () => {
      db.accountingEntry.findMany.mockResolvedValue([{ entryNumber: '1' }, { entryNumber: '2' }])
      expect(await nextDefinitiveEntryNumber('fiscal-year-1')).toBe('3')
      expect(db.accountingEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { fiscalYearId: 'fiscal-year-1', status: 'validated' } })
      )
    })

    it('keeps ignoring legacy timestamp numbers for definitive numbers', async () => {
      db.accountingEntry.findMany.mockResolvedValue([
        { entryNumber: '41' },
        { entryNumber: 'TR-1727000000000' },
        { entryNumber: '1727000000000' },
      ])
      expect(await nextDefinitiveEntryNumber('fiscal-year-1')).toBe('42')
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
