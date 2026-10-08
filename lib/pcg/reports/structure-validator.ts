/**
 * PCG Structure Validator
 * 
 * Validates that balance sheet and income statement structures comply with
 * PCG 2026 Art. 821-1 and Art. 821-2.
 * 
 * Reference: RECEUIL-PCG-2026-AVEC-COUVERTURE.md
 */

import type { CompleteBalanceSheet } from '@/lib/reports/types'
import { formatCentsFr, toCents } from '@/lib/utils/money'
// For now, define a minimal type
type CompleteIncomeStatement = {
  produits: {
    exploitation?: {
      ventesMarchandises?: unknown
      productionVendue?: unknown
      montantNetChiffreAffaires?: number
      productionStockee?: unknown
      productionImmobilisee?: unknown
      subventions?: unknown
      reprisesAmortissementsDepreciationsProvisions?: unknown
      produitsCessionsImmobilisations?: unknown
      [key: string]: unknown
    }
    financiers?: {
      participation?: unknown
      autresValeursMobilieresCreances?: unknown
      autresInteretsProduitsAssimiles?: unknown
      reprisesDepreciationsProvisions?: unknown
      differencesPositivesChange?: unknown
      [key: string]: unknown
    }
    exceptionnels?: Record<string, unknown>
    total?: number
  }
  charges: {
    exploitation?: {
      achatsMarchandises?: unknown
      variationStocksMarchandises?: unknown
      achatsMatieresPremieres?: unknown
      variationStocksMatieresPremieres?: unknown
      autresAchatsChargesExternes?: unknown
      impotsTaxes?: unknown
      salaires?: unknown
      cotisationsSociales?: unknown
      dotations?: {
        amortissementsImmobilisations?: unknown
        depreciationsImmobilisations?: unknown
        depreciationsActifCirculant?: unknown
        provisions?: unknown
        [key: string]: unknown
      }
      valeursComptablesCessions?: unknown
      [key: string]: unknown
    }
    financieres?: {
      dotations?: unknown
      interetsChargesAssimilees?: unknown
      differencesNegativesChange?: unknown
      [key: string]: unknown
    }
    exceptionnelles?: Record<string, unknown>
    participationSalaries?: Record<string, unknown>
    impotsBenefices?: Record<string, unknown>
    total?: number
  }
  calculs?: {
    resultatExploitation?: number
    resultatFinancier?: number
    resultatCourant?: number
    resultatExceptionnel?: number
    beneficeOuPerte?: number
    totalProduits?: number
    totalCharges?: number
  }
}

export interface StructureValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validates balance sheet structure according to Art. 821-1
 */
