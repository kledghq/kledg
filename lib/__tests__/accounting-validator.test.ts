import { describe, it, expect } from 'vitest'
import {
  validateEntryBalance,
  validateAmount,
  validateAccountCode,
  validateDate,
  validateDateRange,
  getAccountNature,
  validateAccountingEntry,
} from '../accounting/validator'
import type { EntryLine } from '../accounting/types'

describe('Service de Validation Comptable', () => {
  describe('validateEntryBalance', () => {
    it('devrait valider une écriture équilibrée', () => {
      const lines: EntryLine[] = [
        { accountId: '1', debit: 1000, credit: 0 },
        { accountId: '2', debit: 0, credit: 1000 },
      ]

      const result = validateEntryBalance(lines)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.totalDebit).toBe(1000)
      expect(result.totalCredit).toBe(1000)
      expect(result.balance).toBe(0)
    })

    it('devrait rejeter une écriture déséquilibrée', () => {
      const lines: EntryLine[] = [
        { accountId: '1', debit: 1000, credit: 0 },
        { accountId: '2', debit: 0, credit: 500 },
      ]

      const result = validateEntryBalance(lines)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.includes("n'est pas équilibrée"))).toBe(true)
    })

    it('devrait rejeter une écriture avec moins de 2 lignes', () => {
      const lines: EntryLine[] = [
        { accountId: '1', debit: 1000, credit: 0 },
      ]

      const result = validateEntryBalance(lines)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('partie double'))).toBe(true)
    })

    it('devrait rejeter une ligne avec débit et crédit simultanés (non-compensation)', () => {
      const lines: EntryLine[] = [
        { accountId: '1', debit: 1000, credit: 500 },
        { accountId: '2', debit: 0, credit: 500 },
      ]

      const result = validateEntryBalance(lines)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('non-compensation'))).toBe(true)
    })

    it('devrait rejeter une ligne sans montant', () => {
      const lines: EntryLine[] = [
        { accountId: '1', debit: 0, credit: 0 },
        { accountId: '2', debit: 0, credit: 1000 },
      ]

      const result = validateEntryBalance(lines)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('débit ou au crédit'))).toBe(true)
    })

    it('devrait accepter des lignes avec montants négatifs (ex. compte en découvert)', () => {
      const lines: EntryLine[] = [
        { accountId: '1', debit: -1000, credit: 0 },
        { accountId: '2', debit: 0, credit: -1000 },
      ]

      const result = validateEntryBalance(lines)

      expect(result.valid).toBe(true)
      expect(result.totalDebit).toBe(-1000)
      expect(result.totalCredit).toBe(-1000)
      expect(result.balance).toBe(0)
    })

    // Exact amounts: no rounding tolerance (sums in integer cents)
    it('refuse un écart de 0,01 € (aucune tolérance)', () => {
      const result = validateEntryBalance([
        { accountId: '1', debit: 1000, credit: 0 },
        { accountId: '2', debit: 0, credit: 999.99 },
      ])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('écart 0,01 €'))).toBe(true)
    })

    it("refuse un montant à trois décimales au lieu de l'arrondir", () => {
      const result = validateEntryBalance([
        { accountId: '1', debit: 1000.005, credit: 0 },
        { accountId: '2', debit: 0, credit: 1000 },
      ])
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('deux décimales'))).toBe(true)
    })

    it('équilibre 0,10 + 0,20 avec 0,30 exactement', () => {
      const result = validateEntryBalance([
        { accountId: '1', debit: 0.1, credit: 0 },
        { accountId: '2', debit: 0.2, credit: 0 },
        { accountId: '3', debit: 0, credit: 0.3 },
      ])
      expect(0.1 + 0.2).not.toBe(0.3) // the floating point trap avoided by the cents
      expect(result.valid).toBe(true)
      expect(result.balance).toBe(0)
    })

    it('reste exact sur de très grands montants (Decimal(15, 2))', () => {
      const max = '9999999999999.99'
      const debits = Array.from({ length: 100 }, (_, i) => ({ accountId: `d${i}`, debit: max, credit: 0 }))
      const credits = Array.from({ length: 100 }, (_, i) => ({
        accountId: `c${i}`,
        debit: 0,
        credit: i === 0 ? '9999999999999.98' : max,
      }))
      // As doubles both sides sum to the same number: the missing cent is lost
      const asFloat = (values: string[]) => values.reduce((sum, v) => sum + Number(v), 0)
      expect(asFloat(debits.map((l) => l.debit))).toBe(asFloat(credits.map((l) => l.credit as string)))

      const result = validateEntryBalance([...debits, ...credits])
      expect(result.valid).toBe(false)
      expect(result.errors.join()).toContain('écart 0,01 €')

      const balanced = validateEntryBalance([...debits, ...credits.map((l) => ({ ...l, credit: max }))])
      expect(balanced.valid).toBe(true)
    })

    it('devrait rejeter une écriture vide', () => {
      const lines: EntryLine[] = []

      const result = validateEntryBalance(lines)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('au moins une ligne'))).toBe(true)
    })
  })

  describe('validateAmount', () => {
    it('devrait valider un montant positif', () => {
      expect(validateAmount(1000)).toBe(true)
      expect(validateAmount(0)).toBe(true)
      expect(validateAmount(0.01)).toBe(true)
    })

    it('devrait accepter un montant négatif (ex. découvert)', () => {
      expect(validateAmount(-1000)).toBe(true)
    })

    it('devrait rejeter un montant invalide', () => {
      expect(validateAmount(null)).toBe(false)
      expect(validateAmount(undefined)).toBe(false)
      expect(validateAmount('abc')).toBe(false)
      expect(validateAmount(NaN)).toBe(false)
      expect(validateAmount(Infinity)).toBe(false)
    })
  })

  describe('validateAccountCode', () => {
    it('devrait valider un code de compte PCG valide', () => {
      expect(validateAccountCode('211')).toBe(true)
      expect(validateAccountCode('601')).toBe(true)
      expect(validateAccountCode('701')).toBe(true)
      expect(validateAccountCode('101')).toBe(true)
    })

    it('devrait rejeter un code invalide', () => {
      expect(validateAccountCode('')).toBe(false)
      expect(validateAccountCode('1')).toBe(false) // Trop court
      expect(validateAccountCode('123456789')).toBe(false) // Trop long
      expect(validateAccountCode('ABC')).toBe(false) // Contient des lettres
      expect(validateAccountCode('21-1')).toBe(false) // Contient des caractères spéciaux
    })
  })

  describe('validateDate', () => {
    it('devrait valider une date valide', () => {
      expect(validateDate('2026-01-01')).toBe(true)
      expect(validateDate(new Date())).toBe(true)
      expect(validateDate('2026-12-31')).toBe(true)
    })

    it('devrait rejeter une date invalide', () => {
      expect(validateDate(null)).toBe(false)
      expect(validateDate(undefined)).toBe(false)
      expect(validateDate('invalid')).toBe(false)
      expect(validateDate('2026-13-01')).toBe(false) // Mois invalide
    })
  })

  describe('validateDateRange', () => {
    it('devrait valider une date dans la plage valide', () => {
      const today = new Date()
      expect(validateDateRange(today)).toBe(true)
      
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      expect(validateDateRange(tomorrow)).toBe(true)
    })

    it('devrait rejeter une date trop ancienne', () => {
      const oldDate = new Date('1800-01-01')
      expect(validateDateRange(oldDate)).toBe(false)
    })

    it('devrait rejeter une date trop lointaine dans le futur', () => {
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + 100) // Plus de 30 jours
      expect(validateDateRange(futureDate, 30)).toBe(false)
    })
  })

  describe('getAccountNature', () => {
    it('devrait identifier correctement la nature des comptes', () => {
      expect(getAccountNature('101')).toBe('passif') // Capitaux propres
      expect(getAccountNature('211')).toBe('actif') // Immobilisations
      expect(getAccountNature('31')).toBe('actif') // Stocks
      expect(getAccountNature('411')).toBe('actif') // Clients
      expect(getAccountNature('512')).toBe('actif') // Banque
      expect(getAccountNature('601')).toBe('charge') // Charges
      expect(getAccountNature('701')).toBe('produit') // Produits
    })

    it('devrait retourner null pour un code invalide', () => {
      expect(getAccountNature('')).toBe(null)
      expect(getAccountNature('9')).toBe(null) // Classe inexistante
    })
  })

  describe('validateAccountingEntry', () => {
    it('devrait valider une écriture complète valide', () => {
      const entry = {
        date: new Date('2026-01-01'),
        description: 'Test entry',
        lines: [
          { accountId: '1', debit: 1000, credit: 0 },
          { accountId: '2', debit: 0, credit: 1000 },
        ],
      }

      const result = validateAccountingEntry(entry)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('devrait rejeter une écriture avec date invalide', () => {
      const entry = {
        date: 'invalid-date',
        description: 'Test entry',
        lines: [
          { accountId: '1', debit: 1000, credit: 0 },
          { accountId: '2', debit: 0, credit: 1000 },
        ],
      }

      const result = validateAccountingEntry(entry)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('date'))).toBe(true)
    })

    it('devrait rejeter une écriture avec description vide si fournie', () => {
      const entry = {
        date: new Date('2026-01-01'),
        description: '   ',
        lines: [
          { accountId: '1', debit: 1000, credit: 0 },
          { accountId: '2', debit: 0, credit: 1000 },
        ],
      }

      const result = validateAccountingEntry(entry)

      expect(result.valid).toBe(false)
      expect(result.errors.some(e => /libellé/i.test(e))).toBe(true)
    })
  })
})
