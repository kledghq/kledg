#!/usr/bin/env tsx
/**
 * Script de vérification de conformité PCG 2026
 * 
 * Usage: npm run check:pcg-compliance
 */

import { prisma } from '../lib/prisma'
import { generateComplianceReport } from '../lib/pcg/compliance-checker'
import { logger } from '../lib/logger'

async function main() {
  const companyId = process.argv[2]

  if (!companyId) {
    console.error('Usage: npm run check:pcg-compliance <companyId>')
    process.exit(1)
  }

  try {
    console.log(`🔍 Vérification de conformité PCG 2026 pour l'entreprise ${companyId}...\n`)

    // Pour l'instant, on génère un rapport de conformité général
    // TODO: Implémenter checkPCGCompliance avec vérifications spécifiques par entreprise
    const result = generateComplianceReport(companyId)

    console.log('📊 Résultats de la vérification:\n')
    
    const complianceScore = ((result.compliant / result.totalRules) * 100).toFixed(1)
    console.log(`✅ Conformité globale: ${complianceScore}%`)
    console.log(`📋 Règles totales: ${result.totalRules}`)
    console.log(`  - ✅ Conformes: ${result.compliant}`)
    console.log(`  - ⚠️  Partielles: ${result.partial}`)
    console.log(`  - ❌ Non conformes: ${result.nonCompliant}`)
    console.log(`  - ⬜ Non implémentées: ${result.notImplemented}\n`)

    if (result.notImplemented > 0 || result.nonCompliant > 0) {
      console.log('⚠️  Des règles nécessitent une attention:')
      if (result.nonCompliant > 0) {
        console.log(`  - ${result.nonCompliant} règle(s) non conforme(s)`)
      }
      if (result.notImplemented > 0) {
        console.log(`  - ${result.notImplemented} règle(s) non implémentée(s)`)
      }
      console.log('Consultez le rapport complet pour plus de détails\n')
    }

    if (result.compliant === result.totalRules) {
      console.log('✅ Toutes les règles PCG sont implémentées et conformes!')
    }

    // Résumé par catégorie
    if (result.byCategory && Object.keys(result.byCategory).length > 0) {
      console.log('\n📋 Résumé par catégorie:')
      Object.entries(result.byCategory).forEach(([category, data]: [string, any]) => {
        const catScore = ((data.compliant / data.total) * 100).toFixed(1)
        console.log(`  - ${category}: ${data.compliant}/${data.total} (${catScore}%)`)
      })
    }

    process.exit(result.notImplemented > 0 || result.nonCompliant > 0 ? 1 : 0)
  } catch (error) {
    logger.error('Erreur lors de la vérification de conformité', { error, companyId })
    console.error('❌ Erreur:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
