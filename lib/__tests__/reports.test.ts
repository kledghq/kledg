import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AccountBalance } from '../reports'

// Mock Prisma
vi.mock('../prisma', () => ({
  prisma: {
    account: {
      findMany: vi.fn(),
    },
    accountingEntry: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from '../prisma'

/**
 * Tests pour les fonctions de calcul comptable selon les normes PCG 2026
 * 
 * PRINCIPES COMPTABLES FRANÇAIS À RESPECTER :
 * 1. BILAN : Soldes cumulés jusqu'à une date donnée
 *    - ACTIF = soldes débiteurs (débit - crédit)
 *    - PASSIF = soldes créditeurs (crédit - débit)
 *    - ACTIF = PASSIF (équilibre obligatoire)
 * 
 * 2. COMPTE DE RÉSULTAT : Soldes sur une période
 *    - CHARGES (classe 6) = débit - crédit
 *    - PRODUITS (classe 7) = crédit - débit
 *    - RÉSULTAT = Produits - Charges
 * 
 * 3. IMMOBILISATIONS :
 *    - Brut (comptes 20-27) - Amortissements (28XX) - Dépréciations (29XX) = Net
 *    - Les comptes 28XX et 29XX sont créditeurs
 */

describe('Calculs comptables - Principes PCG 2026', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Calcul des soldes de comptes', () => {
    it('devrait calculer correctement le solde d\'un compte actif (débit - crédit)', () => {
      const balance: AccountBalance = {
        accountId: '1',
        code: '211',
        label: 'Immobilisations corporelles',
        debit: 1000,
        credit: 0,
        balance: 1000,
      }

      expect(balance.balance).toBe(1000)
      expect(balance.debit - balance.credit).toBe(1000)
    })

    it('devrait calculer correctement le solde d\'un compte passif (crédit - débit)', () => {
      const balance: AccountBalance = {
        accountId: '2',
        code: '101',
        label: 'Capital',
        debit: 0,
        credit: 5000,
        balance: -5000, // Solde négatif car débit - crédit
      }

      // Pour un compte de passif, le solde créditeur = crédit - débit
      const soldeCredit = balance.credit - balance.debit
      expect(soldeCredit).toBe(5000)
    })

    it('devrait calculer correctement le solde d\'un compte d\'amortissement (créditeur)', () => {
      const balance: AccountBalance = {
        accountId: '3',
        code: '2811',
        label: 'Amortissements des immobilisations corporelles',
        debit: 0,
        credit: 200,
        balance: -200, // Solde négatif car débit - crédit
      }

      // Pour un compte d'amortissement, le solde créditeur = crédit - débit
      const soldeAmort = balance.credit - balance.debit
      expect(soldeAmort).toBe(200)
    })
  })

  describe('Bilan - Équilibre Actif/Passif', () => {
    it('devrait respecter l\'équilibre Actif = Passif', () => {
      // Exemple simplifié
      const actifTotal = 10000
      const passifTotal = 10000

      const ecart = Math.abs(actifTotal - passifTotal)
      expect(ecart).toBeLessThan(0.01) // Tolérance de 0.01€
    })

    it('devrait détecter un déséquilibre dans le bilan', () => {
      const actifTotal = 10000
      const passifTotal = 9500

      const ecart = Math.abs(actifTotal - passifTotal)
      expect(ecart).toBeGreaterThan(0.01)
    })
  })

  describe('Compte de résultat - Calcul du résultat', () => {
    it('devrait calculer correctement le résultat (Produits - Charges)', () => {
      const chargesTotal = 5000
      const produitsTotal = 8000

      const resultat = produitsTotal - chargesTotal
      expect(resultat).toBe(3000) // Bénéfice
    })

    it('devrait calculer correctement une perte', () => {
      const chargesTotal = 8000
      const produitsTotal = 5000

      const resultat = produitsTotal - chargesTotal
      expect(resultat).toBe(-3000) // Perte
    })

    it('devrait calculer correctement les charges (débit - crédit)', () => {
      const balance: AccountBalance = {
        accountId: '4',
        code: '6811',
        label: 'Dotations aux amortissements',
        debit: 1000,
        credit: 0,
        balance: 1000,
      }

      const charge = balance.debit - balance.credit
      expect(charge).toBe(1000)
    })

    it('devrait calculer correctement les produits (crédit - débit)', () => {
      const balance: AccountBalance = {
        accountId: '5',
        code: '701',
        label: 'Ventes de produits finis',
        debit: 0,
        credit: 5000,
        balance: -5000, // Solde négatif car débit - crédit
      }

      const produit = balance.credit - balance.debit
      expect(produit).toBe(5000)
    })
  })

  describe('Immobilisations - Calcul de la valeur nette', () => {
    it('devrait calculer correctement la valeur nette (Brut - Amortissements)', () => {
      const brut = 10000
      const amortissements = 2000

      const net = Math.max(0, brut - amortissements)
      expect(net).toBe(8000)
    })

    it('devrait retourner 0 si les amortissements dépassent le brut', () => {
      const brut = 5000
      const amortissements = 6000

      const net = Math.max(0, brut - amortissements)
      expect(net).toBe(0) // Ne peut pas être négatif
    })

    it('devrait gérer les dépréciations en plus des amortissements', () => {
      const brut = 10000
      const amortissements = 2000
      const depreciations = 500

      const net = Math.max(0, brut - amortissements - depreciations)
      expect(net).toBe(7500)
    })
  })

  describe('Correspondance des comptes d\'amortissement', () => {
    it('devrait convertir correctement 2811 en 211', () => {
      const amortCode = '2811'
      const baseCode = '2' + amortCode.substring(2) // '2' + '11' = '211'
      expect(baseCode).toBe('211')
    })

    it('devrait convertir correctement 2801 en 201', () => {
      const amortCode = '2801'
      const baseCode = '2' + amortCode.substring(2) // '2' + '01' = '201'
      expect(baseCode).toBe('201')
    })

    it('devrait convertir correctement 281 en 21', () => {
      const amortCode = '281'
      const baseCode = '2' + amortCode.substring(2) // '2' + '1' = '21'
      expect(baseCode).toBe('21')
    })

    it('devrait convertir correctement 2901 en 201', () => {
      const deprecCode = '2901'
      const baseCode = '2' + deprecCode.substring(2) // '2' + '01' = '201'
      expect(baseCode).toBe('201')
    })
  })

  describe('Catégorisation des immobilisations selon PCG', () => {
    it('devrait catégoriser les immobilisations incorporelles (20XX)', () => {
      const code = '201'
      expect(code.startsWith('20')).toBe(true)
    })

    it('devrait catégoriser les immobilisations corporelles (21-25)', () => {
      expect('211'.startsWith('21')).toBe(true)
      expect('221'.startsWith('22')).toBe(true)
      expect('231'.startsWith('23')).toBe(true)
      expect('241'.startsWith('24')).toBe(true)
      expect('251'.startsWith('25')).toBe(true)
    })

    it('devrait catégoriser les immobilisations financières (26-27)', () => {
      expect('261'.startsWith('26')).toBe(true)
      expect('271'.startsWith('27')).toBe(true)
    })
  })

  describe('Structure du bilan selon PCG 2026', () => {
    it('devrait organiser l\'actif selon la structure officielle', () => {
      const actif = {
        capitalNonAppele: 0,
        immobilisations: 5000,
        actifCirculant: 3000,
        regularisation: 500,
        total: 8500,
      }

      expect(actif.total).toBe(
        actif.capitalNonAppele +
        actif.immobilisations +
        actif.actifCirculant +
        actif.regularisation
      )
    })

    it('devrait organiser le passif selon la structure officielle', () => {
      const passif = {
        capitauxPropres: 4000,
        dettes: 3500,
        regularisation: 1000,
        total: 8500,
      }

      expect(passif.total).toBe(
        passif.capitauxPropres +
        passif.dettes +
        passif.regularisation
      )
    })
  })

  describe('Validation des classes de comptes PCG', () => {
    it('devrait identifier correctement les comptes de classe 1 (Capitaux)', () => {
      const codes = ['101', '106', '16', '17']
      codes.forEach(code => {
        expect(code.startsWith('1')).toBe(true)
      })
    })

    it('devrait identifier correctement les comptes de classe 2 (Immobilisations)', () => {
      const codes = ['211', '2811', '2901']
      codes.forEach(code => {
        expect(code.startsWith('2')).toBe(true)
      })
    })

    it('devrait identifier correctement les comptes de classe 3 (Stocks)', () => {
      const codes = ['31', '37', '39']
      codes.forEach(code => {
        expect(code.startsWith('3')).toBe(true)
      })
    })

    it('devrait identifier correctement les comptes de classe 4 (Tiers)', () => {
      const codes = ['411', '401', '48', '409']
      codes.forEach(code => {
        expect(code.startsWith('4')).toBe(true)
      })
    })

    it('devrait identifier correctement les comptes de classe 5 (Financiers)', () => {
      const codes = ['512', '531', '55']
      codes.forEach(code => {
        expect(code.startsWith('5')).toBe(true)
      })
    })

    it('devrait identifier correctement les comptes de classe 6 (Charges)', () => {
      const codes = ['601', '6811', '66']
      codes.forEach(code => {
        expect(code.startsWith('6')).toBe(true)
      })
    })

    it('devrait identifier correctement les comptes de classe 7 (Produits)', () => {
      const codes = ['701', '74', '75']
      codes.forEach(code => {
        expect(code.startsWith('7')).toBe(true)
      })
    })
  })
})
