/**
 * Generates Excel export for journal report
 */

import ExcelJS from 'exceljs'
import { roundEuros } from '../amounts'
import { calendarDayOf, formatIsoDateFr } from '@/lib/utils/date'
import type { JournalReportData } from './get-journal-report.service'

/** dd/mm/yyyy of the calendar day of an entry (stored at midnight UTC), whatever the server timezone. */
function formatDate(iso: string): string {
  return formatIsoDateFr(calendarDayOf(iso) ?? '')
}

export async function generateJournalExcel(
  data: JournalReportData
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Journal')

  sheet.addRow([
    'Journal',
    'Date',
    "N° d'écriture",
    'Référence',
    'Libellé écriture',
    'Compte',
    'Libellé compte',
    'Libellé ligne',
    'Débit',
    'Crédit',
  ])

  for (const journalData of data.journals) {
    const journalCode = journalData.journal.code
    const journalLabel = journalData.journal.label

    // Section header row for journal
    sheet.addRow([`Journal ${journalCode}, ${journalLabel}`])

    for (const entry of journalData.entries) {
      for (const line of entry.lines) {
        sheet.addRow([
          journalCode,
          formatDate(entry.date),
          entry.entryNumber,
          entry.reference ?? '',
          entry.description ?? '',
          line.accountCode,
          line.accountLabel,
          line.description ?? '',
          roundEuros(line.debit),
          roundEuros(line.credit),
        ])
      }
    }

    // Journal subtotal
    sheet.addRow([
      '',
      '',
      '',
      '',
      `Total Journal ${journalCode}`,
      '',
      '',
      '',
      roundEuros(journalData.totals.debit),
      roundEuros(journalData.totals.credit),
    ])
    sheet.addRow([])
  }

  // Grand total
  sheet.addRow([
    '',
    '',
    '',
    '',
    'TOTAL GÉNÉRAL',
    '',
    '',
    '',
    roundEuros(data.grandTotals.debit),
    roundEuros(data.grandTotals.credit),
  ])

  sheet.columns = [
    { width: 10 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 40 },
    { width: 12 },
    { width: 30 },
    { width: 40 },
    { width: 14 },
    { width: 14 },
  ]

  const arrayBuffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer as ArrayBuffer)
}
