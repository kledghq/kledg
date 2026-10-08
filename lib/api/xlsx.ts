/**
 * Bounded reading of an uploaded .xlsx (bank statement import and
 * accounting import, KLEDG-R3-INPUT-01). A cell's position costs nothing in
 * the file but a lot once read: a few KB file with a cell in A1048576 or in
 * column XFD made the parsers build a million rows or 16,384 slots per row,
 * and a single merged range, data validation or defined name over the whole
 * sheet made ExcelJS create every cell of it. So:
 *
 * - assertSafeZip bounds what ExcelJS builds (inflated bytes, cells, XML
 *   elements) before it reads anything;
 * - ExcelJS skips the sheet parts it would expand cell by cell from one range
 *   (merged cells, data validations, conditional formats, hyperlinks) and
 *   the workbook drops its defined names: imports read cell values only;
 * - the sheet's last row and every row's last column are checked before any
 *   row is materialised, cells are read one by one up to the row's last
 *   column (never `row.values`), and nothing is allocated past the bounds;
 * - the whole read runs under a time budget.
 */

import ExcelJS from 'exceljs'
import { ValidationError } from '@/lib/accounting/errors'
import { logger } from '@/lib/logger'
import { assertSafeZip } from './files'

/** Last column an imported sheet may use (Excel allows 16,384). */
export const XLSX_MAX_COLUMNS = 256

/** Time budget of reading one workbook (unzip, parse, rows). */
export const XLSX_READ_BUDGET_MS = 30_000

/** Sheet parts ExcelJS expands cell by cell from a single range; imports read none of them. */
const IGNORED_SHEET_NODES = ['mergeCells', 'dataValidations', 'conditionalFormatting', 'hyperlinks', 'extLst']

function tooSlow(): ValidationError {
  return new ValidationError('Fichier Excel refusé : sa lecture prend trop de temps. Découpez-le ou exportez-le en CSV.')
}

/** Rejects once the deadline passes (the work itself is bounded by the guard's limits). */
async function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(tooSlow()), Math.max(0, deadline - Date.now()))
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export interface LoadedWorkbook {
  workbook: ExcelJS.Workbook
  /** Epoch ms after which reading must stop (pass it to readSheetRows). */
  deadline: number
}

/**
 * Loads an uploaded workbook under the guard, the ignored parts and the time
 * budget. `unreadable` is the French message for a file ExcelJS cannot read.
 */
export async function loadWorkbook(bytes: Uint8Array, unreadable: string, budgetMs = XLSX_READ_BUDGET_MS): Promise<LoadedWorkbook> {
  const deadline = Date.now() + budgetMs
  await beforeDeadline(assertSafeZip(bytes), deadline)
  const workbook = new ExcelJS.Workbook()
  // ExcelJS creates every cell of a defined name's range when it builds the workbook
  // (CellMatrix.addCellEx): one name over A1:XFD1048576 never ends. Imports read no names.
  Object.defineProperty(workbook.definedNames, 'model', { configurable: true, get: () => [], set: () => {} })
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await beforeDeadline(workbook.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as any, { ignoreNodes: IGNORED_SHEET_NODES }), deadline)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    // ExcelJS reasons are internal (zip and XML details): logged, not shown
    logger.warn('[xlsx] Unreadable workbook', error)
    throw new ValidationError(unreadable)
  }
  return { workbook, deadline }
}

export interface SheetBounds {
  /** Last row the sheet may use. */
  maxRows: number
  /** Last column the sheet may use (default XLSX_MAX_COLUMNS). */
  maxColumns?: number
  deadline: number
}

export interface SheetRow {
  /** 1-based row number in the sheet. */
  number: number
  /** Raw ExcelJS cell values, index 0 = column A, up to the row's last cell. */
  values: unknown[]
  /** At least one cell holds a value. */
  hasValue: boolean
}

/**
 * The rows of a sheet that exist in the file, in order, each with its cell
 * values. Refuses (French ValidationError) a sheet whose last row or a row's
 * last column is beyond the bounds, before reading it; only the cells up to
 * a row's last cell are read (bounded by maxColumns).
 */
export function readSheetRows(sheet: ExcelJS.Worksheet, bounds: SheetBounds): SheetRow[] {
  const maxColumns = bounds.maxColumns ?? XLSX_MAX_COLUMNS
  // rowCount is the last row present in the model (no row is created to find it)
  const lastRow = sheet.rowCount
  if (lastRow > bounds.maxRows) {
    throw new ValidationError(
      `Fichier Excel refusé : la feuille « ${sheet.name} » va jusqu'à la ligne ${lastRow} (maximum ${bounds.maxRows}). Supprimez les lignes inutiles ou découpez le fichier.`,
    )
  }
  for (let r = 1; r <= lastRow; r++) {
    const row = sheet.findRow(r)
    if (row && row.cellCount > maxColumns) {
      throw new ValidationError(
        `Fichier Excel refusé : la ligne ${r} de la feuille « ${sheet.name} » va au-delà de la colonne ${maxColumns}. Supprimez les colonnes inutiles ou exportez la feuille en CSV.`,
      )
    }
  }
  const rows: SheetRow[] = []
  for (let r = 1; r <= lastRow; r++) {
    if (r % 1000 === 0 && Date.now() > bounds.deadline) throw tooSlow()
    const row = sheet.findRow(r)
    if (!row) continue
    const count = row.cellCount
    const values: unknown[] = new Array(count)
    let hasValue = false
    for (let c = 1; c <= count; c++) {
      const value = row.findCell(c)?.value ?? null
      values[c - 1] = value
      if (value !== null && value !== '') hasValue = true
    }
    rows.push({ number: r, values, hasValue })
  }
  return rows
}
