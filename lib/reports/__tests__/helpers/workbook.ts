/**
 * Reads back the workbooks produced by the report exports, so tests assert
 * the cell values a user opens in Excel.
 */

import ExcelJS from 'exceljs'

export async function readWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  return workbook
}

/** Non-empty rows of a sheet, each as its cell values from column A (empty cells as undefined). */
export function rowsOf(sheet: ExcelJS.Worksheet | undefined): ExcelJS.CellValue[][] {
  if (!sheet) throw new Error('Missing worksheet')
  const rows: ExcelJS.CellValue[][] = []
  sheet.eachRow((row) => {
    const values = row.values as ExcelJS.CellValue[]
    rows.push(Array.from({ length: values.length - 1 }, (_, i) => values[i + 1]))
  })
  return rows
}
