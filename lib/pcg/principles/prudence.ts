/**
 * Principe de Prudence (Art. 121-4)
 * 
 * La comptabilité est établie sur la base d'appréciations prudentes, pour éviter
 * le risque de transfert, sur des périodes à venir, d'incertitudes présentes
 * susceptibles de grever le patrimoine et le résultat de l'entité.
 */

import type { EntryLine } from '@/lib/accounting/types'
import { isAccountCode } from '@/lib/accounting/account-code'

export interface PrudenceValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  recommendations: string[]
}

/**
 * Valide qu'une écriture respecte le principe de prudence
 */
export function validatePrudence(entry: {
  date: Date
  lines: EntryLine[]
  description?: string
}): PrudenceValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const recommendations: string[] = []
  
  // Vérifier que les produits ne sont pas comptabilisés de manière anticipée
  for (const line of entry.lines) {
    const credit = Number(line.credit || 0)
    
    // Si c'est un produit (classe 7) avec un crédit
    if (credit > 0 && line.accountId) {
      const accountCode = extractAccountCode(line.accountId)
      if (accountCode && accountCode.startsWith('7')) {
        // Vérifier que le produit est réalisé (pas de produit constaté d'avance non justifié)
        if (entry.description) {
          const descLower = entry.description.toLowerCase()
          if (descLower.includes('constaté d\'avance') || descLower.includes('anticipé')) {
            warnings.push(
              `Produit constaté d'avance détecté sur compte ${accountCode}: ` +
              `vérifier que la prestation est bien réalisée (principe de prudence)`
            )
          }
        }
      }
    }
  }
  
  // Vérifier que les charges sont bien comptabilisées
  for (const line of entry.lines) {
    const debit = Number(line.debit || 0)
    
    // Si c'est une charge (classe 6) avec un débit
    if (debit > 0 && line.accountId) {
      const accountCode = extractAccountCode(line.accountId)
      if (accountCode && accountCode.startsWith('6')) {
        // Vérifier que la charge est bien engagée
        if (entry.description) {
          const descLower = entry.description.toLowerCase()
          if (descLower.includes('prévision') || descLower.includes('estimé')) {
            warnings.push(
              `Charge prévisionnelle détectée sur compte ${accountCode}: ` +
              `vérifier qu'elle correspond à une obligation réelle (principe de prudence)`
            )
          }
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    recommendations,
  }
}

/**
 * Recommande des provisions selon le principe de prudence
 */
export function recommendProvisions(entry: {
  date: Date
  description?: string
  lines: EntryLine[]
}): string[] {
  const recommendations: string[] = []
  
  // Détecter des situations nécessitant des provisions
  if (entry.description) {
    const descLower = entry.description.toLowerCase()
    
    // Garanties
    if (descLower.includes('garantie') || descLower.includes('réparation')) {
      recommendations.push(
        'Vérifier si une provision pour garanties doit être constituée (Art. 322-7)'
      )
    }
    
    // Litiges
    if (descLower.includes('litige') || descLower.includes('procès') || descLower.includes('contentieux')) {
      recommendations.push(
        'Vérifier si une provision pour litiges doit être constituée (Art. 322-8)'
      )
    }
    
    // Restructurations
    if (descLower.includes('restructuration') || descLower.includes('plan social')) {
      recommendations.push(
        'Vérifier si une provision pour restructuration doit être constituée (Art. 322-10)'
      )
    }
    
    // Contrats en perte
    if (descLower.includes('contrat') && (descLower.includes('perte') || descLower.includes('déficit'))) {
      recommendations.push(
        'Vérifier si une provision pour perte sur contrat doit être constituée (Art. 322-9)'
      )
    }
  }
  
  return recommendations
}

/**
 * Extrait le code de compte depuis un accountId
 * (simplifié - à adapter selon votre modèle de données)
 */
function extractAccountCode(accountId: string): string | null {
  // Si accountId est déjà un code (format numérique)
  if (isAccountCode(accountId)) {
    return accountId
  }
  
  // Sinon, on devrait récupérer le code depuis la base de données
  // Pour l'instant, retourner null
  return null
}

/**
 * Valide que les dépréciations sont bien comptabilisées (principe de prudence)
 */
export function validateImpairments(entry: {
  date: Date
  description?: string
  lines: EntryLine[]
}): PrudenceValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const recommendations: string[] = []
  
  // Vérifier si des dépréciations devraient être comptabilisées
  if (entry.description) {
    const descLower = entry.description.toLowerCase()
    
    // Détecter des situations de dépréciation
    const impairmentIndicators = [
      'dépréciation',
      'perte de valeur',
      'moins-value',
      'déprécié',
      'obsolescence',
    ]
    
    const hasImpairmentIndicator = impairmentIndicators.some(indicator =>
      descLower.includes(indicator)
    )
    
    if (hasImpairmentIndicator) {
      // Vérifier qu'une dépréciation est bien comptabilisée
      const hasDepreciationAccount = entry.lines.some(line => {
        const accountCode = extractAccountCode(line.accountId)
        return accountCode && (accountCode.startsWith('29') || accountCode.startsWith('39'))
      })
      
      if (!hasDepreciationAccount) {
        warnings.push(
          'Indicateur de dépréciation détecté mais aucune écriture de dépréciation trouvée. ' +
          'Vérifier qu\'une dépréciation est bien comptabilisée (principe de prudence)'
        )
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    recommendations,
  }
}
