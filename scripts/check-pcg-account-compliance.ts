#!/usr/bin/env tsx
/**
 * Script de vérification de conformité du plan de comptes PCG 2026 pour une entreprise
 * 
 * Usage: tsx scripts/check-pcg-account-compliance.ts <companyId>
 */

import { checkPCGAccountStructureCompliance, checkAccountOperationRules, checkFullPCGCompliance } from '@/lib/accounting/pcg-compliance-checker'

async function main() {
  const companyId = process.argv[2]

  if (!companyId) {
    console.error('❌ Usage: tsx scripts/check-pcg-account-compliance.ts <companyId>')
    process.exit(1)
  }

  console.log('🔍 Vérification de conformité du plan de comptes PCG 2026')
  console.log(`   Entreprise: ${companyId}\n`)

  try {
    const structureCheck = checkPCGAccountStructureCompliance()
    const operationRules = checkAccountOperationRules()
    
    const result = {
      ...structureCheck,
      operationRules,
      valid: structureCheck.valid && operationRules.valid,
    }

    console.log('📊 Structure du plan de comptes:')
    if (result.valid) {
      console.log('  ✅ Conforme')
    } else {
      console.log('  ❌ Non conforme')
    }

    if (structureCheck.stats?.missingRequiredAccounts && structureCheck.stats.missingRequiredAccounts.length > 0) {
      console.log(`\n  ⚠️  Comptes minimaux manquants (${structureCheck.stats.missingRequiredAccounts.length}):`)
      structureCheck.stats.missingRequiredAccounts.forEach((code: string) => {
        console.log(`    - ${code}`)
      })
    }

    if (structureCheck.errors && structureCheck.errors.length > 0) {
      console.log(`\n❌ Erreurs structurelles (${structureCheck.errors.length}):`)
      structureCheck.errors.forEach((error: string) => {
        console.log(`  - ${error}`)
      })
    }

    if (structureCheck.warnings && structureCheck.warnings.length > 0) {
      console.log(`\n⚠️  Avertissements (${structureCheck.warnings.length}):`)
      structureCheck.warnings.forEach((warning: string) => {
        console.log(`  - ${warning}`)
      })
    }

    console.log('\n✅ Règles de fonctionnement:')
    if (result.operationRules.valid) {
      console.log('  ✅ Conformes')
    } else {
      console.log('  ❌ Non conformes')
    }

    if (result.operationRules.errors && result.operationRules.errors.length > 0) {
      console.log(`\n❌ Erreurs règles de fonctionnement (${result.operationRules.errors.length}):`)
      result.operationRules.errors.forEach((error: string) => {
        console.log(`  - ${error}`)
      })
    }

    if (result.operationRules.warnings && result.operationRules.warnings.length > 0) {
      console.log(`\n⚠️  Avertissements règles de fonctionnement (${result.operationRules.warnings.length}):`)
      result.operationRules.warnings.forEach((warning: string) => {
        console.log(`  - ${warning}`)
      })
    }

    console.log('\n' + '='.repeat(60))
    if (result.valid && result.operationRules.valid) {
      console.log('✅ Plan de comptes conforme au PCG 2026')
      process.exit(0)
    } else {
      console.log('❌ Plan de comptes non conforme - corrections nécessaires')
      process.exit(1)
    }
  } catch (error) {
    console.error('❌ Erreur lors de la vérification:', error)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Erreur fatale:', error)
  process.exit(1)
})
