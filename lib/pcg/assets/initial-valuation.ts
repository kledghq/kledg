/**
 * Évaluation des Actifs à l'Entrée (Art. 213-1 à 213-9)
 * 
 * Les immobilisations corporelles ou incorporelles et les stocks doivent être
 * évalués initialement à leur coût.
 */

export type AcquisitionType = 'purchase' | 'production' | 'gift' | 'exchange' | 'contribution'

export interface AssetAcquisition {
  id: string
  assetId: string
  acquisitionType: AcquisitionType
  purchasePrice: number
  additionalCosts: number // Droits de mutation, honoraires, commissions, frais d'actes
  borrowingCosts?: number // Coûts d'emprunt (Art. 213-9)
  dismantlingCosts?: number // Coûts de démantèlement (Art. 213-8)
  trainingCosts?: number // Frais de formation (optionnel, Art. 213-8)
  totalCost: number
}

/**
 * Calcule le coût d'acquisition d'une immobilisation corporelle (Art. 213-8)
 */
export function calculateAcquisitionCost(acquisition: AssetAcquisition): number {
  let cost = acquisition.purchasePrice
  
  // Ajouter les coûts directement attribuables
  cost += acquisition.additionalCosts
  
  // Ajouter les coûts de démantèlement (si applicable)
  if (acquisition.dismantlingCosts) {
    cost += acquisition.dismantlingCosts
  }
  
  // Ajouter les coûts d'emprunt (si capitalisés, Art. 213-9)
  if (acquisition.borrowingCosts) {
    cost += acquisition.borrowingCosts
  }
  
  // Ajouter les frais de formation (optionnel, Art. 213-8)
  if (acquisition.trainingCosts) {
    cost += acquisition.trainingCosts
  }
  
  return cost
}

/**
 * Valide le coût d'acquisition selon le type d'acquisition (Art. 213-1)
 */
export function validateAcquisitionCost(
  acquisition: AssetAcquisition
): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []
  
  // Vérifier selon le type d'acquisition
  switch (acquisition.acquisitionType) {
    case 'purchase':
      // Actifs acquis à titre onéreux → coût d'acquisition
      if (acquisition.purchasePrice <= 0) {
        errors.push('Le prix d\'achat doit être positif pour un actif acquis à titre onéreux')
      }
      break
      
    case 'production':
      // Actifs produits → coût de production
      if (acquisition.purchasePrice <= 0) {
        errors.push('Le coût de production doit être positif')
      }
      break
      
    case 'gift':
      // Actifs acquis à titre gratuit → valeur vénale
      if (acquisition.purchasePrice <= 0) {
        errors.push('La valeur vénale doit être positive pour un actif acquis à titre gratuit')
      }
      warnings.push('Vérifier que la valeur vénale correspond au prix qui aurait été acquitté dans des conditions normales de marché')
      break
      
    case 'exchange':
      // Actifs acquis par échange → valeur vénale
      if (acquisition.purchasePrice <= 0) {
        errors.push('La valeur vénale doit être positive pour un actif acquis par échange')
      }
      warnings.push('Vérifier que l\'échange a une substance commerciale (Art. 213-3)')
      break
      
    case 'contribution':
      // Apport en nature → valeur du traité d'apport
      if (acquisition.purchasePrice <= 0) {
        errors.push('La valeur du traité d\'apport doit être positive')
      }
      break
  }
  
  // Vérifier que le coût total est cohérent
  const calculatedCost = calculateAcquisitionCost(acquisition)
  if (Math.abs(calculatedCost - acquisition.totalCost) > 0.01) {
    errors.push(
      `Incohérence dans le calcul du coût: calculé ${calculatedCost}, saisi ${acquisition.totalCost}`
    )
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
