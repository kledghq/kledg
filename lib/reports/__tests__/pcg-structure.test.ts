/**
 * Tests de conformité PCG pour les structures de documents de synthèse
 * 
 * Vérifie que le bilan et le compte de résultat respectent Art. 821-1 et 821-2
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { validateBalanceSheetStructure, validateIncomeStatementStructure } from '@/lib/pcg/reports/structure-validator'
import type { CompleteBalanceSheet } from '@/lib/reports/types'

describe('PCG Structure Validation', () => {
  describe('Balance Sheet Structure (Art. 821-1)', () => {
    it('should validate a complete balance sheet structure', () => {
      const balanceSheet: CompleteBalanceSheet = {
        actif: {
          capitalNonAppele: { total: 0, accounts: [] },
          fraisEtablissement: { brut: 0, amortissements: 0, net: 0, details: [] },
          actifImmobilise: {
            incorporelles: { brut: 0, amortissements: 0, net: 0, details: [] },
            corporelles: { brut: 0, amortissements: 0, net: 0, details: [] },
            misesEnConcession: { brut: 0, amortissements: 0, net: 0, details: [] },
            enCours: { brut: 0, amortissements: 0, net: 0, details: [] },
            participations: { brut: 0, amortissements: 0, net: 0, details: [] },
            autresFinancieres: { brut: 0, amortissements: 0, net: 0, details: [] },
            brutTotal: 0,
            amortissementsTotal: 0,
            netTotal: 0,
          },
          actifCirculant: {
            stocks: {
              matieresPremieres: { total: 0, accounts: [] },
              enCoursProduction: { total: 0, accounts: [] },
              produitsFinis: { total: 0, accounts: [] },
              marchandises: { total: 0, accounts: [] },
              total: 0,
              accounts: [],
            },
            avancesCommandes: { total: 0, accounts: [] },
            creances: {
              clients: { total: 0, accounts: [] },
              autres: { total: 0, accounts: [] },
              total: 0,
              accounts: [],
            },
            chargesConstatees: { total: 0, accounts: [] },
            capitalAppeleNonVerse: { total: 0, accounts: [] },
            valeursMobilieres: {
              actionsPropres: { total: 0, accounts: [] },
              autresTitres: { total: 0, accounts: [] },
              total: 0,
              accounts: [],
            },
            instrumentsFinanciersTerme: { total: 0, accounts: [] },
            disponibilites: { total: 0, accounts: [] },
            total: 0,
          },
          fraisEmissionEmprunts: { total: 0, accounts: [] },
          primesRemboursementEmprunts: { total: 0, accounts: [] },
          ecartsConversionActif: { total: 0, accounts: [] },
          total: 0,
        },
        passif: {
          capitauxPropres: {
            capital: { total: 0, dontVerse: 0, accounts: [] },
            primesCapital: { total: 0, accounts: [] },
            ecartsReevaluation: { total: 0, accounts: [] },
            ecartEquivalence: { total: 0, accounts: [] },
            reserves: {
              reserveLegale: { total: 0, accounts: [] },
              reservesStatutaires: { total: 0, accounts: [] },
              reservesReglementees: { total: 0, accounts: [] },
              autresReserves: { total: 0, accounts: [] },
              total: 0,
              accounts: [],
            },
            reportANouveau: { total: 0, accounts: [] },
            resultatExercice: { total: 0, acomptesDividendes: 0, accounts: [] },
            subventionsInvestissement: { total: 0, accounts: [] },
            provisionsReglementees: { total: 0, accounts: [] },
            total: 0,
          },
          autresFondsPropres: {
            fondsNonRemboursables: { total: 0, accounts: [] },
            avancesConditionnees: { total: 0, accounts: [] },
            droitsConcedant: { total: 0, accounts: [] },
            total: 0,
          },
          provisions: {
            provisionsRisques: { total: 0, accounts: [] },
            provisionsCharges: { total: 0, accounts: [] },
            total: 0,
          },
          dettes: {
            empruntsObligatairesConvertibles: { total: 0, accounts: [] },
            autresEmpruntsObligataires: { total: 0, accounts: [] },
            empruntsEtablissementsCredit: { total: 0, accounts: [] },
            empruntsFinanciersDivers: { total: 0, dontEmpruntsParticipatifs: 0, accounts: [] },
            instrumentsFinanciersTerme: { total: 0, accounts: [] },
            avancesAcomptesRecus: { total: 0, accounts: [] },
            dettesFournisseurs: { total: 0, accounts: [] },
            dettesFiscalesSociales: { total: 0, accounts: [] },
            dettesImmobilisations: { total: 0, accounts: [] },
            autresDettes: { total: 0, accounts: [] },
            produitsConstates: { total: 0, accounts: [] },
            total: 0,
            dontMoinsUnAn: 0,
          },
          ecartsConversionPassif: { total: 0, accounts: [] },
          total: 0,
        },
        details: {
          class1: [],
          class2: [],
          class3: [],
          class4: [],
          class5: [],
        },
      }

      const result = validateBalanceSheetStructure(balanceSheet)
      expect(result.valid).toBe(true)
    })

    it('should detect balance sheet imbalance', () => {
      const balanceSheet: CompleteBalanceSheet = {
        actif: {
          capitalNonAppele: { total: 0, accounts: [] },
          fraisEtablissement: { brut: 0, amortissements: 0, net: 0, details: [] },
          actifImmobilise: {
            incorporelles: { brut: 0, amortissements: 0, net: 0, details: [] },
            corporelles: { brut: 0, amortissements: 0, net: 0, details: [] },
            misesEnConcession: { brut: 0, amortissements: 0, net: 0, details: [] },
            enCours: { brut: 0, amortissements: 0, net: 0, details: [] },
            participations: { brut: 0, amortissements: 0, net: 0, details: [] },
            autresFinancieres: { brut: 0, amortissements: 0, net: 0, details: [] },
            brutTotal: 0,
            amortissementsTotal: 0,
            netTotal: 0,
          },
          actifCirculant: {
            stocks: {
              matieresPremieres: { total: 0, accounts: [] },
              enCoursProduction: { total: 0, accounts: [] },
              produitsFinis: { total: 0, accounts: [] },
              marchandises: { total: 0, accounts: [] },
              total: 0,
              accounts: [],
            },
            avancesCommandes: { total: 0, accounts: [] },
            creances: {
              clients: { total: 0, accounts: [] },
              autres: { total: 0, accounts: [] },
              total: 0,
              accounts: [],
            },
            chargesConstatees: { total: 0, accounts: [] },
            capitalAppeleNonVerse: { total: 0, accounts: [] },
            valeursMobilieres: {
              actionsPropres: { total: 0, accounts: [] },
              autresTitres: { total: 0, accounts: [] },
              total: 0,
              accounts: [],
            },
            instrumentsFinanciersTerme: { total: 0, accounts: [] },
            disponibilites: { total: 0, accounts: [] },
            total: 0,
          },
          fraisEmissionEmprunts: { total: 0, accounts: [] },
          primesRemboursementEmprunts: { total: 0, accounts: [] },
          ecartsConversionActif: { total: 0, accounts: [] },
          total: 1000, // Déséquilibre
        },
        passif: {
          capitauxPropres: {
            capital: { total: 0, dontVerse: 0, accounts: [] },
            primesCapital: { total: 0, accounts: [] },
            ecartsReevaluation: { total: 0, accounts: [] },
            ecartEquivalence: { total: 0, accounts: [] },
            reserves: {
              reserveLegale: { total: 0, accounts: [] },
              reservesStatutaires: { total: 0, accounts: [] },
              reservesReglementees: { total: 0, accounts: [] },
              autresReserves: { total: 0, accounts: [] },
              total: 0,
              accounts: [],
            },
            reportANouveau: { total: 0, accounts: [] },
            resultatExercice: { total: 0, acomptesDividendes: 0, accounts: [] },
            subventionsInvestissement: { total: 0, accounts: [] },
            provisionsReglementees: { total: 0, accounts: [] },
            total: 0,
          },
          autresFondsPropres: {
            fondsNonRemboursables: { total: 0, accounts: [] },
            avancesConditionnees: { total: 0, accounts: [] },
            droitsConcedant: { total: 0, accounts: [] },
            total: 0,
          },
          provisions: {
            provisionsRisques: { total: 0, accounts: [] },
            provisionsCharges: { total: 0, accounts: [] },
            total: 0,
          },
          dettes: {
            empruntsObligatairesConvertibles: { total: 0, accounts: [] },
            autresEmpruntsObligataires: { total: 0, accounts: [] },
            empruntsEtablissementsCredit: { total: 0, accounts: [] },
            empruntsFinanciersDivers: { total: 0, dontEmpruntsParticipatifs: 0, accounts: [] },
            instrumentsFinanciersTerme: { total: 0, accounts: [] },
            avancesAcomptesRecus: { total: 0, accounts: [] },
            dettesFournisseurs: { total: 0, accounts: [] },
            dettesFiscalesSociales: { total: 0, accounts: [] },
            dettesImmobilisations: { total: 0, accounts: [] },
            autresDettes: { total: 0, accounts: [] },
            produitsConstates: { total: 0, accounts: [] },
            total: 0,
            dontMoinsUnAn: 0,
          },
          ecartsConversionPassif: { total: 0, accounts: [] },
          total: 500, // Déséquilibre
        },
        details: {
          class1: [],
          class2: [],
          class3: [],
          class4: [],
          class5: [],
        },
      }

      const result = validateBalanceSheetStructure(balanceSheet)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some(e => e.includes('équilibré'))).toBe(true)
    })
  })

  describe('Income Statement Structure (Art. 821-2)', () => {
    it('should validate a complete income statement structure', () => {
      const incomeStatement = {
        charges: {
          exploitation: {
            achatsMarchandises: { total: 0, accounts: [] },
            variationStocksMarchandises: { total: 0, accounts: [] },
            achatsMatieresPremieres: { total: 0, accounts: [] },
            variationStocksMatieresPremieres: { total: 0, accounts: [] },
            autresAchatsChargesExternes: {
              total: 0,
              redevancesCreditBailMobilier: 0,
              redevancesCreditBailImmobilier: 0,
              accounts: [],
            },
            impotsTaxes: { total: 0, accounts: [] },
            salaires: { total: 0, accounts: [] },
            cotisationsSociales: { total: 0, accounts: [] },
            dotations: {
              amortissementsImmobilisations: { total: 0, accounts: [] },
              depreciationsImmobilisations: { total: 0, accounts: [] },
              depreciationsActifCirculant: { total: 0, accounts: [] },
              provisions: { total: 0, accounts: [] },
              total: 0,
            },
            valeursComptablesCessions: { total: 0, accounts: [] },
            autresCharges: { total: 0, accounts: [] },
            total: 0,
          },
          financieres: {
            dotations: { total: 0, accounts: [] },
            interetsChargesAssimilees: {
              total: 0,
              dontEntitesLiees: 0,
              accounts: [],
            },
            differencesNegativesChange: { total: 0, accounts: [] },
            valeursComptablesCessionsFinancieres: { total: 0, accounts: [] },
            chargesNettesCessionsVMP: { total: 0, accounts: [] },
            total: 0,
            accounts: [],
          },
          exceptionnelles: { total: 0, accounts: [] },
          participationSalaries: { total: 0, accounts: [] },
          impotsBenefices: { total: 0, accounts: [] },
          total: 0,
        },
        produits: {
          exploitation: {
            ventesMarchandises: { total: 0, accounts: [] },
            productionVendue: { total: 0, accounts: [] },
            montantNetChiffreAffaires: 0,
            productionStockee: { total: 0, accounts: [] },
            productionImmobilisee: { total: 0, accounts: [] },
            subventions: { total: 0, accounts: [] },
            reprisesAmortissementsDepreciationsProvisions: { total: 0, accounts: [] },
            produitsCessionsImmobilisations: { total: 0, accounts: [] },
            autresProduits: { total: 0, accounts: [] },
            total: 0,
          },
          financiers: {
            participation: {
              total: 0,
              dontEntitesLiees: 0,
              accounts: [],
            },
            autresValeursMobilieresCreances: {
              total: 0,
              dontEntitesLiees: 0,
              accounts: [],
            },
            autresInteretsProduitsAssimiles: {
              total: 0,
              dontEntitesLiees: 0,
              accounts: [],
            },
            reprisesDepreciationsProvisions: { total: 0, accounts: [] },
            differencesPositivesChange: { total: 0, accounts: [] },
            produitsCessionsImmobilisationsFinancieres: { total: 0, accounts: [] },
            produitsNetsCessionsVMP: { total: 0, accounts: [] },
            total: 0,
            accounts: [],
          },
          exceptionnels: { total: 0, accounts: [] },
          total: 0,
        },
        dotations: {
          amortissements: 0,
          provisions: 0,
          total: 0,
        },
      calculs: {
        resultatExploitation: 0,
        quotePartResultatCommun: {
          beneficeAttribue: { total: 0, accounts: [] },
          perteSupportee: { total: 0, accounts: [] },
        },
        resultatFinancier: 0,
        resultatCourant: 0,
        resultatExceptionnel: 0,
        totalProduits: 0,
        totalCharges: 0,
        beneficeOuPerte: 0,
        resultatNet: 0, // Alias pour beneficeOuPerte
      },
      }

      const result = validateIncomeStatementStructure(incomeStatement)
      expect(result.valid).toBe(true)
    })
  })
})
