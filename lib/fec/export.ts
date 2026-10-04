/**
 * FEC export (LPF art. A47 A-1, BOI-CF-IOR-60-40-20), see lib/fec/format.ts.
 *
 * - One file per fiscal year: all the validated entries of the year
 *   ("l'ensemble des écritures comptables passées au titre de l'exercice",
 *   BOFiP § 20), drafts excluded (they are not entries yet).
 * - Opening entries (à-nouveaux, journals AN/RAN/OU) come first (BOFiP § 50
 *   and § 100), then the entries in validation order. Kledg assigns numbers at
 *   validation, so validation order is number order (BOFiP § 40: "numérotées
 *   chronologiquement de manière croissante, sans rupture ni inversion").
 * - Closing entries are included once the year is closed; an open year has
 *   none (BOFiP § 30).
 * - One record per entry line; amounts from Decimal(15, 2) as exact cents.
 * - PieceRef falls back to the entry number and EcritureLib to the entry
 *   description, then the account label, so no mandatory field is blank.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError, ValidationError } from '@/lib/accounting/errors'
import { fecDateOf, parisDayOf } from '@/lib/accounting/entry-date'
import { calendarDayOf } from '@/lib/utils/date'
import { centsToFecAmount, parseCents } from '@/lib/utils/money'
import { sequentialPartOf } from '@/lib/accounting/services/generate-next-entry-number.service'
import {
  FEC_FIELDS,
  FEC_LINE_END,
  FEC_SEPARATOR,
  fecFileName,
  isOpeningJournal,
  normalizeSiren,
  sanitizeFecField,
  type FecRecord,
} from './format'

type Amount = { toString(): string }

export interface FecLedgerLine {
  accountCode: string
  accountLabel: string
  auxiliaryAccountNumber: string | null
  auxiliaryAccountLabel: string | null
  description: string | null
  debit: Amount
  credit: Amount
  letteringCode: string | null
  letteringDate: Date | null
  currencyAmount: Amount | null
  currencyCode: string | null
}

export interface FecLedgerEntry {
  journalCode: string
  journalLabel: string
  entryNumber: string
  date: Date
  reference: string | null
  pieceDate: Date | null
  description: string | null
  validatedAt: Date | null
  lines: FecLedgerLine[]
}

function cents(value: Amount): number {
  const parsed = parseCents(value.toString())
  if (parsed === null) throw new ValidationError(`Montant invalide dans le grand livre : ${value.toString()}`)
  return parsed
}

/** FEC ValidDate: the day (in France) the entry was validated. */
function validDateOf(entry: FecLedgerEntry): string {
  return entry.validatedAt ? parisDayOf(entry.validatedAt).replace(/-/g, '') : fecDateOf(entry.date)
}

/**
 * Order of the file: opening entries first, then validation order (sequence
 * number; journal and raw number break ties for imported per-journal
 * numbering).
 */
export function sortFecEntries<T extends Pick<FecLedgerEntry, 'journalCode' | 'entryNumber'>>(entries: T[]): T[] {
  const seq = (n: string) => sequentialPartOf(n) ?? Number.MAX_SAFE_INTEGER
  return [...entries].sort((a, b) => {
    const opening = Number(isOpeningJournal(b.journalCode)) - Number(isOpeningJournal(a.journalCode))
    if (opening !== 0) return opening
    return (
      seq(a.entryNumber) - seq(b.entryNumber) ||
      a.journalCode.localeCompare(b.journalCode) ||
      a.entryNumber.localeCompare(b.entryNumber)
    )
  })
}

/** FEC records of the entries (one per line), in file order. */
export function fecRecords(entries: FecLedgerEntry[]): FecRecord[] {
  const records: FecRecord[] = []
  for (const entry of sortFecEntries(entries)) {
    const entryDate = fecDateOf(entry.date)
    const pieceDate = entry.pieceDate ? fecDateOf(entry.pieceDate) : entryDate
    const validDate = validDateOf(entry)
    for (const line of entry.lines) {
      records.push({
        JournalCode: sanitizeFecField(entry.journalCode),
        JournalLib: sanitizeFecField(entry.journalLabel),
        EcritureNum: sanitizeFecField(entry.entryNumber),
        EcritureDate: entryDate,
        CompteNum: sanitizeFecField(line.accountCode),
        CompteLib: sanitizeFecField(line.accountLabel),
        CompAuxNum: sanitizeFecField(line.auxiliaryAccountNumber),
        CompAuxLib: sanitizeFecField(line.auxiliaryAccountLabel),
        PieceRef: sanitizeFecField(entry.reference) || sanitizeFecField(entry.entryNumber),
        PieceDate: pieceDate,
        EcritureLib:
          sanitizeFecField(line.description) ||
          sanitizeFecField(entry.description) ||
          sanitizeFecField(line.accountLabel),
        Debit: centsToFecAmount(cents(line.debit)),
        Credit: centsToFecAmount(cents(line.credit)),
        EcritureLet: sanitizeFecField(line.letteringCode),
        DateLet: line.letteringDate ? fecDateOf(line.letteringDate) : '',
        ValidDate: validDate,
        Montantdevise: line.currencyAmount === null ? '' : centsToFecAmount(cents(line.currencyAmount)),
        Idevise: sanitizeFecField(line.currencyCode),
      })
    }
  }
  return records
}

