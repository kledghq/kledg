import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getActiveRegime,
  getVATRegime,
  getCorporateTaxRegime,
  addTaxRegime,
  getTaxRegimeHistory,
  updateTaxRegime,
  deleteTaxRegime,
  AddTaxRegimeSchema,
  UpdateTaxRegimeSchema,
} from '../tax-regimes'

// Mock Prisma (transactions run their callback on the same mock)
vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'

const db = asPrismaMock(prisma)

describe('Tax Regimes', () => {
  const companyId = 'company-123'
  const date = new Date('2024-01-15')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getActiveRegime', () => {
    it('should return active regime for given date', async () => {
      const mockRegime = {
        id: 'regime-1',
        companyId,
        regimeType: 'vat' as const,
        regime: 'normal',
        startDate: new Date('2024-01-01'),
        endDate: null,
        notes: null,
      }

      db.taxRegimeHistory.findFirst.mockResolvedValue(mockRegime)

      const result = await getActiveRegime(companyId, 'vat', date)

      expect(result).toBe('normal')
      expect(db.taxRegimeHistory.findFirst).toHaveBeenCalledWith({
        where: {
          companyId,
          regimeType: 'vat',
          startDate: { lte: date },
          OR: [{ endDate: null }, { endDate: { gte: date } }],
        },
        orderBy: { startDate: 'desc' },
      })
    })

    it('should return null when no active regime found', async () => {
      db.taxRegimeHistory.findFirst.mockResolvedValue(null)

      const result = await getActiveRegime(companyId, 'vat', date)

      expect(result).toBeNull()
    })

    it('should handle regime with end date', async () => {
      const mockRegime = {
        id: 'regime-1',
        companyId,
        regimeType: 'vat' as const,
        regime: 'simplified',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        notes: null,
      }

      db.taxRegimeHistory.findFirst.mockResolvedValue(mockRegime)

      const result = await getActiveRegime(companyId, 'vat', date)

      expect(result).toBe('simplified')
    })
  })

  describe('getVATRegime', () => {
    it('should return VAT regime', async () => {
      db.taxRegimeHistory.findFirst.mockResolvedValue({
        regime: 'normal',
      })

      const result = await getVATRegime(companyId, date)

      expect(result).toBe('normal')
    })

    it('should return null when no regime found', async () => {
      db.taxRegimeHistory.findFirst.mockResolvedValue(null)

      const result = await getVATRegime(companyId, date)

      expect(result).toBeNull()
    })
  })

  describe('getCorporateTaxRegime', () => {
    it('should return corporate tax regime', async () => {
      db.taxRegimeHistory.findFirst.mockResolvedValue({
        regime: 'simplified',
      })

      const result = await getCorporateTaxRegime(companyId, date)

      expect(result).toBe('simplified')
    })
  })

  describe('addTaxRegime', () => {
    it('closes the open regime on the calendar day before the new one, then creates it', async () => {
      db.taxRegimeHistory.updateMany.mockResolvedValue({ count: 1 })
      db.taxRegimeHistory.create.mockImplementation(async ({ data }) => ({ id: 'regime-2', endDate: null, ...data }))

      const input = AddTaxRegimeSchema.parse({ regimeType: 'vat', regime: 'simplified', startDate: '2024-06-01', notes: 'New regime' })
      const result = await addTaxRegime(companyId, input)

      expect(db.taxRegimeHistory.updateMany).toHaveBeenCalledWith({
        where: { companyId, regimeType: 'vat', endDate: null },
        data: { endDate: new Date('2024-05-31T00:00:00.000Z') },
      })
      expect(db.taxRegimeHistory.create).toHaveBeenCalledWith({
        data: {
          companyId,
          regimeType: 'vat',
          regime: 'simplified',
          startDate: new Date('2024-06-01T00:00:00.000Z'),
          notes: 'New regime',
          isVatExempt: false,
          vatExemptReason: null,
          establishmentId: null,
        },
      })
      expect(result.regime).toBe('simplified')
    })

    it('reads a start date sent as a local midnight timestamp as its calendar day', () => {
      // A date picker in Paris sends 2024-06-01 as 2024-05-31T22:00:00.000Z
      expect(AddTaxRegimeSchema.parse({ regimeType: 'vat', regime: 'normal', startDate: '2024-05-31T22:00:00.000Z' }).startDate).toBe('2024-06-01')
    })

    it('refuses an unknown regime type or an invalid date', () => {
      expect(AddTaxRegimeSchema.safeParse({ regimeType: 'iva', regime: 'normal', startDate: '2024-06-01' }).success).toBe(false)
      expect(AddTaxRegimeSchema.safeParse({ regimeType: 'vat', regime: 'normal', startDate: '2024-02-30' }).success).toBe(false)
    })

    it('refuses an exemption outside VAT or without its reason', async () => {
      await expect(
        addTaxRegime(companyId, AddTaxRegimeSchema.parse({ regimeType: 'corporateTax', regime: 'normal', startDate: '2024-06-01', isVatExempt: true, vatExemptReason: 'x' })),
      ).rejects.toThrow("qu'aux régimes de TVA")
      await expect(
        addTaxRegime(companyId, AddTaxRegimeSchema.parse({ regimeType: 'vat', regime: 'normal', startDate: '2024-06-01', isVatExempt: true })),
      ).rejects.toThrow('raison')
      expect(db.taxRegimeHistory.create).not.toHaveBeenCalled()
    })

    it("refuses an establishment of another company (404)", async () => {
      db.establishment.findFirst.mockResolvedValue(null)
      const input = AddTaxRegimeSchema.parse({ regimeType: 'vat', regime: 'normal', startDate: '2024-06-01', establishmentId: 'est-other' })
      await expect(addTaxRegime(companyId, input)).rejects.toMatchObject({ statusCode: 404 })
      expect(db.establishment.findFirst).toHaveBeenCalledWith({ where: { id: 'est-other', companyId }, select: { id: true } })
      expect(db.taxRegimeHistory.create).not.toHaveBeenCalled()
    })
  })

  describe('getTaxRegimeHistory', () => {
    it('should return tax regime history', async () => {
      const mockHistory = [
        {
          id: 'regime-1',
          companyId,
          regimeType: 'vat',
          regime: 'normal',
          startDate: new Date('2024-01-01'),
          endDate: null,
          notes: null,
        },
      ]

      db.taxRegimeHistory.findMany.mockResolvedValue(mockHistory)

      const result = await getTaxRegimeHistory(companyId, 'vat')

      expect(result).toHaveLength(1)
      expect(result[0].regime).toBe('normal')
      expect(db.taxRegimeHistory.findMany).toHaveBeenCalledWith({
        where: { companyId, regimeType: 'vat' },
        include: {
          establishment: { select: { id: true, siret: true, name: true } },
        },
        orderBy: { startDate: 'desc' },
      })
    })
  })

  describe('updateTaxRegime', () => {
    it('updates a regime of the company with calendar days', async () => {
      const regimeId = 'regime-1'
      db.taxRegimeHistory.findFirst.mockResolvedValue({ id: regimeId, regimeType: 'vat' })
      db.taxRegimeHistory.update.mockResolvedValue({ id: regimeId, regimeType: 'vat', regime: 'simplified' })

      const { id, ...input } = UpdateTaxRegimeSchema.parse({ id: regimeId, regime: 'simplified', endDate: '2024-12-31', notes: 'Updated notes' })
      const result = await updateTaxRegime(companyId, id, input)

      expect(db.taxRegimeHistory.findFirst).toHaveBeenCalledWith({ where: { id: regimeId, companyId }, select: { id: true, regimeType: true } })
      expect(db.taxRegimeHistory.update).toHaveBeenCalledWith({
        where: { id: regimeId },
        data: { regime: 'simplified', endDate: new Date('2024-12-31T00:00:00.000Z'), notes: 'Updated notes' },
      })
      expect(result.regime).toBe('simplified')
    })

    it('clears the end date with null', async () => {
      db.taxRegimeHistory.findFirst.mockResolvedValue({ id: 'r', regimeType: 'vat' })
      db.taxRegimeHistory.update.mockResolvedValue({ id: 'r', regimeType: 'vat' })
      const { id, ...input } = UpdateTaxRegimeSchema.parse({ id: 'r', endDate: null })
      await updateTaxRegime(companyId, id, input)
      expect(db.taxRegimeHistory.update).toHaveBeenCalledWith({ where: { id: 'r' }, data: { endDate: null } })
    })

    it('answers 404 for a regime of another company', async () => {
      db.taxRegimeHistory.findFirst.mockResolvedValue(null)

      await expect(updateTaxRegime(companyId, 'missing', { regime: 'normal' })).rejects.toMatchObject({ statusCode: 404 })
      expect(db.taxRegimeHistory.update).not.toHaveBeenCalled()
    })
  })

  describe('deleteTaxRegime', () => {
    it('only deletes a regime of the company', async () => {
      db.taxRegimeHistory.deleteMany.mockResolvedValue({ count: 0 })
      await expect(deleteTaxRegime(companyId, 'other')).rejects.toMatchObject({ statusCode: 404 })
      expect(db.taxRegimeHistory.deleteMany).toHaveBeenCalledWith({ where: { id: 'other', companyId } })
    })
  })
})
