/**
 * Vérificateur de Conformité PCG 2026
 * 
 * Vérifie la conformité globale de l'application avec les règles PCG 2026
 */

import type { PCGRulesCatalog, ComplianceReport } from './types'
import { getCatalog } from './rules-catalog'
import { analyzeCompliance } from './gap-analysis'

/**
 * Génère un rapport de conformité complet
 */
export function generateComplianceReport(
  companyId?: string,
  catalog?: PCGRulesCatalog
): ComplianceReport {
  const rulesCatalog = catalog || getCatalog()
  return analyzeCompliance(rulesCatalog)
}

// The entry check is pure and lives in its own module: the app imports it
// (lib/accounting/validator.ts) without this file, whose disk reads would make
// the build trace the whole project into the server output.
export { checkEntryCompliance } from './entry-compliance'
