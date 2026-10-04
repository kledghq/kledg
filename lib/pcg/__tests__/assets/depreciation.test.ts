/**
 * Tests pour les Amortissements (Art. 214-7 à 214-15)
 */

import { describe, it, expect } from 'vitest'
import {
  calculateLinearDepreciation,
  calculateDecliningDepreciation,
  validateDepreciationPlan,
  hasLimitedUsefulLife,
} from '../../assets/depreciation'
import type { DepreciationPlan } from '../../assets/depreciation'

describe('Amortissements (Art. 214-7 à 214-15)', () => {
  describe('calculateLinearDepreciation', () => {
    it('devrait calculer l\'amortissement linéaire correctement', () => {
      const plan: DepreciationPlan = {
        id: '1',
        assetId: 'asset-1',
        method: 'linear',
        usefulLife: 5,
        usefulLifeUnlimited: false,
        residualValue: 0,
        acquisitionCost: 10000,
        startDate: new Date('2024-01-01'),
      }
      
      const asOfDate = new Date('2025-01-01') // 1 an écoulé
      const result = calculateLinearDepreciation(plan, asOfDate)
      
      expect(result.annualDepreciation).toBe(2000) // 10000 / 5
      expect(result.accumulatedDepreciation).toBe(2000)
      expect(result.netBookValue).toBe(8000)
    })
    
    it('devrait gérer la valeur résiduelle', () => {
      const plan: DepreciationPlan = {
        id: '1',
        assetId: 'asset-1',
        method: 'linear',
        usefulLife: 5,
        usefulLifeUnlimited: false,
        residualValue: 2000,
        acquisitionCost: 10000,
        startDate: new Date('2024-01-01'),
      }
      
      const asOfDate = new Date('2025-01-01')
      const result = calculateLinearDepreciation(plan, asOfDate)
      
      expect(result.annualDepreciation).toBe(1600) // (10000 - 2000) / 5
      expect(result.netBookValue).toBe(8400)
    })
    
    it('devrait retourner 0 pour une durée d\'utilisation non limitée', () => {
      const plan: DepreciationPlan = {
        id: '1',
        assetId: 'asset-1',
        method: 'linear',
        usefulLife: 0,
        usefulLifeUnlimited: true,
        residualValue: 0,
        acquisitionCost: 10000,
        startDate: new Date('2024-01-01'),
      }
      
      const asOfDate = new Date('2025-01-01')
      const result = calculateLinearDepreciation(plan, asOfDate)
      
      expect(result.annualDepreciation).toBe(0)
      expect(result.accumulatedDepreciation).toBe(0)
      expect(result.netBookValue).toBe(10000)
    })
  })
  
  describe('calculateDecliningDepreciation', () => {
    it('devrait calculer l\'amortissement dégressif', () => {
      const plan: DepreciationPlan = {
        id: '1',
        assetId: 'asset-1',
        method: 'declining',
        usefulLife: 5,
        usefulLifeUnlimited: false,
        residualValue: 0,
        acquisitionCost: 10000,
        startDate: new Date('2024-01-01'),
      }
      
      const asOfDate = new Date('2025-01-01')
      const result = calculateDecliningDepreciation(plan, asOfDate, 1.75)
      
      // Première année: 10000 * (1/5 * 1.75) = 3500
      expect(result.accumulatedDepreciation).toBeGreaterThan(0)
      expect(result.netBookValue).toBeLessThan(plan.acquisitionCost)
    })
  })
  
  describe('validateDepreciationPlan', () => {
    it('devrait valider un plan d\'amortissement valide', () => {
      const plan: DepreciationPlan = {
        id: '1',
        assetId: 'asset-1',
        method: 'linear',
        usefulLife: 5,
        usefulLifeUnlimited: false,
        residualValue: 0,
        acquisitionCost: 10000,
        startDate: new Date('2024-01-01'),
      }
      
      const result = validateDepreciationPlan(plan)
      
      expect(result.valid).toBe(true)
    })
    
    it('devrait rejeter une valeur résiduelle supérieure au coût d\'acquisition', () => {
      const plan: DepreciationPlan = {
        id: '1',
        assetId: 'asset-1',
        method: 'linear',
        usefulLife: 5,
        usefulLifeUnlimited: false,
        residualValue: 15000,
        acquisitionCost: 10000,
        startDate: new Date('2024-01-01'),
      }
      
      const result = validateDepreciationPlan(plan)
      
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('valeur résiduelle'))).toBe(true)
    })
  })
  
  describe('hasLimitedUsefulLife', () => {
    it('devrait identifier une durée d\'utilisation limitée', () => {
      expect(hasLimitedUsefulLife({
        type: 'tangible',
        expectedLifespan: 5,
        indefiniteUse: false,
      })).toBe(true)
    })
    
    it('devrait identifier une durée d\'utilisation non limitée', () => {
      expect(hasLimitedUsefulLife({
        type: 'tangible',
        indefiniteUse: true,
      })).toBe(false)
    })
  })
})