/** The FEC file content: header record, then one record per line, CR/LF after each record. */
export function buildFec(entries: FecLedgerEntry[]): string {
  const rows = [FEC_FIELDS.join(FEC_SEPARATOR)]
  for (const record of fecRecords(entries)) rows.push(FEC_FIELDS.map((f) => record[f]).join(FEC_SEPARATOR))
  return rows.join(FEC_LINE_END) + FEC_LINE_END
}

interface FecLineRow {
  entryId: string
  entryNumber: string
  date: Date
  reference: string | null
  pieceDate: Date | null
  entryDescription: string | null
  validatedAt: Date | null
  journalCode: string
  journalLabel: string
  accountCode: string
  accountLabel: string
  auxiliaryAccountNumber: string | null
  auxiliaryAccountLabel: string | null
  description: string | null
  debit: string
  credit: string
  letteringCode: string | null
  letteringDate: Date | null
  currencyAmount: string | null
  currencyCode: string | null
}

/**
 * Validated entries of a fiscal year, as the FEC needs them. One flat query
 * (no nested relation loading, whose IN lists exceed the bind parameter limit
 * on a year of tens of thousands of lines). Amounts are read as text: the
 * exact Decimal(15, 2) value, converted to cents by fecRecords. Lines keep
 * their creation order within the entry.
 */
export async function loadFecLedger(companyId: string, fiscalYearId: string): Promise<FecLedgerEntry[]> {
  const rows = await prisma.$queryRaw<FecLineRow[]>`
    SELECT e."id" AS "entryId", e."entryNumber", e."date", e."reference", e."pieceDate",
           e."description" AS "entryDescription", e."validatedAt",
           j."code" AS "journalCode", j."label" AS "journalLabel",
           a."code" AS "accountCode", a."label" AS "accountLabel",
           l."auxiliaryAccountNumber", l."auxiliaryAccountLabel", l."description",
           l."debit"::text AS debit, l."credit"::text AS credit,
           l."letteringCode", l."letteringDate", l."currencyAmount"::text AS "currencyAmount", l."currencyCode"
    FROM "accounting_entries" e
    JOIN "journals" j ON j."id" = e."journalId"
    JOIN "entry_lines" l ON l."accountingEntryId" = e."id"
    JOIN "accounts" a ON a."id" = l."accountId"
    WHERE e."companyId" = ${companyId} AND e."fiscalYearId" = ${fiscalYearId} AND e."status" = 'validated'
    ORDER BY e."id", l."createdAt", l."id"
  `
  const entries: FecLedgerEntry[] = []
  let current: { id: string; entry: FecLedgerEntry } | null = null
  for (const row of rows) {
    if (!current || current.id !== row.entryId) {
      current = {
        id: row.entryId,
        entry: {
          journalCode: row.journalCode,
          journalLabel: row.journalLabel,
          entryNumber: row.entryNumber,
          date: row.date,
          reference: row.reference,
          pieceDate: row.pieceDate,
          description: row.entryDescription,
          validatedAt: row.validatedAt,
          lines: [],
        },
      }
      entries.push(current.entry)
    }
    current.entry.lines.push({
      accountCode: row.accountCode,
      accountLabel: row.accountLabel,
      auxiliaryAccountNumber: row.auxiliaryAccountNumber,
      auxiliaryAccountLabel: row.auxiliaryAccountLabel,
      description: row.description,
      debit: row.debit,
      credit: row.credit,
      letteringCode: row.letteringCode,
      letteringDate: row.letteringDate,
      currencyAmount: row.currencyAmount,
      currencyCode: row.currencyCode,
    })
  }
  return entries
}

export interface FecExport {
  fileName: string
  content: string
  entries: number
  lines: number
}

/** FEC of a fiscal year: file name "SirenFECAAAAMMJJ.txt" and content. */
export async function exportFec(companyId: string, fiscalYearId: string): Promise<FecExport> {
  const [company, fiscalYear] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { siren: true } }),
    prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, companyId }, select: { endDate: true } }),
  ])
  if (!company) throw new NotFoundError('Société introuvable')
  if (!fiscalYear) throw new NotFoundError('Exercice introuvable')
  const siren = normalizeSiren(company.siren)
  if (!siren) {
    throw new ValidationError('Le SIREN de la société (9 chiffres) est requis pour nommer le FEC : renseignez-le dans les paramètres.')
  }
  const closingDay = calendarDayOf(fiscalYear.endDate)
  if (!closingDay) throw new ValidationError("Date de clôture de l'exercice invalide")

  const ledger = await loadFecLedger(companyId, fiscalYearId)
  return {
    fileName: fecFileName(siren, closingDay.replace(/-/g, '')),
    content: buildFec(ledger),
    entries: ledger.length,
    lines: ledger.reduce((n, e) => n + e.lines.length, 0),
  }
}