export function validateBalanceSheetStructure(
  balanceSheet: CompleteBalanceSheet
): StructureValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Vérifier l'équilibre du bilan (Art. 511-1)
  // Compared in cents: a one cent gap is an imbalance (the float difference of
  // 100.01 and 100 is above 0.01, of 0.3 and 0.1 + 0.2 is not zero).
  const actifCents = toCents(balanceSheet.actif.total) ?? 0
  const passifCents = toCents(balanceSheet.passif.total) ?? 0
  if (actifCents !== passifCents) {
    errors.push(
      `Le bilan n'est pas équilibré : écart de ${formatCentsFr(Math.abs(actifCents - passifCents))} (Actif : ${formatCentsFr(actifCents)}, Passif : ${formatCentsFr(passifCents)})`
    )
  }

  // Vérifier que tous les postes obligatoires sont présents selon Art. 821-1
  
  // ACTIF - Vérifier les postes obligatoires
  if (!balanceSheet.actif.capitalNonAppele) {
    warnings.push('Poste "Capital souscrit non appelé" manquant (Art. 821-1 I)')
  }

  if (!balanceSheet.actif.fraisEtablissement) {
    warnings.push('Poste "Frais d\'établissement" manquant (Art. 821-1 II)')
  }

  if (!balanceSheet.actif.actifImmobilise) {
    errors.push('Poste "Actif immobilisé" manquant (Art. 821-1 III)')
  } else {
    // Vérifier les sous-postes de l'actif immobilisé
    if (balanceSheet.actif.actifImmobilise.incorporelles.net < 0) {
      warnings.push('Immobilisations incorporelles : valeur nette négative (à vérifier)')
    }
    if (balanceSheet.actif.actifImmobilise.corporelles.net < 0) {
      warnings.push('Immobilisations corporelles : valeur nette négative (à vérifier)')
    }
  }

  if (!balanceSheet.actif.actifCirculant) {
    errors.push('Poste "Actif circulant" manquant (Art. 821-1 IV)')
  } else {
    // Vérifier les sous-postes de l'actif circulant
    if (!balanceSheet.actif.actifCirculant.stocks) {
      warnings.push('Poste "Stocks et en-cours" manquant dans l\'actif circulant')
    }
    if (!balanceSheet.actif.actifCirculant.creances) {
      warnings.push('Poste "Créances" manquant dans l\'actif circulant')
    }
  }

  if (!balanceSheet.actif.fraisEmissionEmprunts) {
    warnings.push('Poste "Frais d\'émission des emprunts" manquant (Art. 821-1 V)')
  }

  if (!balanceSheet.actif.primesRemboursementEmprunts) {
    warnings.push('Poste "Primes de remboursement des emprunts" manquant (Art. 821-1 VI)')
  }

  if (!balanceSheet.actif.ecartsConversionActif) {
    warnings.push('Poste "Écarts de conversion - Actif" manquant (Art. 821-1 VII)')
  }

  // PASSIF - Vérifier les postes obligatoires
  if (!balanceSheet.passif.capitauxPropres) {
    errors.push('Poste "Capitaux propres" manquant (Art. 821-1 I)')
  } else {
    // Vérifier les sous-postes des capitaux propres
    if (!balanceSheet.passif.capitauxPropres.capital) {
      errors.push('Poste "Capital" manquant dans les capitaux propres')
    }
    if (!balanceSheet.passif.capitauxPropres.reserves) {
      warnings.push('Poste "Réserves" manquant dans les capitaux propres')
    }
  }

  if (!balanceSheet.passif.autresFondsPropres) {
    warnings.push('Poste "Autres fonds propres" manquant (Art. 821-1 II)')
  }

  if (!balanceSheet.passif.provisions) {
    warnings.push('Poste "Provisions" manquant (Art. 821-1 III)')
  } else {
    // Vérifier la séparation provisions pour risques / provisions pour charges
    if (!balanceSheet.passif.provisions.provisionsRisques) {
      warnings.push('Poste "Provisions pour risques" manquant (Art. 821-1 III)')
    }
    if (!balanceSheet.passif.provisions.provisionsCharges) {
      warnings.push('Poste "Provisions pour charges" manquant (Art. 821-1 III)')
    }
  }

  if (!balanceSheet.passif.dettes) {
    errors.push('Poste "Dettes" manquant (Art. 821-1 IV)')
  } else {
    // Vérifier les sous-postes des dettes
    if (!balanceSheet.passif.dettes.dettesFournisseurs) {
      warnings.push('Poste "Dettes fournisseurs" manquant dans les dettes')
    }
    if (!balanceSheet.passif.dettes.dettesFiscalesSociales) {
      warnings.push('Poste "Dettes fiscales et sociales" manquant dans les dettes')
    }
  }

  if (!balanceSheet.passif.ecartsConversionPassif) {
    warnings.push('Poste "Écarts de conversion - Passif" manquant (Art. 821-1 V)')
  }

  // Vérifier IR3 : Postes vides pendant 2 exercices consécutifs peuvent être omis (Art. 811-3)
  // Cette vérification nécessiterait un historique, donc on ne peut que suggérer
  warnings.push('Vérifier IR3 : Les postes vides pendant 2 exercices consécutifs peuvent être omis (Art. 811-3)')

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validates income statement structure according to Art. 821-2
 */
