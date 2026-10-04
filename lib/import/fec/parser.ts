/**
 * FEC file parser.
 *
 * Reads files written by Kledg or by other software (LPF art. A47 A-1, see
 * lib/fec/format.ts):
 * - encoding: UTF-8 (with or without BOM) or ISO 8859-15 (detected: bytes
 *   that are not valid UTF-8 are read as ISO 8859-15), the two character sets
 *   the text allows besides ASCII;
 * - separator: tabulation or "|" (the two allowed), ";" tolerated;
 * - records separated by CR/LF, LF or CR;
 * - field names matched without regard to case ("MontantDevise"), values
 *   trimmed and unquoted;
 * - the "Montant" + "Sens" layout some software writes instead of
 *   "Debit" + "Credit" is converted.
 *
 * Amounts and dates are parsed later (plan.ts), entry by entry, so that a bad
 * value refuses its entry with a precise message.
 */

import type { FECColumnMapping } from '@/lib/import/types'
import type { FECLine } from '@/lib/import/fec/types'
import { ValidationError } from '@/lib/accounting/errors'
import { FEC_FIELDS } from '@/lib/fec/format'
import { parseAmount } from '@/lib/utils/money'
import { isIsoDate } from '@/lib/utils/date'

export type FecEncoding = 'UTF-8' | 'ISO-8859-15'

/** Decodes FEC bytes: UTF-8 when valid (BOM removed), ISO 8859-15 otherwise. */
export function decodeFecBytes(bytes: Uint8Array): { text: string; encoding: FecEncoding } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text: text.replace(/^\uFEFF/, ''), encoding: 'UTF-8' }
  } catch {
    return { text: new TextDecoder('iso-8859-15').decode(bytes), encoding: 'ISO-8859-15' }
  }
}

/** A parsed record with its line number in the file (header = line 1). */
export interface ParsedFecLine extends FECLine {
  lineNumber: number
}

export interface ParsedFecFile {
  lines: ParsedFecLine[]
  separator: 'tab' | 'pipe' | 'semicolon'
  /** Records that could not be read (wrong number of fields...). */
  errors: Array<{ line: number; message: string }>
  warnings: string[]
}

const CANONICAL = new Map<string, keyof FECLine>(FEC_FIELDS.map((f) => [f.toLowerCase(), f as keyof FECLine]))

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim()
  }
  return trimmed
}

/**
 * Converts a "Montant" + "Sens" pair to Debit / Credit. Sens: D / C,
 * Débit / Crédit, +1 / -1. Returns null when the sense is unknown.
 */
function amountWithSense(amount: string, sense: string): { Debit: string; Credit: string } | null {
  const s = sense.trim().toUpperCase()
  if (s === 'D' || s === 'DEBIT' || s === 'DÉBIT' || s === '+1' || s === '1') return { Debit: amount, Credit: '0' }
  if (s === 'C' || s === 'CREDIT' || s === 'CRÉDIT' || s === '-1') return { Debit: '0', Credit: amount }
  return null
}

/**
 * Parses a FEC (already decoded). Throws a ValidationError when the file
 * cannot be read at all (no header, unknown separator, missing fields).
 */
