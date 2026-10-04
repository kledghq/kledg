/**
 * PCG 2026 checks of one accounting entry (art. 112-2: balance, no netting,
 * double entry). Pure module without disk access: lib/accounting/validator.ts
 * imports it on the request path of the app's routes.
 */

/**
 * Vérifie la conformité d'une écriture comptable
 */
export function checkEntryCompliance(entry: {
  date: Date
  description?: string
  lines: Array<{ accountId: string; debit: number; credit: number }>
}): {
  compliant: boolean
  violations: Array<{ ruleId: string; message: string; severity: 'error' | 'warning' }>
} {
  const violations: Array<{ ruleId: string; message: string; severity: 'error' | 'warning' }> = []
  
  // Vérifier l'équilibre (Art. 112-2)
  const totalDebit = entry.lines.reduce((sum, line) => sum + Number(line.debit || 0), 0)
  const totalCredit = entry.lines.reduce((sum, line) => sum + Number(line.credit || 0), 0)
  
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    violations.push({
      ruleId: '112-2',
      message: 'L\'écriture n\'est pas équilibrée (débit ≠ crédit)',
      severity: 'error',
    })
  }
  
  // Vérifier la non-compensation (Art. 112-2)
  for (const line of entry.lines) {
    if (line.debit > 0 && line.credit > 0) {
      violations.push({
        ruleId: '112-2',
        message: 'Compensation interdite: une ligne ne peut avoir débit et crédit simultanément',
        severity: 'error',
      })
    }
  }
  
  // Vérifier la partie double (minimum 2 lignes)
  if (entry.lines.length < 2) {
    violations.push({
      ruleId: '112-2',
      message: 'Principe de la partie double: minimum 2 lignes requises',
      severity: 'error',
    })
  }
  
  return {
    compliant: violations.filter(v => v.severity === 'error').length === 0,
    violations,
  }
}
