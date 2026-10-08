/**
 * Updating a fixed asset (lib/fixed-assets/update-fixed-asset.service.ts):
 * only the fields sent change, amounts are exact cents (Decimal(15, 2)),
 * rates, durations and coefficients are decimals ("33,33" accepted), and the
 * asset and its accounts must belong to the company. The acquisition value
 * is the cost of the asset (PCG art. 213-8), required once set.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', async () => (await import('@/lib/__tests__/helpers/prisma-mock')).prismaModuleMock())

import { prisma } from '@/lib/prisma'
import { asPrismaMock } from '@/lib/__tests__/helpers/prisma-mock'
import { fixedAssetUpdateData, updateFixedAsset } from '@/lib/fixed-assets/update-fixed-asset.service'

const db = asPrismaMock(prisma)

describe('fixedAssetUpdateData', () => {
  it('changes nothing for an empty input', () => {
    expect(fixedAssetUpdateData({})).toEqual({})
  })

  it('reads amounts as exact cents (Decimal(15, 2))', () => {
    expect(fixedAssetUpdateData({ acquisitionValue: '1234.56', amortizableAmount: '1000.1' })).toEqual({
      acquisitionValue: '1234.56',
      amortizableAmount: '1000.10',
    })
  })

  it('clears an optional amount sent empty or 0', () => {
    expect(fixedAssetUpdateData({ amortizableAmount: '' })).toEqual({ amortizableAmount: null })
    expect(fixedAssetUpdateData({ amortizableAmount: 0 })).toEqual({ amortizableAmount: null })
  })

  it('refuses an acquisition value that is empty, negative or has three decimals', () => {
    expect(() => fixedAssetUpdateData({ acquisitionValue: '' })).toThrow("Valeur d'acquisition : montant invalide (deux décimales au plus)")
    expect(() => fixedAssetUpdateData({ acquisitionValue: '-5' })).toThrow("Valeur d'acquisition : montant invalide (deux décimales au plus)")
    expect(() => fixedAssetUpdateData({ acquisitionValue: '10.001' })).toThrow("Valeur d'acquisition : montant invalide (deux décimales au plus)")
  })

  it('reads rates and coefficients as decimals and truncates the duration to whole years', () => {
    expect(fixedAssetUpdateData({ depreciationRate: '33,33', depreciationDuration: '5.9', decliningCoefficient: '1,75' })).toEqual({
      depreciationRate: 33.33,
      depreciationDuration: 5,
      decliningCoefficient: 1.75,
    })
    expect(fixedAssetUpdateData({ depreciationRate: '', depreciationDuration: null, decliningCoefficient: '' })).toEqual({
      depreciationRate: null,
      depreciationDuration: null,
      decliningCoefficient: null,
    })
    expect(() => fixedAssetUpdateData({ depreciationRate: 'vingt' })).toThrow("Taux d'amortissement invalide")
  })

  it('trims the label and refuses an empty one', () => {
    expect(fixedAssetUpdateData({ label: '  Fourgon  ', comment: '' })).toEqual({ label: 'Fourgon', comment: null })
    expect(() => fixedAssetUpdateData({ label: '   ' })).toThrow('Le libellé est requis')
  })

  it('checks the method and reads the dates', () => {
    expect(fixedAssetUpdateData({ depreciationMethod: 'declining' })).toEqual({ depreciationMethod: 'declining' })
    expect(() => fixedAssetUpdateData({ depreciationMethod: 'fast' })).toThrow("Mode d'amortissement invalide : linear, declining ou none.")
    expect(fixedAssetUpdateData({ acquisitionDate: '2025-03-15', depreciationStartDate: '2025-04-01', disposalDate: '' })).toEqual({
      acquisitionDate: new Date('2025-03-15T00:00:00.000Z'),
      depreciationStartDate: new Date('2025-04-01T00:00:00.000Z'),
      disposalDate: null,
    })
    expect(() => fixedAssetUpdateData({ acquisitionDate: '' })).toThrow("Date d'acquisition invalide")
    expect(() => fixedAssetUpdateData({ disposalDate: 'demain' })).toThrow('Date de cession invalide')
  })

  it('keeps flags and account ids only when sent', () => {
    expect(fixedAssetUpdateData({ isFullyPaid: false, isActive: true, assetAccountId: 'a', depreciationAccountId: '', expenseAccountId: 'e' })).toEqual({
      isFullyPaid: false,
      isActive: true,
      assetAccountId: 'a',
      expenseAccountId: 'e',
    })
  })
})

describe('updateFixedAsset', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates the asset of the company with the parsed fields', async () => {
    db.fixedAsset.findFirst.mockResolvedValue({ id: 'fa-1' })
    db.account.count.mockResolvedValue(2)
    db.fixedAsset.update.mockResolvedValue({ id: 'fa-1', label: 'Fourgon' })

    const result = await updateFixedAsset('company-1', 'fa-1', { label: 'Fourgon', acquisitionValue: '24000', assetAccountId: 'acc-2154', expenseAccountId: 'acc-6811' })

    expect(result).toEqual({ id: 'fa-1', label: 'Fourgon' })
    expect(db.fixedAsset.findFirst.mock.calls[0][0]?.where).toEqual({ id: 'fa-1', companyId: 'company-1' })
    expect(db.account.count.mock.calls[0][0]?.where).toEqual({ id: { in: ['acc-2154', 'acc-6811'] }, companyId: 'company-1' })
    const update = db.fixedAsset.update.mock.calls[0][0]
    expect(update?.where).toEqual({ id: 'fa-1' })
    expect(update?.data).toEqual({ label: 'Fourgon', acquisitionValue: '24000.00', assetAccountId: 'acc-2154', expenseAccountId: 'acc-6811' })
  })

  it('answers 404 for an asset of another company', async () => {
    db.fixedAsset.findFirst.mockResolvedValue(null)
    await expect(updateFixedAsset('company-1', 'fa-x', { label: 'X' })).rejects.toMatchObject({ statusCode: 404 })
    expect(db.fixedAsset.update).not.toHaveBeenCalled()
  })

  it('answers 404 when an account belongs to another company', async () => {
    db.fixedAsset.findFirst.mockResolvedValue({ id: 'fa-1' })
    db.account.count.mockResolvedValue(0)
    await expect(updateFixedAsset('company-1', 'fa-1', { assetAccountId: 'foreign' })).rejects.toMatchObject({ statusCode: 404, message: 'Compte introuvable' })
    expect(db.fixedAsset.update).not.toHaveBeenCalled()
  })
})
