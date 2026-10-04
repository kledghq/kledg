/**
 * Génération de rapports PCG pour les imports
 * 
 * Collecte et formate les avertissements PCG générés lors des imports
 */

import type { PCGWarning } from '@/lib/accounting/services'

export interface PCGImportReport {
  totalWarnings: number
  warningsByCode: Map<string, number>
  warningsByArticle: Map<string, number>
  warningsBySeverity: Map<'info' | 'warning' | 'error', number>
  sampleWarnings: PCGWarning[]
}

/**
 * Génère un rapport PCG à partir d'une liste d'avertissements
 */
export function generatePCGImportReport(
  warnings: PCGWarning[]
): PCGImportReport {
  const warningsByCode = new Map<string, number>()
  const warningsByArticle = new Map<string, number>()
  const warningsBySeverity = new Map<'info' | 'warning' | 'error', number>()

  for (const warning of warnings) {
    // Par code
    const codeCount = warningsByCode.get(warning.code) || 0
    warningsByCode.set(warning.code, codeCount + 1)

    // Par article
    if (warning.article) {
      const articleCount = warningsByArticle.get(warning.article) || 0
      warningsByArticle.set(warning.article, articleCount + 1)
    }

    // Par sévérité
    const severityCount = warningsBySeverity.get(warning.severity) || 0
    warningsBySeverity.set(warning.severity, severityCount + 1)
  }

  // Échantillon d'avertissements (max 10)
  const sampleWarnings = warnings.slice(0, 10)

  return {
    totalWarnings: warnings.length,
    warningsByCode,
    warningsByArticle,
    warningsBySeverity,
    sampleWarnings,
  }
}
