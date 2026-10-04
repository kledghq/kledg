/**
 * Fichier des Écritures Comptables (FEC): format shared by the export, the
 * validator and the import.
 *
 * Source: Livre des procédures fiscales, art. A47 A-1 (arrêté du 29 juillet
 * 2013), https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027804775
 * and BOFiP BOI-CF-IOR-60-40-20,
 * https://bofip.impots.gouv.fr/bofip/9028-PGP.html/identifiant=BOI-CF-IOR-60-40-20-20131213
 *
 * - Flat file, one record per entry line, records separated by CR/LF; the
 *   first record holds the field names.
 * - "Les zones sont obligatoirement séparées par une tabulation ou le
 *   caractère « | »". Kledg writes tabulations.
 * - Dates "au format AAAAMMJJ sans séparateur".
 * - Amounts in decimal mode with a comma as decimal separator and no
 *   thousands separator.
 * - Character set: ASCII, ISO 8859-15 or UTF-8. Kledg writes UTF-8 (no BOM).
 * - File name "SirenFECAAAAMMJJ", AAAAMMJJ being the closing date of the
 *   fiscal year.
 */

/** The 18 fields of LPF art. A47 A-1, in order. */
export const FEC_FIELDS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
] as const

export type FecField = (typeof FEC_FIELDS)[number]
export type FecRecord = Record<FecField, string>

/**
 * Fields that must not be blank. The others are "à blanc si non utilisé"
 * (CompAuxNum, CompAuxLib, EcritureLet, DateLet, Montantdevise, Idevise).
 */
export const FEC_REQUIRED_FIELDS: readonly FecField[] = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'ValidDate',
]

export const FEC_SEPARATOR = '\t'
export const FEC_LINE_END = '\r\n'

/** Journals holding the opening entries (écritures d'à-nouveaux). */
const OPENING_JOURNAL_CODES = new Set(['AN', 'RAN', 'OU'])

/** Whether a journal holds opening entries (à-nouveaux): Kledg uses AN, its closing uses OU. */
export function isOpeningJournal(code: string): boolean {
  return OPENING_JOURNAL_CODES.has(code.trim().toUpperCase())
}

/**
 * Text fields must not contain the separators (tab, "|") nor line breaks:
 * they are replaced by a space and runs of spaces collapsed.
 */
export function sanitizeFecField(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/[\t\r\n|\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

/** "123 456 789" -> "123456789"; null unless 9 digits. */
export function normalizeSiren(siren: string | null | undefined): string | null {
  const digits = (siren ?? '').replace(/\s/g, '')
  return /^\d{9}$/.test(digits) ? digits : null
}

/** File name "SirenFECAAAAMMJJ.txt" (closing date of the fiscal year, AAAAMMJJ). */
export function fecFileName(siren: string, closingDateAaaammjj: string): string {
  return `${siren}FEC${closingDateAaaammjj}.txt`
}

/** Matches a FEC file name, with or without extension. */
export const FEC_FILE_NAME = /^(\d{9})FEC(\d{8})(?:\.[A-Za-z0-9]+)?$/
