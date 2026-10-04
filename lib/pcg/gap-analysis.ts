/**
 * Analyse des écarts de conformité PCG 2026
 * 
 * Compare l'implémentation actuelle avec les règles PCG 2026
 * et génère un rapport d'écarts détaillé
 */

import type { PCGRule, PCGRulesCatalog, ComplianceStatus, ComplianceReport } from './types'
import { getCatalog } from './rules-catalog'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * Mapping des règles PCG vers les fichiers d'implémentation
 */
interface ImplementationMapping {
  ruleId: string
  files: string[]
  status: ComplianceStatus['status']
  notes?: string
}

/**
 * Mapping manuel des règles vers les fichiers (à compléter)
 */
const IMPLEMENTATION_MAPPINGS: ImplementationMapping[] = [
  // Principes généraux
  {
    ruleId: '121-1',
    files: ['lib/accounting/validator.ts'],
    status: 'partial',
    notes: 'Image fidèle partiellement implémentée via validation',
  },
  {
    ruleId: '121-2',
    files: [],
    status: 'not-implemented',
    notes: 'Comparabilité et continuité d\'activité non implémentées',
  },
  {
    ruleId: '121-3',
    files: ['lib/accounting/validator.ts'],
    status: 'partial',
    notes: 'Régularité et sincérité partiellement implémentées',
  },
  {
    ruleId: '121-4',
    files: [],
    status: 'not-implemented',
    notes: 'Principe de prudence non implémenté',
  },
  {
    ruleId: '121-5',
    files: [],
    status: 'not-implemented',
    notes: 'Permanence des méthodes non implémentée',
  },
  
  // Actifs - Définitions
  {
    ruleId: '211-1',
    files: [],
    status: 'not-implemented',
    notes: 'Définition des actifs non implémentée',
  },
  {
    ruleId: '211-6',
    files: ['prisma/schema.prisma'],
    status: 'partial',
    notes: 'Immobilisations corporelles partiellement implémentées (modèle FixedAsset)',
  },
  
  // Actifs - Amortissements
  {
    ruleId: '214-7',
    files: ['app/api/fixed-assets/[id]/depreciation/route.ts', 'lib/accounting/services.ts'],
    status: 'partial',
    notes: 'Amortissements implémentés mais règles PCG complètes manquantes',
  },
  {
    ruleId: '214-16',
    files: [],
    status: 'not-implemented',
    notes: 'Dépréciations non implémentées',
  },
  
  // Passifs
  {
    ruleId: '321-1',
    files: [],
    status: 'not-implemented',
    notes: 'Définition des passifs non implémentée',
  },
  {
    ruleId: '322-1',
    files: [],
    status: 'not-implemented',
    notes: 'Comptabilisation des passifs non implémentée',
  },
  
  // Charges et produits
  {
    ruleId: '511-1',
    files: ['lib/reports/income-statement.ts'],
    status: 'partial',
    notes: 'Charges partiellement implémentées dans le compte de résultat',
  },
  {
    ruleId: '512-1',
    files: ['lib/reports/income-statement.ts'],
    status: 'partial',
    notes: 'Produits partiellement implémentés dans le compte de résultat',
  },
]

/**
 * Vérifie si un fichier existe dans le projet
 */
function fileExists(filePath: string): boolean {
  const fullPath = join(process.cwd(), filePath)
  return existsSync(fullPath)
}

/**
 * Analyse la conformité d'une règle
 */
function analyzeRuleCompliance(
  rule: PCGRule,
  mappings: ImplementationMapping[]
): ComplianceStatus {
  const mapping = mappings.find(m => m.ruleId === rule.id)
  
  if (mapping) {
    // Vérifier que les fichiers existent
    const existingFiles = mapping.files.filter(f => fileExists(f))
    const missingFiles = mapping.files.filter(f => !fileExists(f))
    
    let status: ComplianceStatus['status'] = mapping.status
    
    // Si tous les fichiers sont manquants, c'est non implémenté
    if (existingFiles.length === 0 && mapping.files.length > 0) {
      status = 'not-implemented'
    }
    
    return {
      ruleId: rule.id,
      status,
      implementationFile: existingFiles[0],
      testFile: findTestFile(rule.id),
      notes: mapping.notes || (missingFiles.length > 0 ? `Fichiers manquants: ${missingFiles.join(', ')}` : undefined),
      lastChecked: new Date(),
    }
  }
  
  // Par défaut, chercher des indices dans le code
  return {
    ruleId: rule.id,
    status: 'not-implemented',
    notes: 'Aucune implémentation détectée',
    lastChecked: new Date(),
  }
}

/**
 * Trouve le fichier de test associé à une règle
 */
function findTestFile(ruleId: string): string | undefined {
  const testPaths = [
    `lib/pcg/__tests__/rules-${ruleId}.test.ts`,
    `lib/__tests__/pcg-${ruleId}.test.ts`,
    `lib/pcg/__tests__/${ruleId.replace('-', '_')}.test.ts`,
  ]
  
  for (const path of testPaths) {
    if (fileExists(path)) {
      return path
    }
  }
  
  return undefined
}

/**
 * Analyse la conformité de toutes les règles
 */
