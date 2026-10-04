/**
 * Initial valuation of assets (lib/pcg/assets/initial-valuation.ts): an asset
 * enters the balance sheet at its cost (PCG art. 213-1); the acquisition cost
 * of a tangible asset is the purchase price plus the costs directly
 * attributable to it, dismantling costs included (PCG art. 213-8), borrowing
 * costs when capitalised (PCG art. 213-9); assets acquired free of charge or
 * by exchange enter at their market value (PCG art. 213-1, exchange 213-3).
 */

import { describe, expect, it } from 'vitest'
import { calculateAcquisitionCost, validateAcquisitionCost, type AssetAcquisition } from '../../assets/initial-valuation'

const acquisition = (over: Partial<AssetAcquisition> = {}): AssetAcquisition => ({
  id: 'acq-1',
  assetId: 'asset-1',
  acquisitionType: 'purchase',
  purchasePrice: 20000,
  additionalCosts: 1500,
  totalCost: 21500,
  ...over,
})

describe('calculateAcquisitionCost (PCG art. 213-8)', () => {
  it('adds the directly attributable costs to the purchase price', () => {
    expect(calculateAcquisitionCost(acquisition())).toBe(21500)
  })

  it('adds dismantling, capitalised borrowing and training costs when present', () => {
    expect(calculateAcquisitionCost(acquisition({ dismantlingCosts: 3000, borrowingCosts: 400, trainingCosts: 100 }))).toBe(25000)
    expect(calculateAcquisitionCost(acquisition({ dismantlingCosts: 0, borrowingCosts: undefined }))).toBe(21500)
  })
})

describe('validateAcquisitionCost (PCG art. 213-1)', () => {
  it('accepts a consistent purchase', () => {
    expect(validateAcquisitionCost(acquisition())).toEqual({ valid: true, errors: [], warnings: [] })
  })

  it('refuses a purchase price that is not positive', () => {
    expect(validateAcquisitionCost(acquisition({ purchasePrice: 0, additionalCosts: 0, totalCost: 0 }))).toEqual({
      valid: false,
      errors: ["Le prix d'achat doit être positif pour un actif acquis à titre onéreux"],
      warnings: [],
    })
  })

  it.each([
    ['production', 'Le coût de production doit être positif'],
    ['gift', 'La valeur vénale doit être positive pour un actif acquis à titre gratuit'],
    ['exchange', 'La valeur vénale doit être positive pour un actif acquis par échange'],
    ['contribution', "La valeur du traité d'apport doit être positive"],
  ] as const)('refuses a %s without value', (acquisitionType, error) => {
    const result = validateAcquisitionCost(acquisition({ acquisitionType, purchasePrice: -1, additionalCosts: 0, totalCost: -1 }))
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual([error])
  })

  it('asks to check the market value of a gift and the commercial substance of an exchange (PCG art. 213-3)', () => {
    expect(validateAcquisitionCost(acquisition({ acquisitionType: 'gift' })).warnings).toEqual([
      'Vérifier que la valeur vénale correspond au prix qui aurait été acquitté dans des conditions normales de marché',
    ])
    expect(validateAcquisitionCost(acquisition({ acquisitionType: 'exchange' })).warnings).toEqual([
      "Vérifier que l'échange a une substance commerciale (Art. 213-3)",
    ])
  })

  it('refuses a total that differs from the computed cost by more than a cent', () => {
    expect(validateAcquisitionCost(acquisition({ totalCost: 21000 }))).toEqual({
      valid: false,
      errors: ['Incohérence dans le calcul du coût: calculé 21500, saisi 21000'],
      warnings: [],
    })
  })
})
