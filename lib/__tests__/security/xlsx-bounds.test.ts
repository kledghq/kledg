/**
 * KLEDG-R3-INPUT-01: a few KB .xlsx with far away cells, or with one range
 * ExcelJS expands cell by cell (merged cells, data validation, defined
 * name), made the statement import and the accounting import allocate
 * gigabytes or block the event loop (the merged range, validation and name
 * cases killed the process from a 2 KB file). Both parsers read through
 * lib/api/xlsx.ts now: each case is refused or parsed in well under a second
 * and a few MB of heap, and a normal workbook still parses.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { parseStatementFile } from '@/lib/banking/import/parse'
import { parseExcel } from '@/lib/import/excel'

// The JSZip ExcelJS itself loads (not a direct dependency of Kledg).
const requireHere = createRequire(import.meta.url)
interface ZipFile {
  async(type: 'string'): Promise<string>
}
interface Zip {
  file(name: string): ZipFile | null
  file(name: string, data: string): Zip
  generateAsync(options: { type: 'nodebuffer'; compression: 'DEFLATE' }): Promise<Buffer>
}
const JSZip = createRequire(requireHere.resolve('exceljs'))('jszip') as { loadAsync(data: Uint8Array): Promise<Zip> }

async function workbook(fill: (ws: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('S')
  ws.getCell('A1').value = 'Date'
  ws.getCell('B1').value = 'Libelle'
  ws.getCell('C1').value = 'Montant'
  fill(ws)
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

/** A small workbook whose sheet or workbook XML is edited by hand. */
async function patched(edit: { sheet?: (xml: string) => string; book?: (xml: string) => string }): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await workbook((ws) => ws.addRow(['01/02/2026', 'Loyer', -500])))
  if (edit.sheet) zip.file('xl/worksheets/sheet1.xml', edit.sheet(await zip.file('xl/worksheets/sheet1.xml')!.async('string')))
  if (edit.book) zip.file('xl/workbook.xml', edit.book(await zip.file('xl/workbook.xml')!.async('string')))
  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

async function measure(run: () => Promise<unknown>) {
  const before = process.memoryUsage().heapUsed
  let peak = before
  const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().heapUsed)), 20)
  const start = performance.now()
  const outcome = await run().then(
    () => 'parsed',
    (error: Error) => `refused: ${error.message}`,
  )
  clearInterval(timer)
  peak = Math.max(peak, process.memoryUsage().heapUsed)
  return { ms: performance.now() - start, heapMb: (peak - before) / 1048576, outcome }
}

const WHOLE_SHEET = 'A1:XFD1048576'

