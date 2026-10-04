/**
 * Tabular statements (CSV and Excel): delimiter, header row and column
 * detection, then row parsing into transactions.
 *
 * Banks put free text above the header (account number, holder, balance),
 * name their columns in many ways and either sign a single amount column or
 * split it into Débit and Crédit. Detection order:
 *   1. a bank preset whose header signature matches (presets.ts)
 *   2. header names (synonyms below)
 *   3. column content (a column of dates, a column of amounts)
 * Every guess can be overridden by `TabularOptions`.
 */

import Papa from 'papaparse'
import { detectDecimalSeparator, parseAmountCents } from './amount'
import { detectDateFormat, looksLikeDate, parseCalendarDate } from './date'
import { findPreset, resolvePresetMapping } from './presets'
import type {
  ColumnMapping,
  ColumnRole,
  ParsedTransaction,
  RowError,
  TabularDetection,
  TabularOptions,
} from './types'
import { plural, pluralWord } from '@/lib/utils/plural'

export type Cell = string | number | Date | null | undefined

/** Lowercase, no accents, words separated by single spaces. */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Header synonyms (normalized). Exact matches win over prefix matches. */
const SYNONYMS: Record<ColumnRole, string[]> = {
  date: [
    'date',
    'date operation',
    'date d operation',
    'date de l operation',
    'date de operation',
    'date op',
    'date comptable',
    'date de comptabilisation',
    'date compta',
    'date de transaction',
    'date transaction',
    'date d execution',
    'date execution',
    'booking date',
    'transaction date',
    'date completed utc',
    'date completed',
    'completed date',
    'settlement date',
    'settled at',
  ],
  valueDate: ['date valeur', 'date de valeur', 'value date', 'date val', 'valeur date'],
  label: [
    'libelle',
    'libelles',
    'libelle operation',
    'libelle de l operation',
    'libelle simplifie',
    'libelle court',
    'description',
    'intitule',
    'operation',
    'nature de l operation',
    'nature operation',
    'label',
    'designation',
    'wording',
  ],
  label2: [
    'libelle complementaire',
    'complement',
    'complement libelle',
    'informations complementaires',
    'information complementaire',
    'details',
    'detail',
    'libelle long',
    'libelle operation complet',
    'note',
    'notes',
    'commentaire',
    'memo',
  ],
  reference: [
    'reference',
    'ref',
    'references',
    'reference operation',
    'reference de l operation',
    'numero d operation',
    'n operation',
    'numero de piece',
    'piece',
    'numero de cheque',
    'n cheque',
    'cheque',
    'end to end id',
  ],
  transactionId: ['transaction id', 'id transaction', 'id', 'identifiant', 'identifiant de transaction', 'transaction uuid', 'fitid'],
  amount: [
    'montant',
    'montants',
    'montant eur',
    'montant en euros',
    'montant en eur',
    'montant euros',
    'montant de l operation',
    'montant operation',
    'montant ttc',
    'amount',
    'amount eur',
    'total amount',
    'somme',
  ],
  debit: ['debit', 'debits', 'debit eur', 'debit euros', 'montant debit', 'sortie', 'sorties', 'depense', 'depenses', 'retrait', 'debit amount'],
  credit: ['credit', 'credits', 'credit eur', 'credit euros', 'montant credit', 'entree', 'entrees', 'recette', 'recettes', 'versement', 'credit amount'],
  currency: ['devise', 'currency', 'monnaie', 'payment currency'],
  counterparty: [
    'contrepartie',
    'beneficiaire',
    'tiers',
    'nom du tiers',
    'counterparty',
    'counterparty name',
    'payer',
    'payee',
    'emetteur',
    'destinataire',
    'beneficiary',
  ],
  status: ['statut', 'status', 'state', 'etat'],
}

/** Maps header names to roles: exact synonyms first, then "starts with a synonym". */
export function mapHeaders(headers: string[]): ColumnMapping {
  const normalized = headers.map((h) => normalizeHeader(h ?? ''))
  const mapping: ColumnMapping = {}
  const used = new Set<number>()
  const roles = Object.keys(SYNONYMS) as ColumnRole[]
  for (const pass of ['exact', 'prefix'] as const) {
    for (const role of roles) {
      if (mapping[role] !== undefined) continue
      for (const synonym of SYNONYMS[role]) {
        const index = normalized.findIndex(
          (h, i) => !used.has(i) && h !== '' && (pass === 'exact' ? h === synonym : synonym.length >= 4 && h.startsWith(synonym + ' ')),
        )
        if (index >= 0) {
          mapping[role] = index
          used.add(index)
          break
        }
      }
    }
  }
  // A lone details column is the label
  if (mapping.label === undefined && mapping.label2 !== undefined) {
    mapping.label = mapping.label2
    delete mapping.label2
  }
  return mapping
}

