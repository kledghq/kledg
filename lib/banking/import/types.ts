/**
 * Shared types of the bank statement file import (CSV, Excel, OFX/QFX,
 * CAMT.053). Parsers are pure: they turn a file into `ParsedTransaction`s and
 * never touch the database (see `importer.ts` for that).
 */

export type StatementFormat = 'csv' | 'xlsx' | 'ofx' | 'camt053'

/** A calendar date, `YYYY-MM-DD`, with no time and no timezone. */
export type CalendarDate = string

export interface ParsedTransaction {
  /** Booking date (date comptable / date d'opération). */
  bookingDate: CalendarDate
  /** Value date (date de valeur), when the file has one. */
  valueDate?: CalendarDate
  /** Signed amount in cents: negative for money leaving the account. Always an integer. */
  amountCents: number
  /** ISO 4217 currency when the file says it. */
  currency?: string
  label: string
  /** Reference meant for humans (remittance reference, end-to-end id, cheque number...). */
  reference?: string
  /** Identifier given by the bank to the entry (FITID, AcctSvcrRef...): used for dedupe. */
  bankReference?: string
  counterparty?: string
  /** Account of the statement (IBAN or bank account id) when the file names it (OFX, CAMT). */
  account?: string
  /** 1-based line (CSV/Excel) or entry index (OFX/CAMT) in the source file, for error messages. */
  line: number
}

export interface RowError {
  /** File line; 0 for a blocking file-level error (missing column), -1 for a file-level error the user may confirm. */
  line: number
  message: string
}

/** Account the statement belongs to, when the file says it (OFX, CAMT). */
export interface StatementAccount {
  iban?: string
  accountId?: string
  currency?: string
}

/** Column roles a tabular file (CSV, Excel) can be mapped to. */
export const COLUMN_ROLES = [
  'date',
  'valueDate',
  'label',
  'label2',
  'reference',
  'transactionId',
  'amount',
  'debit',
  'credit',
  'currency',
  'counterparty',
  'status',
] as const
export type ColumnRole = (typeof COLUMN_ROLES)[number]

/** Column index (0-based) for each role. */
export type ColumnMapping = Partial<Record<ColumnRole, number>>

export const DATE_FORMAT_VALUES = ['dd/mm/yyyy', 'dd/mm/yy', 'yyyy-mm-dd', 'mm/dd/yyyy', 'yyyymmdd'] as const
export type DateFormat = (typeof DATE_FORMAT_VALUES)[number]
export type DecimalSeparator = ',' | '.'

/** Options the user can force when the detection is unsure. */
export interface TabularOptions {
  mapping?: ColumnMapping
  dateFormat?: DateFormat
  decimalSeparator?: DecimalSeparator
  /** 0-based index of the header row in the file. */
  headerRow?: number
  /** Preset id (see presets.ts). */
  preset?: string
  delimiter?: string
  /** Excel sheet name. */
  sheetName?: string
}

export interface TabularDetection {
  delimiter?: string
  headerRow: number
  headers: string[]
  /** A few raw rows after the header, to show the user what the columns hold. */
  sampleRows: string[][]
  mapping: ColumnMapping
  dateFormat: DateFormat
  decimalSeparator: DecimalSeparator
  preset?: { id: string; name: string }
  /** 'high' when a preset or the header names gave every required column. */
  confidence: 'high' | 'low'
  sheetNames?: string[]
}

export interface ParseResult {
  format: StatementFormat
  encoding?: string
  transactions: ParsedTransaction[]
  errors: RowError[]
  /** Non-blocking notes (skipped pending entries, other accounts in the file...). */
  warnings: string[]
  accounts: StatementAccount[]
  tabular?: TabularDetection
}
