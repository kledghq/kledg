/**
 * Entry point of statement parsing: detects the format of an uploaded file
 * and hands it to the matching parser. Pure (no database access); throws a
 * ValidationError with a French message for files it cannot read.
 */

import ExcelJS from 'exceljs'
import { ValidationError } from '@/lib/accounting/errors'
import { assertSafeZip, isZip } from '@/lib/api/files'
import { parseCamt053 } from './camt053'
import { decodeText, looksBinary } from './encoding'
import { parseOfx } from './ofx'
import { parseTabular, splitCsv, type Cell } from './tabular'
import type { ParseResult, StatementFormat, TabularOptions } from './types'

function detectFormat(bytes: Uint8Array, text?: string): StatementFormat {
  if (isZip(bytes)) return 'xlsx'
  const head = (text ?? '').slice(0, 4096).replace(/^﻿/, '').trimStart()
  if (/^OFXHEADER/i.test(head) || /<OFX>/i.test(head)) return 'ofx'
  if (head.startsWith('<')) {
    if (/camt\.053|BkToCstmrStmt/.test(head)) return 'camt053'
    if (/camt\.05[24]|BkToCstmrAcctRpt|BkToCstmrDbtCdtNtfctn/.test(head)) {
      throw new ValidationError('Fichier camt.052 ou camt.054 non pris en charge : exportez le relevé au format camt.053.')
    }
    if (/<OFX/i.test(text ?? '')) return 'ofx'
    if (/BkToCstmrStmt/.test(text ?? '')) return 'camt053'
    throw new ValidationError('Fichier XML non reconnu : seuls les relevés camt.053 et OFX sont pris en charge.')
  }
  return 'csv'
}

function rejectBinary(bytes: Uint8Array): void {
  const head = String.fromCharCode(...bytes.subarray(0, 8))
  if (head.startsWith('%PDF')) {
    throw new ValidationError(
      'Les relevés PDF ne sont pas pris en charge : exportez vos opérations en CSV, OFX ou camt.053 depuis votre espace bancaire.',
    )
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new ValidationError('Les fichiers Excel 97-2003 (.xls) ne sont pas pris en charge : enregistrez-le en .xlsx ou en CSV.')
  }
  throw new ValidationError('Fichier illisible : formats acceptés CSV, Excel (.xlsx), OFX/QFX et camt.053 (XML).')
}

async function readWorkbook(bytes: Uint8Array, sheetName?: string): Promise<{ rows: Cell[][]; sheetNames: string[] }> {
  await assertSafeZip(bytes)
  const workbook = new ExcelJS.Workbook()
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(Buffer.from(bytes) as any)
  } catch {
    throw new ValidationError('Fichier Excel invalide ou corrompu.')
  }
  const sheetNames = workbook.worksheets.map((w) => w.name)
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0]
  if (!sheet) throw new ValidationError(sheetName ? `Feuille « ${sheetName} » introuvable dans le classeur.` : 'Classeur Excel vide.')
  const rows: Cell[][] = []
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values = (row.values as unknown[]).slice(1)
    rows[rowNumber - 1] = values.map((raw): Cell => {
      if (raw === null || raw === undefined) return null
      if (raw instanceof Date || typeof raw === 'number' || typeof raw === 'string') return raw
      if (typeof raw === 'boolean') return String(raw)
      const o = raw as Record<string, unknown>
      if ('result' in o) return (o.result as Cell) ?? null
      if ('richText' in o && Array.isArray(o.richText)) return o.richText.map((t: { text: string }) => t.text).join('')
      if ('text' in o) return String(o.text)
      return null
    })
  })
  for (let i = 0; i < rows.length; i++) rows[i] ??= []
  return { rows, sheetNames }
}

/** Parses a statement file of any supported format. */
export async function parseStatementFile(bytes: Uint8Array, options: TabularOptions = {}): Promise<ParseResult> {
  if (bytes.length === 0) throw new ValidationError('Le fichier est vide.')

  if (isZip(bytes)) {
    const { rows, sheetNames } = await readWorkbook(bytes, options.sheetName)
    const parsed = parseTabular(rows, options, { sheetNames })
    return { format: 'xlsx', transactions: parsed.transactions, errors: parsed.errors, warnings: parsed.warnings, accounts: [], tabular: parsed.detection }
  }

  const hasBom = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)
  if (!hasBom && looksBinary(bytes)) rejectBinary(bytes)
  const { text, encoding } = decodeText(bytes)
  const format = detectFormat(bytes, text)

  if (format === 'ofx') {
    return { format, encoding, ...parseOfx(text) }
  }
  if (format === 'camt053') {
    return { format, encoding, ...parseCamt053(text) }
  }
  const { delimiter, rows } = splitCsv(text, options.delimiter)
  if (!rows.some((row) => row.some((cell) => cell.trim() !== ''))) throw new ValidationError('Le fichier ne contient aucune ligne.')
  const parsed = parseTabular(rows, options, { delimiter })
  return { format: 'csv', encoding, transactions: parsed.transactions, errors: parsed.errors, warnings: parsed.warnings, accounts: [], tabular: parsed.detection }
}
