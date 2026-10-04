/**
 * Column detection utilities for FEC import
 * 
 * This module contains logic for automatically detecting FEC columns
 * from file headers using pattern matching and similarity algorithms.
 */

import type { FECColumnMapping } from '@/lib/import/types'

/**
 * Required FEC fields
 */
export const REQUIRED_FIELDS = [
  { key: 'JournalCode', label: 'Code Journal', required: true },
  { key: 'JournalLib', label: 'Libellé Journal', required: true },
  { key: 'EcritureNum', label: 'Numéro Écriture', required: true },
  { key: 'EcritureDate', label: 'Date Écriture', required: true },
  { key: 'CompteNum', label: 'Numéro Compte', required: true },
  { key: 'CompteLib', label: 'Libellé Compte', required: true },
  { key: 'Debit', label: 'Débit', required: true },
  { key: 'Credit', label: 'Crédit', required: true },
] as const

/**
 * Optional FEC fields
 */
export const OPTIONAL_FIELDS = [
  { key: 'CompAuxNum', label: 'Numéro Compte Auxiliaire', required: false },
  { key: 'CompAuxLib', label: 'Libellé Compte Auxiliaire', required: false },
  { key: 'PieceRef', label: 'Référence Pièce', required: false },
  { key: 'PieceDate', label: 'Date Pièce', required: false },
  { key: 'EcritureLib', label: 'Libellé Écriture', required: false },
  { key: 'EcritureLet', label: 'Lettrage', required: false },
  { key: 'DateLet', label: 'Date Lettrage', required: false },
  { key: 'ValidDate', label: 'Date Validation', required: false },
  { key: 'Montantdevise', label: 'Montant Devise', required: false },
  { key: 'Idevise', label: 'Code Devise', required: false },
] as const

/**
 * Common column names for auto-detection
 * Maps FEC field keys to common variations of column names
 */
export const COMMON_COLUMN_NAMES: Record<string, string[]> = {
  JournalCode: ['journalcode', 'code journal', 'journal', 'code_journal', 'journal_code'],
  JournalLib: ['journallib', 'libellé journal', 'libelle journal', 'lib journal', 'journal_lib', 'journal_libelle'],
  EcritureNum: ['ecriturenum', 'numéro écriture', 'numero ecriture', 'num ecriture', 'ecriture_num', 'num_ecriture', 'n° écriture'],
  EcritureDate: ['ecrituredate', 'date écriture', 'date ecriture', 'date', 'ecriture_date', 'date_ecriture'],
  CompteNum: ['comptenum', 'numéro compte', 'numero compte', 'num compte', 'compte_num', 'num_compte', 'n° compte', 'compte'],
  CompteLib: ['comptelib', 'libellé compte', 'libelle compte', 'lib compte', 'compte_lib', 'compte_libelle'],
  Debit: ['debit', 'débit', 'debit', 'montant debit', 'montant_débit'],
  Credit: ['credit', 'crédit', 'montant credit', 'montant_crédit'],
  CompAuxNum: ['compauxnum', 'numéro compte auxiliaire', 'compte auxiliaire', 'comp_aux_num'],
  CompAuxLib: ['compauxlib', 'libellé compte auxiliaire', 'comp_aux_lib'],
  PieceRef: ['pieceref', 'référence pièce', 'reference piece', 'ref piece', 'piece_ref'],
  PieceDate: ['piecedate', 'date pièce', 'date piece', 'piece_date'],
  EcritureLib: ['ecriturelib', 'libellé écriture', 'libelle ecriture', 'ecriture_lib'],
  EcritureLet: ['ecriturelet', 'lettrage', 'ecriture_let'],
  DateLet: ['datelet', 'date lettrage', 'date_let'],
  ValidDate: ['validdate', 'date validation', 'date_validation'],
  Montantdevise: ['montantdevise', 'montant devise', 'montant_devise'],
  Idevise: ['idevise', 'code devise', 'devise', 'code_devise'],
}

/**
 * Normalizes text for comparison (lowercase, no accents, no multiple spaces)
 * 
 * @param text - Text to normalize
 * @returns Normalized text
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculates similarity between two texts (simplified Jaro-Winkler)
 * 
 * @param text1 - First text
 * @param text2 - Second text
 * @returns Similarity score between 0 and 1
 */
export function textSimilarity(text1: string, text2: string): number {
  const norm1 = normalizeText(text1)
  const norm2 = normalizeText(text2)
  
  if (norm1 === norm2) return 1.0
  if (norm1.includes(norm2) || norm2.includes(norm1)) return 0.8
  
  // Simple similarity calculation based on common words
  const words1 = norm1.split(/\s+/)
  const words2 = norm2.split(/\s+/)
  const commonWords = words1.filter(w => words2.includes(w))
  const totalWords = Math.max(words1.length, words2.length)
  
  return commonWords.length / totalWords
}

/**
 * Automatically detects FEC column mapping from file headers. Each header
 * goes to one field at most: exact names first, then the headers that
 * contain a known name, the longest (most specific) names first, so the
 * generic "journal" of Code Journal never takes the "Libellé journal"
 * column of Libellé Journal.
 *
 * @param headers - Array of column headers from the file
 * @returns Partial FEC column mapping with detected fields
 */
export function detectColumnMapping(headers: string[]): Partial<FECColumnMapping> {
  const autoMapping: Partial<FECColumnMapping> = {}
  const headerLower = headers.map((h) => h.toLowerCase().trim())
  const used = new Set<number>()
  const fields = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map((field) => field.key as keyof FECColumnMapping)

  // Exact names
  for (const key of fields) {
    for (const commonName of COMMON_COLUMN_NAMES[key] || []) {
      const index = headerLower.findIndex((h, i) => !used.has(i) && h === commonName)
      if (index !== -1) {
        autoMapping[key] = headers[index]
        used.add(index)
        break
      }
    }
  }

  // Headers containing a known name, most specific name first
  const candidates: Array<{ key: keyof FECColumnMapping; index: number; length: number; order: number }> = []
  fields.forEach((key, order) => {
    for (const commonName of COMMON_COLUMN_NAMES[key] || []) {
      headerLower.forEach((h, index) => {
        if (h.includes(commonName)) candidates.push({ key, index, length: commonName.length, order })
      })
    }
  })
  candidates.sort((a, b) => b.length - a.length || a.order - b.order || a.index - b.index)
  for (const { key, index } of candidates) {
    if (autoMapping[key] !== undefined || used.has(index)) continue
    autoMapping[key] = headers[index]
    used.add(index)
  }

  return autoMapping
}