export function parseFecFile(content: string, columnMapping?: FECColumnMapping): ParsedFecFile {
  const rows = content.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  const firstIndex = rows.findIndex((r) => r.trim() !== '')
  if (firstIndex < 0) throw new ValidationError('Fichier FEC vide')
  const headerRow = rows[firstIndex]

  const separatorChar = headerRow.includes('\t') ? '\t' : headerRow.includes('|') ? '|' : headerRow.includes(';') ? ';' : null
  if (!separatorChar) {
    throw new ValidationError("Fichier FEC illisible : l'en-tête doit séparer les zones par une tabulation ou « | » (art. A47 A-1 du LPF)")
  }
  const separator = separatorChar === '\t' ? 'tab' : separatorChar === '|' ? 'pipe' : 'semicolon'
  const warnings: string[] = []
  if (separator === 'semicolon') warnings.push('Séparateur « ; » : le format officiel impose la tabulation ou « | ». Fichier lu quand même.')

  const header = headerRow.split(separatorChar).map(unquote)
  // Column of each FEC field: the user's mapping, else the header name (any case)
  const columnOf = new Map<string, number>()
  if (columnMapping) {
    for (const [field, column] of Object.entries(columnMapping)) {
      if (!column) continue
      const index = header.indexOf(column)
      if (index >= 0) columnOf.set(field, index)
    }
  } else {
    header.forEach((name, index) => {
      const canonical = CANONICAL.get(name.toLowerCase())
      if (canonical && !columnOf.has(canonical)) columnOf.set(canonical, index)
    })
  }
  const montantIndex = header.findIndex((n) => n.toLowerCase() === 'montant')
  const sensIndex = header.findIndex((n) => n.toLowerCase() === 'sens')
  const withSense = !columnOf.has('Debit') && !columnOf.has('Credit') && montantIndex >= 0 && sensIndex >= 0
  if (withSense) warnings.push('Montants lus dans les zones « Montant » et « Sens ».')

  const required = ['JournalCode', 'EcritureNum', 'EcritureDate', 'CompteNum', ...(withSense ? [] : ['Debit', 'Credit'])]
  const missing = required.filter((f) => !columnOf.has(f))
  if (missing.length > 0) {
    throw new ValidationError(`Fichier FEC incomplet : zones absentes de l'en-tête : ${missing.join(', ')}`)
  }

  const lines: ParsedFecLine[] = []
  const errors: ParsedFecFile['errors'] = []
  for (let i = firstIndex + 1; i < rows.length; i++) {
    const raw = rows[i]
    if (raw.trim() === '') continue
    const lineNumber = i + 1
    const values = raw.split(separatorChar)
    if (values.length !== header.length) {
      errors.push({
        line: lineNumber,
        message: `${values.length} zones au lieu de ${header.length} (séparateur dans un libellé ?)`,
      })
      continue
    }
    const get = (field: string): string => {
      const index = columnOf.get(field)
      return index === undefined ? '' : unquote(values[index] ?? '')
    }
    const line: ParsedFecLine = {
      lineNumber,
      JournalCode: get('JournalCode'),
      JournalLib: get('JournalLib'),
      EcritureNum: get('EcritureNum'),
      EcritureDate: get('EcritureDate'),
      CompteNum: get('CompteNum'),
      CompteLib: get('CompteLib'),
      CompAuxNum: get('CompAuxNum'),
      CompAuxLib: get('CompAuxLib'),
      PieceRef: get('PieceRef'),
      PieceDate: get('PieceDate'),
      EcritureLib: get('EcritureLib'),
      Debit: get('Debit'),
      Credit: get('Credit'),
      EcritureLet: get('EcritureLet'),
      DateLet: get('DateLet'),
      ValidDate: get('ValidDate'),
      Montantdevise: get('Montantdevise'),
      Idevise: get('Idevise'),
    }
    if (withSense) {
      const converted = amountWithSense(unquote(values[montantIndex] ?? ''), unquote(values[sensIndex] ?? ''))
      if (!converted) {
        errors.push({ line: lineNumber, message: `Sens « ${unquote(values[sensIndex] ?? '')} » inconnu (attendu D ou C)` })
        continue
      }
      line.Debit = converted.Debit
      line.Credit = converted.Credit
    }
    lines.push(line)
  }
  return { lines, separator, errors, warnings }
}

/**
 * A FEC date as a calendar day "yyyy-mm-dd": AAAAMMJJ (the official format),
 * also yyyy-mm-dd and dd/mm/yyyy written by some software. Null if invalid.
 */
export function parseFecDay(value: string | undefined | null): string | null {
  const s = (value ?? '').trim()
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  let y: number, mo: number, d: number
  if (m) {
    ;[y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  } else {
    m = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(s)
    if (!m) return null
    ;[d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const day = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isIsoDate(day) ? day : null
}

/**
 * A FEC amount in cents. The official format is "1234,56" (decimal comma, no
 * thousands separator); "1234.56", "1 234,56", "1.234,56" and an empty value
 * (0) are tolerated. Null when unreadable or with more than two decimals.
 */
export function parseFecAmount(value: string | undefined | null): number | null {
  const s = (value ?? '').trim()
  if (s === '') return 0
  const parsed = parseAmount(s, { allowNegative: true })
  if (!parsed.ok) return null
  return parsed.cents ?? 0
}
