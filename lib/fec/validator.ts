/**
 * Checks a FEC against LPF art. A47 A-1 and BOI-CF-IOR-60-40-20 (see
 * lib/fec/format.ts for the rules and sources). Used on every Kledg export
 * (tests and the export report) and usable on any FEC.
 *
 * Errors make the file non-compliant; warnings point at what an auditor
 * would question (numbering that cannot be checked, lines without amount...).
 */

import { centsToFecAmount } from '@/lib/utils/money'
import { sequentialPartOf } from '@/lib/accounting/services/generate-next-entry-number.service'
import { FEC_FIELDS, FEC_FILE_NAME, FEC_REQUIRED_FIELDS, isOpeningJournal, type FecField, type FecRecord } from './format'

export interface FecIssue {
  /** 1-based line of the file (the header is line 1), null for the whole file. */
  line: number | null
  field?: FecField
  message: string
}

export interface FecValidationReport {
  valid: boolean
  errors: FecIssue[]
  warnings: FecIssue[]
  stats: {
    records: number
    entries: number
    totalDebit: string
    totalCredit: string
    separator: 'tab' | 'pipe' | null
    numbering: 'global' | 'journal' | 'unchecked'
  }
}

export interface FecValidationOptions {
  /** File name to check against "SirenFECAAAAMMJJ". */
  fileName?: string
  /** Expected closing date (AAAAMMJJ) in the file name. */
  closingDate?: string
}

const MAX_ISSUES = 500
const AMOUNT = /^-?\d+(,\d{1,2})?$/

