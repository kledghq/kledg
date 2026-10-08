/**
 * Service pour la gestion des immobilisations avec validations PCG intégrées
 * 
 * Implémente les règles PCG 2026 Art. 211-6, 213-1 à 213-9, 214-1 à 214-19
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { validateAcquisitionCost } from '../assets/initial-valuation'
import { validateDepreciationPlan, calculateLinearDepreciation } from '../assets/depreciation'
import { ValidationError } from '@/lib/accounting/errors'

export interface PCGWarning {
  code: string
  message: string
  severity: 'info' | 'warning' | 'error'
  article?: string
}

export interface ServiceResult<T> {
  data: T
  warnings: PCGWarning[]
}

export interface CreateFixedAssetData {
  companyId: string
  label: string
  comment?: string
  acquisitionDate: Date
  acquisitionValue: number
  amortizableAmount?: number
  disposalDate?: Date
  depreciationRate?: number
  depreciationDuration?: number
  depreciationMethod: 'linear' | 'declining'
  decliningCoefficient?: number
  depreciationStartDate: Date
  assetAccountId: string
  depreciationAccountId: string
  expenseAccountId: string
  isFullyPaid?: boolean
}

/**
 * Créer une immobilisation avec validation PCG
 */
export async function createFixedAssetWithPCGValidation(
  data: CreateFixedAssetData,
  client: Pick<typeof prisma, 'account'> = prisma,
): Promise<ServiceResult<{ id: string; warnings: PCGWarning[] }>> {
  const warnings: PCGWarning[] = []

  // Valider le coût d'acquisition selon Art. 213-1
  const costValidation = validateAcquisitionCost({
    id: 'temp',
    assetId: 'temp',
    acquisitionType: 'purchase', // Par défaut, à améliorer si on a le type
    purchasePrice: data.acquisitionValue,
    additionalCosts: 0, // À améliorer si on a les coûts additionnels
    totalCost: data.acquisitionValue,
  })

  if (!costValidation.valid) {
    throw new ValidationError(`Validation coût d'acquisition échouée : ${costValidation.errors.join(', ')}`)
  }

  costValidation.warnings.forEach(w => {
    warnings.push({
      code: 'PCG-213-1',
      message: w,
      severity: 'warning',
      article: '213-1',
    })
  })

  // Vérifier la cohérence entre montant amortissable et valeur d'acquisition
  const amortizableAmount = data.amortizableAmount || data.acquisitionValue
  if (amortizableAmount > data.acquisitionValue) {
    warnings.push({
      code: 'PCG-213-1',
      message: `Le montant amortissable (${amortizableAmount}) est supérieur à la valeur d'acquisition (${data.acquisitionValue}). Vérifier la cohérence (Art. 213-1).`,
      severity: 'warning',
      article: '213-1',
    })
  }

  // Valider le plan d'amortissement selon Art. 214-1
  if (data.depreciationRate || data.depreciationDuration) {
    // Construire un plan d'amortissement temporaire pour la validation
    const tempPlan = {
      id: 'temp',
      assetId: 'temp',
      method: data.depreciationMethod as 'linear' | 'declining' | 'units-of-production',
      usefulLife: data.depreciationDuration || 0,
      usefulLifeUnlimited: !data.depreciationDuration,
      residualValue: Math.max(0, data.acquisitionValue - amortizableAmount),
      acquisitionCost: data.acquisitionValue,
      startDate: data.depreciationStartDate,
    }
    
    const depreciationValidation = validateDepreciationPlan(tempPlan)

    if (!depreciationValidation.valid) {
      throw new ValidationError(`Validation plan d'amortissement échouée : ${depreciationValidation.errors.join(', ')}`)
    }

    depreciationValidation.warnings.forEach(w => {
      warnings.push({
        code: 'PCG-214-1',
        message: w,
        severity: 'warning',
        article: '214-1',
      })
    })
  }

  // Avertissement si méthode dégressive sans coefficient
  if (data.depreciationMethod === 'declining' && !data.decliningCoefficient) {
    warnings.push({
      code: 'PCG-214-1',
      message: 'Méthode d\'amortissement dégressive sélectionnée mais coefficient dégressif non renseigné. Vérifier la conformité (Art. 214-1).',
      severity: 'warning',
      article: '214-1',
    })
  }

  // Avertissement si date de début d'amortissement avant date d'acquisition
  if (data.depreciationStartDate < data.acquisitionDate) {
    warnings.push({
      code: 'PCG-214-1',
      message: 'La date de début d\'amortissement est antérieure à la date d\'acquisition. Vérifier la cohérence (Art. 214-1).',
      severity: 'warning',
      article: '214-1',
    })
  }

  // Vérifier que les comptes sont corrects
  const assetAccount = await client.account.findUnique({
    where: { id: data.assetAccountId },
    select: { code: true, label: true },
  })

  if (assetAccount && !assetAccount.code.startsWith('2')) {
    warnings.push({
      code: 'PCG-211-6',
      message: `Le compte d'actif sélectionné (${assetAccount.code}) ne commence pas par 2. Vérifier qu'il s'agit bien d'un compte d'immobilisation (Art. 211-6).`,
      severity: 'warning',
      article: '211-6',
    })
  }

  const depreciationAccount = await client.account.findUnique({
    where: { id: data.depreciationAccountId },
    select: { code: true, label: true },
  })

  if (depreciationAccount && !depreciationAccount.code.startsWith('28')) {
    warnings.push({
      code: 'PCG-214-1',
      message: `Le compte d'amortissement sélectionné (${depreciationAccount.code}) ne commence pas par 28. Vérifier qu'il s'agit bien d'un compte d'amortissement (Art. 214-1).`,
      severity: 'warning',
      article: '214-1',
    })
  }

  const expenseAccount = await client.account.findUnique({
    where: { id: data.expenseAccountId },
    select: { code: true, label: true },
  })

  if (expenseAccount && !expenseAccount.code.startsWith('681')) {
    warnings.push({
      code: 'PCG-214-1',
      message: `Le compte de charge d'amortissement sélectionné (${expenseAccount.code}) ne commence pas par 681. Vérifier qu'il s'agit bien d'un compte de dotation aux amortissements (Art. 214-1).`,
      severity: 'warning',
      article: '214-1',
    })
  }

  // Créer l'immobilisation (la création réelle se fait dans la route API)
  // On retourne juste les avertissements pour que la route API les utilise

  logger.info(`Immobilisation validée avec ${warnings.length} avertissement(s) PCG`, {
    companyId: data.companyId,
    label: data.label,
    acquisitionValue: data.acquisitionValue,
  })

  return {
    data: {
      id: 'temp-id', // L'ID réel sera créé par la route API
      warnings,
    },
    warnings,
  }
}

/**
 * Valider une immobilisation avant création (pour utilisation dans route API)
 */
export async function validateFixedAssetBeforeCreation(
  data: CreateFixedAssetData,
  client: Pick<typeof prisma, 'account'> = prisma,
): Promise<{ valid: boolean; warnings: PCGWarning[]; errors: string[] }> {
  const errors: string[] = []
  const warnings: PCGWarning[] = []

  try {
    const result = await createFixedAssetWithPCGValidation(data, client)
    return {
      valid: true,
      warnings: result.warnings,
      errors: [],
    }
  } catch (error) {
    return {
      valid: false,
      warnings: [],
      errors: [error instanceof Error ? error.message : 'Erreur de validation'],
    }
  }
}