describe('[KLEDG-R3-INPUT-01] xlsx rows, columns and ranges are bounded', () => {
  it('statement import: one cell at row 1048576 is refused at once', async () => {
    const bytes = await workbook((ws) => {
      ws.getCell('A1048576').value = 'x'
    })
    expect(bytes.length).toBeLessThan(10_000)
    const m = await measure(() => parseStatementFile(bytes))
    expect(m.outcome).toMatch(/refused: Fichier Excel refusé\u00a0: la feuille « S » va jusqu'à la ligne 1048576/)
    expect(m.ms).toBeLessThan(1000)
    expect(m.heapMb).toBeLessThan(50)
  })

  it('accounting import: one cell at row 1048576 is refused at once', async () => {
    const bytes = await workbook((ws) => {
      ws.getCell('A1048576').value = 'x'
    })
    const m = await measure(() => parseExcel(Buffer.from(bytes)))
    expect(m.outcome).toMatch(/refused: Fichier Excel refusé/)
    expect(m.ms).toBeLessThan(1000)
  })

  it('both imports: 5,000 cells in column XFD are refused at once', async () => {
    const bytes = await workbook((ws) => {
      for (let r = 2; r < 5002; r++) ws.getCell(`XFD${r}`).value = 1
    })
    for (const run of [() => parseStatementFile(bytes), () => parseExcel(Buffer.from(bytes))]) {
      const m = await measure(run)
      expect(m.outcome).toMatch(/refused: Fichier Excel refusé\u00a0: la ligne 2 de la feuille « S » va au-delà de la colonne 256/)
      expect(m.ms).toBeLessThan(1000)
      expect(m.heapMb).toBeLessThan(100)
    }
  })

  it.each([
    ['merged cells', { sheet: (x: string) => x.replace('</sheetData>', `</sheetData><mergeCells count="1"><mergeCell ref="${WHOLE_SHEET}"/></mergeCells>`) }],
    [
      'data validation',
      {
        sheet: (x: string) =>
          x.replace('<pageMargins', `<dataValidations count="1"><dataValidation type="whole" sqref="${WHOLE_SHEET}"><formula1>1</formula1></dataValidation></dataValidations><pageMargins`),
      },
    ],
    [
      'conditional format',
      {
        sheet: (x: string) =>
          x.replace('<pageMargins', `<conditionalFormatting sqref="${WHOLE_SHEET}"><cfRule type="cellIs" dxfId="0" priority="1" operator="equal"><formula>1</formula></cfRule></conditionalFormatting><pageMargins`),
      },
    ],
    ['defined name', { book: (x: string) => x.replace('</sheets>', '</sheets><definedNames><definedName name="all">S!$A$1:$XFD$1048576</definedName></definedNames>').replace('<definedNames/>', '') }],
  ])('a %s over the whole sheet is never expanded', async (_, edit) => {
    const bytes = await patched(edit)
    expect(bytes.length).toBeLessThan(10_000)
    const statement = await measure(() => parseStatementFile(bytes))
    expect(statement.outcome).toBe('parsed')
    expect(statement.ms).toBeLessThan(1000)
    expect(statement.heapMb).toBeLessThan(50)
    const accounting = await measure(() => parseExcel(Buffer.from(bytes)))
    expect(accounting.outcome).toBe('parsed')
    expect(accounting.ms).toBeLessThan(1000)
  })

  it('a workbook with more cells than the budget is refused before ExcelJS builds them', async () => {
    // 1,000,001 empty cells (`<c r=".."/>`): about 2 MB once deflated
    const cells: string[] = []
    for (let r = 2; r <= 100_001; r++) {
      let row = `<row r="${r}">`
      for (let c = 0; c < 10; c++) row += `<c r="${'ABCDEFGHIJ'[c]}${r}"/>`
      cells.push(row + '</row>')
    }
    cells.push('<row r="100002"><c r="A100002"/></row>')
    const bytes = await patched({ sheet: (x) => x.replace('</sheetData>', `${cells.join('')}</sheetData>`) })
    const m = await measure(() => parseStatementFile(bytes))
    expect(m.outcome).toMatch(/refused: Fichier Excel refusé\u00a0: il contient trop de cellules/)
    expect(m.heapMb).toBeLessThan(150)
  }, 30_000)

  it('a normal statement still parses, dates and amounts included', async () => {
    const bytes = await workbook((ws) => {
      ws.addRow([new Date(Date.UTC(2026, 1, 3)), 'Loyer février', -500.25])
      ws.addRow([new Date(Date.UTC(2026, 1, 4)), 'Virement client', 1200])
      ws.mergeCells('E1:F2')
    })
    const result = await parseStatementFile(bytes)
    expect(result.format).toBe('xlsx')
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[0]).toMatchObject({ label: 'Loyer février', amountCents: -50025 })
  })

  it('a normal accounting sheet still parses into header keyed rows', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Ecritures')
    ws.addRow(['date', 'journal', 'entryNumber', 'account', 'debit', 'credit', 'description'])
    ws.addRow(['2026-01-05', 'BQ', '1', '512000', 0, 100, 'Frais'])
    ws.addRow([])
    ws.addRow(['2026-01-05', 'BQ', '1', '627000', 100, 0, 'Frais'])
    const rows = await parseExcel(Buffer.from(await wb.xlsx.writeBuffer()))
    expect(rows).toEqual([
      { date: '2026-01-05', journal: 'BQ', entryNumber: '1', account: '512000', debit: 0, credit: 100, description: 'Frais' },
      { date: '2026-01-05', journal: 'BQ', entryNumber: '1', account: '627000', debit: 100, credit: 0, description: 'Frais' },
    ])
  })
})