export function validateIncomeStatementStructure(
  incomeStatement: CompleteIncomeStatement
): StructureValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Vérifier que tous les postes obligatoires sont présents selon Art. 821-2

  // PRODUITS - Vérifier les postes obligatoires
  if (!incomeStatement.produits.exploitation) {
    errors.push('Poste "Produits d\'exploitation" manquant (Art. 821-2 I)')
  } else {
    // Vérifier les sous-postes des produits d'exploitation
    if (!incomeStatement.produits.exploitation.ventesMarchandises) {
      warnings.push('Poste "Ventes de marchandises" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.exploitation.productionVendue) {
      warnings.push('Poste "Production vendue" manquant (Art. 821-2 IR4)')
    }
    if (incomeStatement.produits.exploitation.montantNetChiffreAffaires === undefined) {
      warnings.push('Poste "Montant net du chiffre d\'affaires" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.exploitation.productionStockee) {
      warnings.push('Poste "Production stockée" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.exploitation.productionImmobilisee) {
      warnings.push('Poste "Production immobilisée" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.exploitation.subventions) {
      warnings.push('Poste "Subventions" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.exploitation.reprisesAmortissementsDepreciationsProvisions) {
      warnings.push('Poste "Reprises sur amortissements, dépréciations et provisions" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.exploitation.produitsCessionsImmobilisations) {
      warnings.push('Poste "Produits des cessions d\'immobilisations" manquant (Art. 821-2 IR4)')
    }
  }

  if (!incomeStatement.produits.financiers) {
    warnings.push('Poste "Produits financiers" manquant (Art. 821-2 V)')
  } else {
    // Vérifier les sous-postes des produits financiers
    if (!incomeStatement.produits.financiers.participation) {
      warnings.push('Poste "Produits de participation" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.financiers.autresValeursMobilieresCreances) {
      warnings.push('Poste "Autres valeurs mobilières et créances" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.financiers.autresInteretsProduitsAssimiles) {
      warnings.push('Poste "Autres intérêts et produits assimilés" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.financiers.reprisesDepreciationsProvisions) {
      warnings.push('Poste "Reprises sur dépréciations et provisions" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.produits.financiers.differencesPositivesChange) {
      warnings.push('Poste "Différences positives de change" manquant (Art. 821-2 IR4)')
    }
  }

  if (!incomeStatement.produits.exceptionnels) {
    warnings.push('Poste "Produits exceptionnels" manquant (Art. 821-2 VII)')
  }

  // CHARGES - Vérifier les postes obligatoires
  if (!incomeStatement.charges.exploitation) {
    errors.push('Poste "Charges d\'exploitation" manquant (Art. 821-2 II)')
  } else {
    // Vérifier les sous-postes des charges d'exploitation
    if (!incomeStatement.charges.exploitation.achatsMarchandises) {
      warnings.push('Poste "Achats de marchandises" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.exploitation.variationStocksMarchandises) {
      warnings.push('Poste "Variation de stocks - marchandises" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.exploitation.achatsMatieresPremieres) {
      warnings.push('Poste "Achats de matières premières" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.exploitation.variationStocksMatieresPremieres) {
      warnings.push('Poste "Variation de stocks - matières premières" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.exploitation.autresAchatsChargesExternes) {
      warnings.push('Poste "Autres achats et charges externes" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.exploitation.impotsTaxes) {
      warnings.push('Poste "Impôts, taxes et versements assimilés" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.exploitation.salaires) {
      warnings.push('Poste "Salaires" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.exploitation.cotisationsSociales) {
      warnings.push('Poste "Cotisations sociales" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.exploitation.dotations) {
      warnings.push('Poste "Dotations" manquant (Art. 821-2 IR4)')
    } else {
      if (!incomeStatement.charges.exploitation.dotations.amortissementsImmobilisations) {
        warnings.push('Poste "Dotations aux amortissements sur immobilisations" manquant (Art. 821-2 IR4)')
      }
      if (!incomeStatement.charges.exploitation.dotations.depreciationsImmobilisations) {
        warnings.push('Poste "Dotations aux dépréciations sur immobilisations" manquant (Art. 821-2 IR4)')
      }
      if (!incomeStatement.charges.exploitation.dotations.depreciationsActifCirculant) {
        warnings.push('Poste "Dotations aux dépréciations sur actif circulant" manquant (Art. 821-2 IR4)')
      }
      if (!incomeStatement.charges.exploitation.dotations.provisions) {
        warnings.push('Poste "Dotations aux provisions" manquant (Art. 821-2 IR4)')
      }
    }
    if (!incomeStatement.charges.exploitation.valeursComptablesCessions) {
      warnings.push('Poste "Valeurs comptables des cessions" manquant (Art. 821-2 IR4)')
    }
  }

  if (!incomeStatement.charges.financieres) {
    warnings.push('Poste "Charges financières" manquant (Art. 821-2 VI)')
  } else {
    // Vérifier les sous-postes des charges financières
    if (!incomeStatement.charges.financieres.dotations) {
      warnings.push('Poste "Dotations financières" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.financieres.interetsChargesAssimilees) {
      warnings.push('Poste "Intérêts et charges assimilées" manquant (Art. 821-2 IR4)')
    }
    if (!incomeStatement.charges.financieres.differencesNegativesChange) {
      warnings.push('Poste "Différences négatives de change" manquant (Art. 821-2 IR4)')
    }
  }

  if (!incomeStatement.charges.exceptionnelles) {
    warnings.push('Poste "Charges exceptionnelles" manquant (Art. 821-2 VIII)')
  }

  if (!incomeStatement.charges.participationSalaries) {
    warnings.push('Poste "Participation des salariés" manquant (Art. 821-2 IX)')
  }

  if (!incomeStatement.charges.impotsBenefices) {
    warnings.push('Poste "Impôts sur les bénéfices" manquant (Art. 821-2 X)')
  }

  // Vérifier les calculs intermédiaires selon Art. 821-2
  if (!incomeStatement.calculs) {
    errors.push('Calculs intermédiaires manquants (Art. 821-2)')
  } else {
    // Vérifier que le résultat d'exploitation est calculé (I - II)
    if (incomeStatement.calculs.resultatExploitation === undefined) {
      errors.push('Résultat d\'exploitation manquant (Art. 821-2)')
    }

    // Vérifier que le résultat financier est calculé (V - VI)
    if (incomeStatement.calculs.resultatFinancier === undefined) {
      errors.push('Résultat financier manquant (Art. 821-2)')
    }

    // Vérifier que le résultat courant est calculé (I - II + III - IV + V - VI)
    if (incomeStatement.calculs.resultatCourant === undefined) {
      errors.push('Résultat courant avant impôts manquant (Art. 821-2)')
    }

    // Vérifier que le résultat exceptionnel est calculé (VII - VIII)
    if (incomeStatement.calculs.resultatExceptionnel === undefined) {
      errors.push('Résultat exceptionnel manquant (Art. 821-2)')
    }

    // Vérifier que le bénéfice ou perte est calculé
    if (incomeStatement.calculs.beneficeOuPerte === undefined) {
      errors.push('Bénéfice ou perte manquant (Art. 821-2)')
    }

    // Vérifier les totaux
    if (incomeStatement.calculs.totalProduits === undefined) {
      errors.push('Total des produits manquant (Art. 821-2)')
    }
    if (incomeStatement.calculs.totalCharges === undefined) {
      errors.push('Total des charges manquant (Art. 821-2)')
    }
  }

  // Vérifier IR3 : Montants négatifs entre parenthèses ou précédés du signe moins (-)
  warnings.push('Vérifier IR3 : Les montants négatifs doivent être présentés entre parenthèses ou précédés du signe moins (-)')

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
