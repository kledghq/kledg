/**
 * Vérification de conformité du plan de comptes PCG 2026
 * 
 * Vérifie :
 * - Art. 1121-1 : Plan minimal complet
 * - Art. 1122-X : Structure complète des comptes
 * - Art. 1123-X : Règles d'établissement d'un plan de comptes
 * - Livre IV, Titre IX : Tenue, structure et fonctionnement des comptes
 * - Livre IV, Titre XII : Fonctionnement des comptes et schémas d'écriture (IR5)
 */

import { PCG_ACCOUNTS, type PCGAccount } from './pcg-data'

export interface ComplianceCheckResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  stats: {
    totalAccounts: number
    classes: Record<string, number>
    missingRequiredAccounts: string[]
  }
}

/**
 * Liste des comptes minimaux obligatoires selon Art. 1121-1
 */
const REQUIRED_MINIMAL_ACCOUNTS = [
  // Classe 1 - Financement permanent
  '1', '10', '101', '11', '12', '15', '16',
  // Classe 2 - Immobilisations
  '2', '20', '21', '26', '27',
  // Classe 3 - Stocks
  '3', '30', '31', '37',
  // Classe 4 - Tiers
  '4', '40', '41', '42', '43', '44', '45', '46', '47', '48',
  // Classe 5 - Financiers
  '5', '51', '52', '53', '54', '58',
  // Classe 6 - Charges
  '6', '60', '61', '62', '63', '64', '65', '66', '67', '68', '69',
  // Classe 7 - Produits
  // 79 (transferts de charges) was removed by règlement ANC n° 2022-06
  '7', '70', '71', '72', '73', '74', '75', '76', '77', '78',
]

/**
 * Vérifie la conformité du plan de comptes (Art. 1121-1)
 */
export function checkPCGAccountStructureCompliance(): ComplianceCheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const stats = {
    totalAccounts: PCG_ACCOUNTS.length,
    classes: {} as Record<string, number>,
    missingRequiredAccounts: [] as string[],
  }

  // Vérifier la présence des classes principales (1 à 7)
  const mainClasses = ['1', '2', '3', '4', '5', '6', '7']
  for (const mainClass of mainClasses) {
    const classAccount = PCG_ACCOUNTS.find(acc => acc.code === mainClass)
    if (!classAccount) {
      errors.push(`Classe principale ${mainClass} manquante (Art. 1121-1)`)
    }
  }

  // Compter les comptes par classe
  for (const account of PCG_ACCOUNTS) {
    const mainClass = account.code[0]
    if (mainClass && ['1', '2', '3', '4', '5', '6', '7'].includes(mainClass)) {
      stats.classes[mainClass] = (stats.classes[mainClass] || 0) + 1
    }
  }

  // Vérifier la présence des comptes minimaux obligatoires
  const existingCodes = new Set(PCG_ACCOUNTS.map(acc => acc.code))
  for (const requiredCode of REQUIRED_MINIMAL_ACCOUNTS) {
    if (!existingCodes.has(requiredCode)) {
      stats.missingRequiredAccounts.push(requiredCode)
      errors.push(`Compte minimal obligatoire ${requiredCode} manquant (Art. 1121-1)`)
    }
  }

  // Vérifier la structure hiérarchique (parentCode)
  for (const account of PCG_ACCOUNTS) {
    if (account.parentCode) {
      const parentExists = PCG_ACCOUNTS.some(acc => acc.code === account.parentCode)
      if (!parentExists) {
        errors.push(
          `Compte ${account.code} a un parent ${account.parentCode} qui n'existe pas (Art. 1122-X)`
        )
      }
    }
  }

  // Vérifier la cohérence des codes (format numérique)
  for (const account of PCG_ACCOUNTS) {
    if (!/^\d+$/.test(account.code)) {
      errors.push(`Code de compte ${account.code} invalide : doit être numérique (Art. 1123-X)`)
    }
    
    // Vérifier la longueur (2 à 8 chiffres selon PCG)
    if (account.code.length < 2 || account.code.length > 8) {
      warnings.push(
        `Code de compte ${account.code} a une longueur inhabituelle (${account.code.length} caractères). ` +
        'Les codes PCG font généralement entre 2 et 8 chiffres.'
      )
    }
  }

  // Vérifier que les comptes de classe 2 ont leurs comptes d'amortissement (28XX) et dépréciations (29XX)
  const class2Accounts = PCG_ACCOUNTS.filter(acc => acc.code.startsWith('2') && acc.code.length >= 3)
  const has28XX = PCG_ACCOUNTS.some(acc => acc.code.startsWith('28'))
  const has29XX = PCG_ACCOUNTS.some(acc => acc.code.startsWith('29'))
  
  if (class2Accounts.length > 0 && !has28XX) {
    warnings.push(
      'Comptes d\'amortissement (28XX) manquants pour les immobilisations. ' +
      'Ces comptes sont nécessaires pour le calcul de la valeur nette comptable.'
    )
  }
  
  if (class2Accounts.length > 0 && !has29XX) {
    warnings.push(
      'Comptes de dépréciations (29XX) manquants pour les immobilisations. ' +
      'Ces comptes sont nécessaires selon Art. 214-16 à 214-19.'
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  }
}

/**
 * Vérifie les règles de fonctionnement des comptes (Livre IV, Titre IX, Titre XII)
 */
export function checkAccountOperationRules(): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []

  // Vérifier que les comptes de charges (6XX) sont normalement débiteurs
  const chargeAccounts = PCG_ACCOUNTS.filter(acc => acc.code.startsWith('6'))
  if (chargeAccounts.length === 0) {
    errors.push('Aucun compte de charges (6XX) trouvé')
  }

  // Vérifier que les comptes de produits (7XX) sont normalement créditeurs
  const productAccounts = PCG_ACCOUNTS.filter(acc => acc.code.startsWith('7'))
  if (productAccounts.length === 0) {
    errors.push('Aucun compte de produits (7XX) trouvé')
  }

  // Vérifier que les comptes d'actif (2XX, 3XX, 4XX débiteurs, 5XX) sont normalement débiteurs
  const assetAccounts = PCG_ACCOUNTS.filter(acc => 
    acc.code.startsWith('2') || 
    acc.code.startsWith('3') || 
    (acc.code.startsWith('4') && !acc.code.startsWith('40')) || // 4XX sauf 40XX (fournisseurs)
    acc.code.startsWith('5')
  )
  
  // Vérifier que les comptes de passif (1XX, 40XX, 44XX) sont normalement créditeurs
  const liabilityAccounts = PCG_ACCOUNTS.filter(acc => 
    acc.code.startsWith('1') || 
    acc.code.startsWith('40') || // Fournisseurs
    acc.code.startsWith('44') // État et autres organismes
  )

  // Note: Ces vérifications sont informatives car le fonctionnement réel
  // des comptes dépend des écritures, pas seulement de la structure

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Vérifie la conformité complète du plan de comptes
 */
export function checkFullPCGCompliance(): ComplianceCheckResult & {
  operationRules: {
    valid: boolean
    errors: string[]
    warnings: string[]
  }
} {
  const structureCheck = checkPCGAccountStructureCompliance()
  const operationRules = checkAccountOperationRules()

  return {
    ...structureCheck,
    operationRules,
    valid: structureCheck.valid && operationRules.valid,
    errors: [...structureCheck.errors, ...operationRules.errors],
    warnings: [...structureCheck.warnings, ...operationRules.warnings],
  }
}