function isFecDate(value: string): boolean {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900 || mo < 1 || mo > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

/** Cents of a FEC amount ("1234,56", "-3", "0,5"). */
function fecCents(value: string): bigint {
  const negative = value.startsWith('-')
  const [integer, fraction = ''] = value.replace('-', '').split(',')
  const cents = BigInt(integer) * BigInt(100) + BigInt(fraction.padEnd(2, '0') || '0')
  return negative ? -cents : cents
}

/** Splits a FEC into records (CR, LF or CR/LF), dropping the trailing empty record. */
export function fecRows(content: string): string[] {
  const rows = content.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop()
  return rows
}

export function validateFec(content: string, options: FecValidationOptions = {}): FecValidationReport {
  const errors: FecIssue[] = []
  const warnings: FecIssue[] = []
  const error = (line: number | null, message: string, field?: FecField) => {
    if (errors.length < MAX_ISSUES) errors.push({ line, field, message })
  }
  const warn = (line: number | null, message: string, field?: FecField) => {
    if (warnings.length < MAX_ISSUES) warnings.push({ line, field, message })
  }
  const stats: FecValidationReport['stats'] = {
    records: 0,
    entries: 0,
    totalDebit: '0,00',
    totalCredit: '0,00',
    separator: null,
    numbering: 'unchecked',
  }
  const done = (): FecValidationReport => ({ valid: errors.length === 0, errors, warnings, stats })

  if (options.fileName !== undefined) {
    const m = FEC_FILE_NAME.exec(options.fileName)
    if (!m) {
      error(null, `Nom de fichier « ${options.fileName} » non conforme : attendu SirenFECAAAAMMJJ (ex. 123456789FEC20251231.txt)`)
    } else if (!isFecDate(m[2])) {
      error(null, `Nom de fichier : la date de clôture ${m[2]} n'est pas une date AAAAMMJJ valide`)
    } else if (options.closingDate && m[2] !== options.closingDate) {
      error(null, `Nom de fichier : la date ${m[2]} n'est pas la date de clôture de l'exercice (${options.closingDate})`)
    }
  }

  if (content.startsWith('\uFEFF')) warn(1, "Le fichier commence par une marque d'ordre des octets (BOM) UTF-8")
  const rows = fecRows(content)
  if (rows.length === 0) {
    error(null, 'Fichier vide')
    return done()
  }

  // Header: the field names, in order, separated by tabs or "|"
  const header = rows[0]
  const separator = header.includes('\t') ? '\t' : header.includes('|') ? '|' : null
  stats.separator = separator === '\t' ? 'tab' : separator === '|' ? 'pipe' : null
  if (!separator) {
    error(1, "Séparateur de zones absent : tabulation ou « | » obligatoire (art. A47 A-1)")
    return done()
  }
  const names = header.split(separator).map((n) => n.trim())
  const headerOk = names.length === FEC_FIELDS.length && FEC_FIELDS.every((f, i) => names[i] === f)
  if (!headerOk) {
    error(1, `En-tête non conforme : attendu les 18 zones ${FEC_FIELDS.join(', ')} dans cet ordre, trouvé ${names.join(', ')}`)
    return done()
  }
  if (rows.length < 2) warn(null, 'Aucune écriture dans le fichier')

  interface EntryAcc {
    firstLine: number
    journal: string
    number: string
    date: string
    dates: Set<string>
    debit: bigint
    credit: bigint
    lines: number
  }
  const entries = new Map<string, EntryAcc>()
  const order: EntryAcc[] = []
  let totalDebit = BigInt(0)
  let totalCredit = BigInt(0)

  for (let i = 1; i < rows.length; i++) {
    const lineNo = i + 1
    const values = rows[i].split(separator)
    if (values.length !== FEC_FIELDS.length) {
      error(lineNo, `${values.length} zones au lieu de 18 (séparateur dans un libellé ?)`)
      continue
    }
    stats.records++
    const record = Object.fromEntries(FEC_FIELDS.map((f, k) => [f, values[k]])) as FecRecord

    for (const field of FEC_REQUIRED_FIELDS) {
      if (record[field].trim() === '') error(lineNo, `Zone ${field} obligatoire non renseignée`, field)
    }
    for (const field of ['EcritureDate', 'PieceDate', 'ValidDate'] as const) {
      if (record[field] !== '' && !isFecDate(record[field])) {
        error(lineNo, `${field} « ${record[field]} » : date attendue au format AAAAMMJJ`, field)
      }
    }
    if (record.DateLet !== '' && !isFecDate(record.DateLet)) {
      error(lineNo, `DateLet « ${record.DateLet} » : date attendue au format AAAAMMJJ`, 'DateLet')
    }
    if (record.DateLet !== '' && record.EcritureLet === '') warn(lineNo, 'DateLet renseignée sans EcritureLet', 'DateLet')
    if (record.EcritureLet !== '' && record.DateLet === '') warn(lineNo, 'EcritureLet renseignée sans DateLet', 'EcritureLet')
    if ((record.CompAuxNum === '') !== (record.CompAuxLib === '')) {
      warn(lineNo, 'CompAuxNum et CompAuxLib doivent être renseignés ensemble', 'CompAuxNum')
    }

    let debit: bigint | null = null
    let credit: bigint | null = null
    for (const field of ['Debit', 'Credit'] as const) {
      const value = record[field]
      if (value === '') continue
      if (!AMOUNT.test(value)) {
        error(
          lineNo,
          `${field} « ${value} » : montant attendu en mode décimal, virgule comme séparateur décimal, sans séparateur de milliers`,
          field,
        )
        continue
      }
      if (field === 'Debit') debit = fecCents(value)
      else credit = fecCents(value)
    }
    if (record.Montantdevise !== '') {
      if (!AMOUNT.test(record.Montantdevise)) {
        error(lineNo, `Montantdevise « ${record.Montantdevise} » : montant décimal à virgule attendu`, 'Montantdevise')
      }
      if (record.Idevise.trim() === '') warn(lineNo, 'Montantdevise renseigné sans Idevise', 'Idevise')
    }
    if (debit !== null && credit !== null) {
      if (debit !== BigInt(0) && credit !== BigInt(0)) {
        error(lineNo, 'Débit et crédit renseignés sur la même ligne : une ligne est soit au débit, soit au crédit')
      } else if (debit === BigInt(0) && credit === BigInt(0)) {
        warn(lineNo, 'Ligne sans montant (débit et crédit nuls)')
      }
    }

    const key = `${record.JournalCode}\u0000${record.EcritureNum}`
    let entry = entries.get(key)
    if (!entry) {
      entry = {
        firstLine: lineNo,
        journal: record.JournalCode,
        number: record.EcritureNum,
        date: record.EcritureDate,
        dates: new Set(),
        debit: BigInt(0),
        credit: BigInt(0),
        lines: 0,
      }
      entries.set(key, entry)
      order.push(entry)
    }
    entry.dates.add(record.EcritureDate)
    entry.lines++
    entry.debit += debit ?? BigInt(0)
    entry.credit += credit ?? BigInt(0)
    totalDebit += debit ?? BigInt(0)
    totalCredit += credit ?? BigInt(0)
  }

  stats.entries = entries.size
  stats.totalDebit = centsToFecAmount(totalDebit)
  stats.totalCredit = centsToFecAmount(totalCredit)

  for (const entry of order) {
    const name = `Écriture ${entry.journal} n° ${entry.number}`
    if (entry.debit !== entry.credit) {
      error(
        entry.firstLine,
        `${name} non équilibrée : débit ${centsToFecAmount(entry.debit)}, crédit ${centsToFecAmount(entry.credit)}`,
      )
    }
    if (entry.lines < 2) error(entry.firstLine, `${name} : une seule ligne (partie double)`)
    if (entry.dates.size > 1) error(entry.firstLine, `${name} : plusieurs dates d'écriture (${[...entry.dates].join(', ')})`)
  }
  if (totalDebit !== totalCredit) {
    error(null, `Fichier non équilibré : total débit ${stats.totalDebit}, total crédit ${stats.totalCredit}`)
  }

  // Opening entries (à-nouveaux) first (BOI-CF-IOR-60-40-20 § 100)
  const firstOther = order.findIndex((e) => !isOpeningJournal(e.journal))
  const lateOpening = firstOther >= 0 ? order.slice(firstOther).find((e) => isOpeningJournal(e.journal)) : undefined
  if (lateOpening) {
    warn(lateOpening.firstLine, `Écriture d'à-nouveaux ${lateOpening.journal} n° ${lateOpening.number} après d'autres écritures : les à-nouveaux sont en principe les premières écritures`)
  }

  checkNumbering(order, stats, error, warn)
  return done()
}

/**
 * EcritureNum: "une séquence continue" (A47 A-1), "croissante dans le temps
 * et [sans] rupture" (BOFiP § 100), global or per journal. A number used by
 * two journals means per-journal numbering.
 */
function checkNumbering(
  order: Array<{ journal: string; number: string; firstLine: number }>,
  stats: FecValidationReport['stats'],
  error: (line: number | null, message: string) => void,
  warn: (line: number | null, message: string) => void,
): void {
  if (order.length === 0) return
  const sequences = order.map((e) => sequentialPartOf(e.number))
  if (sequences.some((s) => s === null)) {
    warn(null, 'Numéros d\'écriture non numériques : la continuité de la numérotation n\'a pas pu être vérifiée')
    return
  }
  // Same sequence number in two journals ("1" and "1", or "VT-1" and "AC-1"): per-journal numbering
  const journalsByNumber = new Map<number, Set<string>>()
  order.forEach((e, i) => {
    const seq = sequences[i] as number
    const set = journalsByNumber.get(seq) ?? new Set<string>()
    set.add(e.journal)
    journalsByNumber.set(seq, set)
  })
  const perJournal = [...journalsByNumber.values()].some((s) => s.size > 1)
  stats.numbering = perJournal ? 'journal' : 'global'

  const groups = new Map<string, Array<{ seq: number; line: number; number: string; opening: boolean }>>()
  order.forEach((e, i) => {
    const key = perJournal ? e.journal : ''
    const list = groups.get(key) ?? []
    list.push({ seq: sequences[i] as number, line: e.firstLine, number: e.number, opening: isOpeningJournal(e.journal) })
    groups.set(key, list)
  })

  for (const [journal, list] of groups) {
    const scope = perJournal ? ` du journal ${journal}` : ''
    const seqs = [...new Set(list.map((x) => x.seq))].sort((a, b) => a - b)
    for (let k = 1; k < seqs.length; k++) {
      if (seqs[k] !== seqs[k - 1] + 1) {
        error(null, `Numérotation${scope} non continue : rupture entre ${seqs[k - 1]} et ${seqs[k]}`)
      }
    }
    // Increasing in file order, opening entries aside (they may come first with a later number, BOFiP § 110)
    let previous: { seq: number; number: string } | null = null
    for (const x of list) {
      if (x.opening) continue
      if (previous && x.seq < previous.seq) {
        warn(x.line, `Numérotation${scope} non croissante : n° ${x.number} après n° ${previous.number}`)
      }
      previous = x
    }
  }
}