function hasAmount(mapping: ColumnMapping): boolean {
  return mapping.amount !== undefined || mapping.debit !== undefined || mapping.credit !== undefined
}

export function isComplete(mapping: ColumnMapping): boolean {
  return mapping.date !== undefined && hasAmount(mapping)
}

/** Splits CSV text with the delimiter that gives the most rows of the same width. */
export function splitCsv(text: string, forced?: string): { delimiter: string; rows: string[][] } {
  const candidates = forced ? [forced] : [';', '\t', ',', '|']
  const sample = text.slice(0, 64 * 1024)
  let best = candidates[0]
  let bestScore = -1
  for (const delimiter of candidates) {
    const { data } = Papa.parse<string[]>(sample, { delimiter, skipEmptyLines: true })
    const widths = new Map<number, number>()
    for (const row of data.slice(0, 200)) widths.set(row.length, (widths.get(row.length) ?? 0) + 1)
    let score = 0
    for (const [width, count] of widths) if (width >= 2 && count > score) score = count
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  // Empty lines are kept (and skipped later) so row numbers stay file line numbers
  const { data } = Papa.parse<string[]>(text, { delimiter: best, skipEmptyLines: false })
  return { delimiter: best, rows: data.map((row) => row.map((cell) => cell ?? '')) }
}

export function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return parseCalendarDate(cell) ?? ''
  return String(cell).trim()
}

const HEADER_SCAN_ROWS = 40

/**
 * First row whose cells name a date column and an amount column. Returns -1
 * when the file has no recognizable header.
 */
export function findHeaderRow(rows: Cell[][]): number {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS)
  for (let i = 0; i < limit; i++) {
    const headers = rows[i].map(cellText)
    if (findPreset(headers.map(normalizeHeader))) return i
    if (isComplete(mapHeaders(headers))) return i
  }
  return -1
}

/** Without a header: the first row as wide as most rows (skips a narrower preamble). */
function firstDataRow(rows: Cell[][]): number {
  const filled = (row: Cell[]) => row.filter((c) => cellText(c) !== '').length
  const widths = new Map<number, number>()
  for (const row of rows.slice(0, 200)) {
    const w = filled(row)
    if (w >= 2) widths.set(w, (widths.get(w) ?? 0) + 1)
  }
  let modal = 0
  let best = 0
  for (const [w, n] of widths) if (n > best || (n === best && w > modal)) [modal, best] = [w, n]
  const index = rows.findIndex((row) => modal > 0 && filled(row) >= modal)
  return index < 0 ? 0 : index
}

/** Columns found by their content: dates, then the most amount-like column. */
function mapByContent(rows: Cell[][], mapping: ColumnMapping): ColumnMapping {
  const result = { ...mapping }
  const width = Math.max(0, ...rows.map((r) => r.length))
  const ratio = (col: number, test: (c: Cell) => boolean) => {
    const values = rows.map((r) => r[col]).filter((c) => cellText(c) !== '')
    return values.length === 0 ? 0 : values.filter(test).length / values.length
  }
  const taken = () => new Set(Object.values(result))
  if (result.date === undefined) {
    for (let c = 0; c < width; c++) {
      if (!taken().has(c) && ratio(c, (v) => v instanceof Date || looksLikeDate(cellText(v))) >= 0.8) {
        result.date = c
        break
      }
    }
  }
  if (!hasAmount(result)) {
    let best = -1
    let bestRatio = 0
    for (let c = 0; c < width; c++) {
      if (taken().has(c)) continue
      const r = ratio(c, (v) => typeof v === 'number' || (/[.,]\d{1,2}\s*(€|EUR)?\s*$/.test(cellText(v)) && parseAmountCents(cellText(v)) !== null))
      if (r > bestRatio) {
        best = c
        bestRatio = r
      }
    }
    if (best >= 0 && bestRatio >= 0.8) result.amount = best
  }
  if (result.label === undefined) {
    // The widest text column
    let best = -1
    let bestLength = 0
    for (let c = 0; c < width; c++) {
      if (taken().has(c)) continue
      const length = rows.reduce((sum, r) => sum + cellText(r[c]).length, 0)
      if (length > bestLength) {
        best = c
        bestLength = length
      }
    }
    if (best >= 0) result.label = best
  }
  return result
}

