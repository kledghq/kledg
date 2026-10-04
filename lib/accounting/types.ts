/**
 * Types comptables centralisés selon les normes PCG 2026
 * Conformité avec les principes comptables français
 */

/**
 * Nature d'un compte selon le PCG
 */
export type AccountNature = 'actif' | 'passif' | 'charge' | 'produit'

/**
 * Statut d'une écriture comptable
 */
export type EntryStatus = 'draft' | 'validated'

/**
 * Ligne d'écriture comptable
 */
export interface EntryLine {
  accountId: string
  debit: number
  credit: number
  description?: string
}

/**
 * Écriture comptable complète
 */
export interface AccountingEntry {
  companyId: string
  journalId: string
  entryNumber: string
  date: Date
  description: string
  reference?: string
  status: EntryStatus
  lines: EntryLine[]
}

/**
 * Résultat de validation d'une écriture
 */
export interface EntryValidationResult {
  valid: boolean
  errors: string[]
  totalDebit: number
  totalCredit: number
  balance: number
}

/**
 * Période comptable
 */
export interface AccountingPeriod {
  startDate: Date
  endDate: Date
}

/**
 * Solde d'un compte
 */
export interface AccountBalance {
  accountId: string
  code: string
  label: string
  debit: number
  credit: number
  balance: number
}
