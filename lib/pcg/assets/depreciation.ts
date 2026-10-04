/**
 * Amortissements (Art. 214-7 à 214-15)
 * 
 * Les éléments de l'actif immobilisé dont la durée d'utilisation est limitée
 * sont amortis sur cette durée selon un plan d'amortissement.
 */

export type DepreciationMethod = 'linear' | 'declining' | 'units-of-production'

export interface DepreciationPlan {
  id: string
  assetId: string
  method: DepreciationMethod
  usefulLife: number // Durée d'utilisation en années (Art. 214-7)
  usefulLifeUnlimited: boolean // Durée d'utilisation non limitée (Art. 214-7)
  residualValue: number // Valeur résiduelle (Art. 214-12)
  acquisitionCost: number
  startDate: Date
  endDate?: Date
}

export interface DepreciationCalculation {
  period: { start: Date; end: Date }
  annualDepreciation: number
  accumulatedDepreciation: number
  netBookValue: number
}

/**
 * Calcule l'amortissement linéaire (Art. 214-13)
 */
export function calculateLinearDepreciation(
  plan: DepreciationPlan,
  asOfDate: Date
): DepreciationCalculation {
  if (plan.usefulLifeUnlimited || !plan.usefulLife) {
    return {
      period: { start: plan.startDate, end: asOfDate },
      annualDepreciation: 0,
      accumulatedDepreciation: 0,
      netBookValue: plan.acquisitionCost,
    }
  }
  
  // Amortissement linéaire = (Coût d'acquisition - Valeur résiduelle) / Durée d'utilisation
  const depreciableAmount = plan.acquisitionCost - plan.residualValue
  const annualDepreciation = depreciableAmount / plan.usefulLife
  
  // Calculer le nombre d'années écoulées
  const yearsElapsed = Math.floor(
    (asOfDate.getTime() - plan.startDate.getTime()) / (1000 * 60 * 60 * 24 * 365)
  )
  
  const accumulatedDepreciation = Math.min(
    annualDepreciation * yearsElapsed,
    depreciableAmount
  )
  
  const netBookValue = plan.acquisitionCost - accumulatedDepreciation
  
  return {
    period: { start: plan.startDate, end: asOfDate },
    annualDepreciation,
    accumulatedDepreciation,
    netBookValue: Math.max(netBookValue, plan.residualValue),
  }
}

/**
 * Calcule l'amortissement dégressif (Art. 214-13)
 */
export function calculateDecliningDepreciation(
  plan: DepreciationPlan,
  asOfDate: Date,
  coefficient: number = 1.75 // Coefficient dégressif par défaut
): DepreciationCalculation {
  if (plan.usefulLifeUnlimited || !plan.usefulLife) {
    return {
      period: { start: plan.startDate, end: asOfDate },
      annualDepreciation: 0,
      accumulatedDepreciation: 0,
      netBookValue: plan.acquisitionCost,
    }
  }
  
  const depreciableAmount = plan.acquisitionCost - plan.residualValue
  const linearRate = 1 / plan.usefulLife
  const decliningRate = linearRate * coefficient
  
  // Calculer année par année
  let accumulatedDepreciation = 0
  let currentBookValue = plan.acquisitionCost
  const yearsElapsed = Math.floor(
    (asOfDate.getTime() - plan.startDate.getTime()) / (1000 * 60 * 60 * 24 * 365)
  )
  
  for (let year = 0; year < yearsElapsed; year++) {
    const annualDepreciation = currentBookValue * decliningRate
    accumulatedDepreciation += annualDepreciation
    currentBookValue -= annualDepreciation
    
    // Basculer en linéaire si l'amortissement linéaire devient supérieur
    const remainingYears = plan.usefulLife - year - 1
    if (remainingYears > 0) {
      const linearDepreciation = currentBookValue / remainingYears
      if (linearDepreciation > annualDepreciation) {
        // Basculer en linéaire pour les années restantes
        const linearTotal = currentBookValue - plan.residualValue
        accumulatedDepreciation += linearTotal
        currentBookValue = plan.residualValue
        break
      }
    }
  }
  
  const netBookValue = Math.max(plan.acquisitionCost - accumulatedDepreciation, plan.residualValue)
  const annualDepreciation = yearsElapsed > 0
    ? accumulatedDepreciation / yearsElapsed
    : 0
  
  return {
    period: { start: plan.startDate, end: asOfDate },
    annualDepreciation,
    accumulatedDepreciation: Math.min(accumulatedDepreciation, depreciableAmount),
    netBookValue,
  }
}

/**
 * Valide un plan d'amortissement (Art. 214-7)
 */
export function validateDepreciationPlan(plan: DepreciationPlan): {
  valid: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []
  
  // Vérifier la durée d'utilisation
  if (!plan.usefulLifeUnlimited) {
    if (!plan.usefulLife || plan.usefulLife <= 0) {
      errors.push('La durée d\'utilisation doit être positive (Art. 214-7)')
    }
    
    if (plan.usefulLife > 100) {
      warnings.push('La durée d\'utilisation semble très longue, vérifier sa pertinence')
    }
  }
  
  // Vérifier la valeur résiduelle
  if (plan.residualValue < 0) {
    errors.push('La valeur résiduelle ne peut pas être négative')
  }
  
  if (plan.residualValue >= plan.acquisitionCost) {
    errors.push('La valeur résiduelle ne peut pas être supérieure ou égale au coût d\'acquisition')
  }
  
  // Vérifier la méthode
  const validMethods: DepreciationMethod[] = ['linear', 'declining', 'units-of-production']
  if (!validMethods.includes(plan.method)) {
    errors.push(`Méthode d'amortissement non valide: ${plan.method}`)
  }
  
  // Vérifier les dates
  if (plan.endDate && plan.endDate <= plan.startDate) {
    errors.push('La date de fin doit être postérieure à la date de début')
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Détermine si une immobilisation a une durée d'utilisation limitée (Art. 214-7)
 */
export function hasLimitedUsefulLife(asset: {
  type: string
  expectedLifespan?: number
  indefiniteUse?: boolean
}): boolean {
  // Si l'utilisation est indéfinie, la durée n'est pas limitée
  if (asset.indefiniteUse) {
    return false
  }
  
  // Sinon, vérifier si une durée d'utilisation peut être déterminée
  return asset.expectedLifespan !== undefined && asset.expectedLifespan > 0
}
