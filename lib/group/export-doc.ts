/**
 * The file formats of the group space exports (export-group.service.ts): a
 * document of titled sections, written as a CSV file or an Excel workbook
 * (one sheet per section).
 *
 * CSV cells go through lib/reports/csv-safe (formula injection, separators),
 * amounts with a decimal comma, a byte order mark so Excel reads UTF-8. The
 * workbook keeps numbers as numbers (ExcelJS writes text as text, never a
 * formula). An amount is in cents: in a column listed in `amountColumns`,
 * or as an `{ cents }` cell where a column mixes amounts and other values.
 */

import ExcelJS from 'exceljs'
import { buildCsv } from '@/lib/reports/csv-safe'
import { centsToFecAmount, fromCents } from '@/lib/utils/money'

export type Cell = string | number | null | { cents: number }
export type Row = Cell[]

export interface Section {
  name: string
  header: string[]
  rows: Row[]
  /** 1-based columns holding cents. */
  amountColumns: number[]
}

export interface ExportDoc {
  title: string
  holdingName: string
  year: number
  /** A sentence under the title (the indicative notice of a combined figure). */
  notice?: string | null
  sections: Section[]
}

const AMOUNT_FORMAT = '#,##0.00 [$€-40C];-#,##0.00 [$€-40C]'

/** "60,00 %" from basis points. */
export const percentCell = (bp: number | null) => (bp === null ? '' : `${centsToFecAmount(bp)} %`)

/** The cents of a cell when it is an amount, else null. */
function centsOf(section: Section, cell: Cell, column: number): number | null {
  if (cell !== null && typeof cell === 'object') return cell.cents
  return section.amountColumns.includes(column) && typeof cell === 'number' ? cell : null
}

export function toCsv(doc: ExportDoc): string {
  const out: Array<Array<string | number | null>> = [[doc.title]]
  if (doc.notice) out.push([doc.notice])
  for (const section of doc.sections) {
    out.push([], [section.name], section.header)
    for (const row of section.rows) {
      out.push(
        row.map((cell, i) => {
          const cents = centsOf(section, cell, i + 1)
          if (cents !== null) return centsToFecAmount(cents)
          return cell !== null && typeof cell === 'object' ? null : cell
        }),
      )
    }
  }
  return `﻿${buildCsv(out)}`
}

/** Excel limits sheet names to 31 characters, without some punctuation. */
const sheetName = (name: string) => name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)

export async function toWorkbook(doc: ExportDoc): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  for (const section of doc.sections) {
    const sheet = workbook.addWorksheet(sheetName(section.name))
    sheet.addRow([doc.title]).font = { bold: true }
    if (doc.notice) sheet.addRow([doc.notice])
    sheet.addRow([])
    sheet.addRow(section.header).font = { bold: true }
    for (const row of section.rows) {
      const amounts: number[] = []
      const added = sheet.addRow(
        row.map((cell, i) => {
          const cents = centsOf(section, cell, i + 1)
          if (cents !== null) {
            amounts.push(i + 1)
            return fromCents(cents)
          }
          return cell !== null && typeof cell === 'object' ? null : cell
        }),
      )
      for (const column of amounts) added.getCell(column).numFmt = AMOUNT_FORMAT
    }
    sheet.columns = section.header.map((_, i) => ({ width: i === 0 ? 36 : 20 }))
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}