export function analyzeCompliance(
  catalog?: PCGRulesCatalog,
  mappings: ImplementationMapping[] = IMPLEMENTATION_MAPPINGS
): ComplianceReport {
  const rulesCatalog = catalog || getCatalog()
  
  const statuses: ComplianceStatus[] = []
  
  // Analyser chaque règle
  for (const rule of rulesCatalog.rules) {
    const status = analyzeRuleCompliance(rule, mappings)
    statuses.push(status)
  }
  
  // Calculer les statistiques
  const compliant = statuses.filter(s => s.status === 'compliant').length
  const partial = statuses.filter(s => s.status === 'partial').length
  const nonCompliant = statuses.filter(s => s.status === 'non-compliant').length
  const notImplemented = statuses.filter(s => s.status === 'not-implemented').length
  
  // Statistiques par catégorie
  const byCategory: Record<string, {
    total: number
    compliant: number
    partial: number
    nonCompliant: number
    notImplemented: number
  }> = {}
  
  for (const status of statuses) {
    const rule = rulesCatalog.rulesByArticle[status.ruleId]
    if (!rule) continue
    
    const categoryKey = `${rule.category.book}-${rule.category.title}`
    if (!byCategory[categoryKey]) {
      byCategory[categoryKey] = {
        total: 0,
        compliant: 0,
        partial: 0,
        nonCompliant: 0,
        notImplemented: 0,
      }
    }
    
    const cat = byCategory[categoryKey]
    cat.total++
    switch (status.status) {
      case 'compliant':
        cat.compliant++
        break
      case 'partial':
        cat.partial++
        break
      case 'non-compliant':
        cat.nonCompliant++
        break
      case 'not-implemented':
        cat.notImplemented++
        break
    }
  }
  
  return {
    generatedAt: new Date(),
    totalRules: statuses.length,
    compliant,
    partial,
    nonCompliant,
    notImplemented,
    statuses,
    byCategory,
  }
}

/**
 * Génère un rapport markdown
 */
export function generateComplianceReport(report: ComplianceReport): string {
  let markdown = `# Rapport de Conformité PCG 2026\n\n`
  markdown += `**Date de génération:** ${report.generatedAt.toISOString()}\n\n`
  
  // Résumé
  markdown += `## Résumé\n\n`
  markdown += `| Statut | Nombre | Pourcentage |\n`
  markdown += `|--------|--------|------------|\n`
  markdown += `| ✅ Conforme | ${report.compliant} | ${((report.compliant / report.totalRules) * 100).toFixed(1)}% |\n`
  markdown += `| ⚠️ Partiel | ${report.partial} | ${((report.partial / report.totalRules) * 100).toFixed(1)}% |\n`
  markdown += `| ❌ Non conforme | ${report.nonCompliant} | ${((report.nonCompliant / report.totalRules) * 100).toFixed(1)}% |\n`
  markdown += `| ⬜ Non implémenté | ${report.notImplemented} | ${((report.notImplemented / report.totalRules) * 100).toFixed(1)}% |\n`
  markdown += `| **Total** | **${report.totalRules}** | **100%** |\n\n`
  
  // Par catégorie
  markdown += `## Conformité par Catégorie\n\n`
  markdown += `| Catégorie | Total | ✅ | ⚠️ | ❌ | ⬜ |\n`
  markdown += `|-----------|-------|-----|-----|-----|-----|\n`
  
  const sortedCategories = Object.entries(report.byCategory)
    .sort((a, b) => b[1].total - a[1].total)
  
  for (const [category, stats] of sortedCategories) {
    markdown += `| ${category} | ${stats.total} | ${stats.compliant} | ${stats.partial} | ${stats.nonCompliant} | ${stats.notImplemented} |\n`
  }
  
  markdown += `\n## Détail par Règle\n\n`
  
  // Grouper par statut
  const byStatus = {
    compliant: report.statuses.filter(s => s.status === 'compliant'),
    partial: report.statuses.filter(s => s.status === 'partial'),
    nonCompliant: report.statuses.filter(s => s.status === 'non-compliant'),
    notImplemented: report.statuses.filter(s => s.status === 'not-implemented'),
  }
  
  if (byStatus.compliant.length > 0) {
    markdown += `### ✅ Règles Conformes (${byStatus.compliant.length})\n\n`
    for (const status of byStatus.compliant.slice(0, 10)) {
      markdown += `- **${status.ruleId}**: ${status.implementationFile || 'Implémenté'}\n`
    }
    if (byStatus.compliant.length > 10) {
      markdown += `\n*... et ${byStatus.compliant.length - 10} autres*\n`
    }
    markdown += `\n`
  }
  
  if (byStatus.partial.length > 0) {
    markdown += `### ⚠️ Règles Partiellement Implémentées (${byStatus.partial.length})\n\n`
    for (const status of byStatus.partial) {
      markdown += `- **${status.ruleId}**: ${status.implementationFile || 'N/A'}\n`
      if (status.notes) {
        markdown += `  - ${status.notes}\n`
      }
    }
    markdown += `\n`
  }
  
  if (byStatus.nonCompliant.length > 0) {
    markdown += `### ❌ Règles Non Conformes (${byStatus.nonCompliant.length})\n\n`
    for (const status of byStatus.nonCompliant) {
      markdown += `- **${status.ruleId}**: ${status.notes || 'Non conforme'}\n`
    }
    markdown += `\n`
  }
  
  if (byStatus.notImplemented.length > 0) {
    markdown += `### ⬜ Règles Non Implémentées (${byStatus.notImplemented.length})\n\n`
    markdown += `*Afficher les ${Math.min(20, byStatus.notImplemented.length)} premières...*\n\n`
    for (const status of byStatus.notImplemented.slice(0, 20)) {
      markdown += `- **${status.ruleId}**: ${status.notes || 'Non implémenté'}\n`
    }
    if (byStatus.notImplemented.length > 20) {
      markdown += `\n*... et ${byStatus.notImplemented.length - 20} autres*\n`
    }
  }
  
  return markdown
}
