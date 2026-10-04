/**
 * Principe d'Image Fidèle (Art. 121-1)
 * 
 * La comptabilité est un système d'organisation de l'information financière
 * permettant de saisir, classer, enregistrer des données de base chiffrées et
 * présenter des états reflétant une image fidèle du patrimoine, de la situation
 * financière et du résultat de l'entité à la date de clôture.
 */

import type { AccountingEntry, EntryLine } from '@/lib/accounting/types'
import { toCents } from '@/lib/utils/money'

const MIN_DATE = new Date('1900-01-01')

export interface ImageFideleValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Valide qu'une écriture respecte le principe d'image fidèle
 */
export function validateImageFidele(
  entry: {
    date: Date
    description?: string
    lines: EntryLine[]
  },
  now: Date = new Date()
): ImageFideleValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  
  // No limit in the future here: the date must fall inside an open fiscal
  // year (assertEntryWritableInFiscalYear, lib/accounting/entry-guards.ts),
  // so a closing or provision entry dated on the coming year end is allowed.
  void now
  if (entry.date < MIN_DATE) {
    errors.push('La date de l\'écriture est trop ancienne (principe d\'image fidèle)')
  }
  
  // Vérifier que la description est présente et significative
  if (!entry.description || entry.description.trim().length < 5) {
    warnings.push('La description de l\'écriture est absente ou trop courte pour refléter fidèlement l\'opération')
  }
  
  // Vérifier que les montants sont cohérents (compensation interdite)
  // Les montants négatifs sont autorisés (ex. compte en découvert)
  for (const line of entry.lines) {
    const debit = toCents(line.debit ?? 0)
    const credit = toCents(line.credit ?? 0)

    if (debit !== 0 && credit !== 0) {
      errors.push(`Ligne avec compte ${line.accountId}: compensation interdite (principe d'image fidèle)`)
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Valide qu'un ensemble d'écritures reflète fidèlement la situation financière
 */
export function validateImageFideleGlobal(entries: AccountingEntry[]): ImageFideleValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  
  // Vérifier la cohérence temporelle
  const dates = entries.map(e => new Date(e.date)).sort((a, b) => a.getTime() - b.getTime())
  if (dates.length > 1) {
    const firstDate = dates[0]
    const lastDate = dates[dates.length - 1]
    const daysDiff = Math.floor((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24))
    
    if (daysDiff > 365) {
      warnings.push(`Les écritures couvrent une période de ${daysDiff} jours, vérifier la cohérence temporelle`)
    }
  }
  
  // Vérifier qu'il n'y a pas de doublons suspects
  const entryHashes = new Map<string, number>()
  for (const entry of entries) {
    const hash = `${entry.date.toISOString()}-${entry.description}-${entry.lines.length}`
    entryHashes.set(hash, (entryHashes.get(hash) || 0) + 1)
  }
  
  for (const [hash, count] of entryHashes.entries()) {
    if (count > 1) {
      warnings.push(`Écritures potentiellement dupliquées détectées (${count} occurrences)`)
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
