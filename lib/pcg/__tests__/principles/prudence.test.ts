/**
 * Tests pour le principe de Prudence (Art. 121-4)
 */

import { describe, it, expect } from 'vitest'
import {
  validatePrudence,
  recommendProvisions,
  validateImpairments,
} from '../../principles/prudence'
import type { EntryLine } from '@/lib/accounting/types'

describe('Principe de Prudence (Art. 121-4)', () => {
  describe('validatePrudence', () => {
    it('devrait valider une écriture respectant le principe de prudence', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Achat de fournitures',
        lines: [
          { accountId: '601', debit: 500, credit: 0 },
          { accountId: '512', debit: 0, credit: 500 },
        ] as EntryLine[],
      }
      
      const result = validatePrudence(entry)
      
      expect(result.valid).toBe(true)
    })
    
    it('devrait avertir sur un produit constaté d\'avance non justifié', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Produit constaté d\'avance - prestation à réaliser',
        lines: [
          { accountId: '701', debit: 0, credit: 1000 },
          { accountId: '512', debit: 1000, credit: 0 },
        ] as EntryLine[],
      }
      
      const result = validatePrudence(entry)
      
      expect(result.warnings.some(w => w.includes('constaté d\'avance'))).toBe(true)
    })
    
    it('devrait avertir sur une charge prévisionnelle', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Charge prévisionnelle - réparation estimée',
        lines: [
          { accountId: '622', debit: 500, credit: 0 },
          { accountId: '512', debit: 0, credit: 500 },
        ] as EntryLine[],
      }
      
      const result = validatePrudence(entry)
      
      expect(result.warnings.some(w => w.includes('prévisionnelle'))).toBe(true)
    })
  })
  
  describe('recommendProvisions', () => {
    it('devrait recommander une provision pour garanties', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Vente avec garantie de 2 ans',
        lines: [] as EntryLine[],
      }
      
      const recommendations = recommendProvisions(entry)
      
      expect(recommendations.some(r => r.includes('garantie'))).toBe(true)
    })
    
    it('devrait recommander une provision pour litiges', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Litige en cours avec un fournisseur',
        lines: [] as EntryLine[],
      }
      
      const recommendations = recommendProvisions(entry)
      
      expect(recommendations.some(r => r.includes('litige'))).toBe(true)
    })
    
    it('devrait recommander une provision pour contrats en perte', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Contrat en perte identifié',
        lines: [] as EntryLine[],
      }
      
      const recommendations = recommendProvisions(entry)
      
      expect(recommendations.some(r => r.includes('contrat') && r.includes('perte'))).toBe(true)
    })
  })
  
  describe('validateImpairments', () => {
    it('devrait avertir si une dépréciation devrait être comptabilisée', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Immobilisation avec perte de valeur',
        lines: [
          { accountId: '211', debit: 1000, credit: 0 },
          { accountId: '512', debit: 0, credit: 1000 },
        ] as EntryLine[],
      }
      
      const result = validateImpairments(entry)
      
      expect(result.warnings.length).toBeGreaterThan(0)
    })
  })
})