/** Entries the bank has not booked yet, or refused: never imported. */
const NOT_BOOKED = /pending|processing|en attente|en cours|a venir|prevu|declined|refuse|reverted|annule|cancel|failed|echou|rejet/

const FOOTER = /^(solde|total|sous total|nouveau solde|ancien solde|balance|montant total)\b/

/** Label and details in one line, without repeating a part the other already contains. */
export function joinLabels(label: string, details: string): string {
  const a = label.replace(/\s+/g, ' ').trim()
  const b = details.replace(/\s+/g, ' ').trim()
  if (!a || b.toUpperCase().includes(a.toUpperCase())) return b
  if (!b || a.toUpperCase().includes(b.toUpperCase())) return a
  return `${a} ${b}`
}

export interface TabularParse {
  transactions: ParsedTransaction[]
  errors: RowError[]
  warnings: string[]
  detection: TabularDetection
}

/** Parses rows of a CSV or an Excel sheet (rows[0] is line 1 of the file). */
export function parseTabular(rows: Cell[][], options: TabularOptions = {}, extra: { delimiter?: string; sheetNames?: string[] } = {}): TabularParse {
  const errors: RowError[] = []
  const warnings: string[] = []

  const headerRow = options.headerRow ?? findHeaderRow(rows)
  const headers = headerRow >= 0 ? rows[headerRow].map(cellText) : []
  const dataStart = headerRow >= 0 ? headerRow + 1 : firstDataRow(rows)
  const dataRows = rows.slice(dataStart)
  const width = Math.max(headers.length, ...dataRows.slice(0, 50).map((r) => r.length), 0)
  const headerNames = Array.from({ length: width }, (_, i) => headers[i] || `Colonne ${i + 1}`)

  const preset = options.preset !== undefined ? findPreset(headers.map(normalizeHeader), options.preset) : findPreset(headers.map(normalizeHeader))
  let mapping: ColumnMapping
  let confidence: 'high' | 'low'
  if (options.mapping) {
    mapping = { ...options.mapping }
    confidence = 'high'
  } else if (preset) {
    mapping = resolvePresetMapping(preset, headers.map(normalizeHeader))
    confidence = isComplete(mapping) ? 'high' : 'low'
  } else {
    mapping = mapHeaders(headers)
    confidence = isComplete(mapping) && mapping.label !== undefined ? 'high' : 'low'
    if (!isComplete(mapping) || mapping.label === undefined) mapping = mapByContent(dataRows.slice(0, 200), mapping)
  }
  for (const [role, index] of Object.entries(mapping)) {
    if (typeof index !== 'number' || index < 0 || index >= width) delete mapping[role as ColumnRole]
  }

  const column = (role: ColumnRole) => (mapping[role] === undefined ? [] : dataRows.slice(0, 200).map((r) => cellText(r[mapping[role]!])))
  // Excel date cells are read as dates whatever the layout: only text dates count
  const textDates = mapping.date === undefined ? [] : dataRows.slice(0, 200).map((r) => r[mapping.date!]).filter((c) => !(c instanceof Date)).map(cellText)
  const dateFormat = options.dateFormat ?? preset?.dateFormat ?? detectDateFormat(textDates)
  const amountSamples = [...column('amount'), ...column('debit'), ...column('credit')].filter(Boolean)
  const decimalSeparator = options.decimalSeparator ?? preset?.decimalSeparator ?? detectDecimalSeparator(amountSamples)

  const detection: TabularDetection = {
    delimiter: extra.delimiter,
    headerRow,
    headers: headerNames,
    sampleRows: dataRows.slice(0, 5).map((r) => headerNames.map((_, i) => cellText(r[i]))),
    mapping,
    dateFormat,
    decimalSeparator,
    preset: preset ? { id: preset.id, name: preset.name } : undefined,
    confidence,
    sheetNames: extra.sheetNames,
  }

  if (mapping.date === undefined) {
    errors.push({ line: 0, message: 'Colonne de date introuvable : choisissez-la dans la correspondance des colonnes.' })
  }
  if (!hasAmount(mapping)) {
    errors.push({ line: 0, message: 'Colonne de montant introuvable : choisissez Montant, ou Débit et Crédit.' })
  }
  if (errors.length > 0) return { transactions: [], errors, warnings, detection }

  const transactions: ParsedTransaction[] = []
  let notBooked = 0
  let zero = 0
  const get = (row: Cell[], role: ColumnRole): Cell => (mapping[role] === undefined ? undefined : row[mapping[role]!])
  const amountOf = (cell: Cell) => (typeof cell === 'number' ? parseAmountCents(cell) : parseAmountCents(cellText(cell), decimalSeparator))

  dataRows.forEach((row, i) => {
    const line = dataStart + i + 1
    if (row.every((c) => cellText(c) === '')) return
    const dateCell = get(row, 'date')
    const labelText = joinLabels(cellText(get(row, 'label')), cellText(get(row, 'label2')))
    const rawAmounts = [get(row, 'amount'), get(row, 'debit'), get(row, 'credit')].map(cellText)

    const status = normalizeHeader(cellText(get(row, 'status')))
    if (status && NOT_BOOKED.test(status)) {
      notBooked++
      return
    }

    if (cellText(dateCell) === '') {
      if (rawAmounts.every((a) => a === '') || FOOTER.test(normalizeHeader(row.map(cellText).join(' ')))) return
      errors.push({ line, message: `Ligne ${line} : date manquante.` })
      return
    }

    const bookingDate = dateCell instanceof Date ? parseCalendarDate(dateCell) : parseCalendarDate(cellText(dateCell), dateFormat)
    if (!bookingDate) {
      if (FOOTER.test(normalizeHeader(cellText(dateCell)))) return
      errors.push({ line, message: `Ligne ${line} : date « ${cellText(dateCell)} » illisible (format attendu ${dateFormat}).` })
      return
    }
    const valueCell = get(row, 'valueDate')
    const valueDate =
      cellText(valueCell) === ''
        ? undefined
        : (valueCell instanceof Date ? parseCalendarDate(valueCell) : parseCalendarDate(cellText(valueCell), dateFormat)) ?? undefined

    let amountCents: number | null
    if (mapping.amount !== undefined && cellText(get(row, 'amount')) !== '') {
      amountCents = amountOf(get(row, 'amount'))
      if (amountCents === null) {
        errors.push({ line, message: `Ligne ${line} : montant « ${cellText(get(row, 'amount'))} » illisible.` })
        return
      }
    } else {
      const debitText = cellText(get(row, 'debit'))
      const creditText = cellText(get(row, 'credit'))
      const debit = debitText === '' ? 0 : amountOf(get(row, 'debit'))
      const credit = creditText === '' ? 0 : amountOf(get(row, 'credit'))
      if (debit === null || credit === null) {
        errors.push({ line, message: `Ligne ${line} : montant « ${debit === null ? debitText : creditText} » illisible.` })
        return
      }
      if (debit !== 0 && credit !== 0) {
        errors.push({ line, message: `Ligne ${line} : débit et crédit renseignés sur la même ligne.` })
        return
      }
      if (debitText === '' && creditText === '') {
        errors.push({ line, message: `Ligne ${line} : montant manquant.` })
        return
      }
      amountCents = debit !== 0 ? -Math.abs(debit) : Math.abs(credit)
    }
    if (amountCents === 0) {
      zero++
      return
    }

    const reference = cellText(get(row, 'reference')) || undefined
    const transactionId = cellText(get(row, 'transactionId')) || undefined
    transactions.push({
      bookingDate,
      valueDate,
      amountCents,
      currency: cellText(get(row, 'currency')).toUpperCase() || undefined,
      label: labelText || reference || '(sans libellé)',
      reference,
      bankReference: transactionId,
      counterparty: cellText(get(row, 'counterparty')) || undefined,
      line,
    })
  })

  if (notBooked > 0) warnings.push(`${plural(notBooked, 'opération non comptabilisée', 'opérations non comptabilisées')} par la banque (en attente, refusée ou annulée) ${pluralWord(notBooked, 'ignorée', 'ignorées')}.`)
  if (zero > 0) warnings.push(`${plural(zero, 'ligne')} de montant nul ${pluralWord(zero, 'ignorée', 'ignorées')}.`)
  return { transactions, errors, warnings, detection }
}
