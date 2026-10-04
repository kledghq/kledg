/**
 * Tests pour le principe d'Image Fidèle (Art. 121-1)
 */

import { describe, it, expect } from 'vitest'
import { validateImageFidele, validateImageFideleGlobal } from '../../principles/image-fidele'
import type { EntryLine } from '@/lib/accounting/types'

describe('Principe d\'Image Fidèle (Art. 121-1)', () => {
  describe('validateImageFidele', () => {
    it('devrait valider une écriture respectant le principe d\'image fidèle', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Achat de matériel informatique',
        lines: [
          { accountId: '211', debit: 1000, credit: 0 },
          { accountId: '512', debit: 0, credit: 1000 },
        ] as EntryLine[],
      }
      
      const result = validateImageFidele(entry)
      
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
    
    it("accepte une date future : la borne est l'exercice (entry-guards), pas la date du jour", () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 60) // Une écriture de clôture sur la fin d'exercice à venir
      
      const entry = {
        date: futureDate,
        description: 'Écriture future',
        lines: [
          { accountId: '211', debit: 1000, credit: 0 },
          { accountId: '512', debit: 0, credit: 1000 },
        ] as EntryLine[],
      }
      
      const result = validateImageFidele(entry)
      
      expect(result.valid).toBe(true)
      expect(result.errors.some(e => e.includes('futur'))).toBe(false)
    })
    
    it('devrait accepter une écriture avec montant négatif (ex. compte en découvert)', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Écriture avec montant négatif',
        lines: [
          { accountId: '211', debit: -1000, credit: 0 },
          { accountId: '512', debit: 0, credit: 1000 },
        ] as EntryLine[],
      }

      const result = validateImageFidele(entry)

      expect(result.valid).toBe(true)
      expect(result.errors.some(e => e.includes('négatif'))).toBe(false)
    })
    
    it('devrait rejeter une écriture avec compensation', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'Écriture avec compensation',
        lines: [
          { accountId: '211', debit: 1000, credit: 500 },
          { accountId: '512', debit: 0, credit: 500 },
        ] as EntryLine[],
      }
      
      const result = validateImageFidele(entry)
      
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('compensation'))).toBe(true)
    })
    
    it('devrait avertir si la description est absente ou trop courte', () => {
      const entry = {
        date: new Date('2026-01-15'),
        description: 'OK',
        lines: [
          { accountId: '211', debit: 1000, credit: 0 },
          { accountId: '512', debit: 0, credit: 1000 },
        ] as EntryLine[],
      }
      
      const result = validateImageFidele(entry)
      
      expect(result.warnings.some(w => w.includes('description'))).toBe(true)
    })
  })
  
  describe('validateImageFideleGlobal', () => {
    it('devrait valider un ensemble d\'écritures cohérent', () => {
      const entries = [
        {
          id: '1',
          companyId: 'company-1',
          journalId: 'journal-1',
          entryNumber: '001',
          date: new Date('2026-01-15'),
          description: 'Écriture 1',
          status: 'validated' as const,
          lines: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          companyId: 'company-1',
          journalId: 'journal-1',
          entryNumber: '002',
          date: new Date('2026-01-16'),
          description: 'Écriture 2',
          status: 'validated' as const,
          lines: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]
      
      const result = validateImageFideleGlobal(entries)
      
      expect(result.valid).toBe(true)
    })
    
    it('devrait détecter des écritures potentiellement dupliquées', () => {
      const entries = [
        {
          id: '1',
          companyId: 'company-1',
          journalId: 'journal-1',
          entryNumber: '001',
          date: new Date('2026-01-15'),
          description: 'Même écriture',
          status: 'validated' as const,
          lines: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: '2',
          companyId: 'company-1',
          journalId: 'journal-1',
          entryNumber: '002',
          date: new Date('2026-01-15'),
          description: 'Même écriture',
          status: 'validated' as const,
          lines: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]
      
      const result = validateImageFideleGlobal(entries)
      
      expect(result.warnings.some(w => w.includes('dupliqué'))).toBe(true)
    })
  })
})
