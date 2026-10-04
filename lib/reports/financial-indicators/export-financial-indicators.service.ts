/**
 * The financial indicators (SIG, CAF, BFR, ratios) of a fiscal year and of
 * the previous one as a CSV file or an Excel workbook: the same rows and
 * figures as the page (rows.ts), N, N-1 and the variation, with the accounts
 * and form lines each row comes from.
 *
 * CSV cells go through lib/reports/csv-safe (formula injection, separators),
 * amounts with a decimal comma as French spreadsheets expect in a ";"
 * separated file, and a byte order mark so Excel reads UTF-8. The workbook
 * keeps numbers as numbers (ExcelJS stores text as text, never a formula).
 */

import ExcelJS from 'exceljs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { XLSX_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { buildCsv } from '@/lib/reports/csv-safe'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { formatIsoDateFr } from '@/lib/utils/date'
import { centsToFecAmount, fromCents } from '@/lib/utils/money'
import { FinancialIndicatorsQuerySchema, getFinancialIndicators, type FinancialIndicatorsReport } from './get-financial-indicators.service'
import { INDICATOR_SECTIONS, type IndicatorRow } from './rows'

export const FinancialIndicatorsExportQuerySchema = FinancialIndicatorsQuerySchema.extend({
  format: z.enum(['csv', 'xlsx'], { error: "Format d'export inconnu : csv ou xlsx" }).default('xlsx'),
})
export type FinancialIndicatorsExportQuery = z.infer<typeof FinancialIndicatorsExportQuerySchema>

const UNITS: Record<IndicatorRow['kind'], string> = { amount: '€', total: '€', percent: '%', days: 'jours' }
/** The operator in words: a cell starting with + - = would be read as a formula (and neutralised with a quote). */
const OPERATIONS: Record<NonNullable<IndicatorRow['operator']>, string> = { '+': 'Ajouté', '-': 'Retranché', '=': 'Solde' }
const AMOUNT_FORMAT = '#,##0.00 [$€-40C];-#,##0.00 [$€-40C]'

interface Cell {
  current: number | null
  previous: number | null
  variation: number | null
}

/** Raw values of a row: cents, ratios or days. */
function cellOf(row: IndicatorRow, report: FinancialIndicatorsReport): Cell {
  const current = row.value(report.current)
  const previous = report.previous ? row.value(report.previous.indicators) : null
  const variation = current !== null && previous !== null ? (row.kind === 'percent' ? Math.round((current - previous) * 10_000) / 10_000 : current - previous) : null
  return { current, previous, variation }
}

/** A value as CSV text: euros with a decimal comma, a percentage with two decimals, whole days. */
function csvValue(kind: IndicatorRow['kind'], value: number | null): string {
  if (value === null) return ''
  if (kind === 'percent') return centsToFecAmount(Math.round(value * 10_000))
  if (kind === 'days') return String(value)
  return centsToFecAmount(value)
}

/** A value as a spreadsheet number: euros, a fraction (formatted as %) or days. */
function xlsxValue(kind: IndicatorRow['kind'], value: number | null): number | null {
  if (value === null) return null
  return kind === 'amount' || kind === 'total' ? fromCents(value) : value
}

function title(report: FinancialIndicatorsReport, company: string): string {
  const fy = report.fiscalYear
  return `Soldes intermédiaires de gestion et ratios ${company}, exercice ${fy.year} du ${formatIsoDateFr(fy.startDate)} au ${formatIsoDateFr(fy.endDate)}`
}

function headers(report: FinancialIndicatorsReport): string[] {
  return [
    'Rubrique',
    'Libellé',
    'Opération',
    'Unité',
    `Exercice ${report.fiscalYear.year}`,
    report.previous ? `Exercice ${report.previous.fiscalYear.year}` : 'Exercice précédent',
    'Variation',
    'Comptes et lignes des formulaires',
  ]
}

export function financialIndicatorsCsv(report: FinancialIndicatorsReport, company: string): string {
  const rows: Array<Array<string | null>> = [[title(report, company)], [], headers(report)]
  for (const section of INDICATOR_SECTIONS) {
    for (const row of section.rows) {
      const cell = cellOf(row, report)
      rows.push([
        section.title,
        row.label,
        row.operator ? OPERATIONS[row.operator] : '',
        UNITS[row.kind],
        csvValue(row.kind, cell.current),
        csvValue(row.kind, cell.previous),
        csvValue(row.kind, cell.variation),
        row.source,
      ])
    }
  }
  return `﻿${buildCsv(rows)}`
}

export async function financialIndicatorsWorkbook(report: FinancialIndicatorsReport, company: string): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('SIG et ratios')
  sheet.addRow([title(report, company)]).font = { bold: true }
  sheet.addRow([])
  sheet.addRow(headers(report)).font = { bold: true }
  for (const section of INDICATOR_SECTIONS) {
    for (const row of section.rows) {
      const cell = cellOf(row, report)
      const added = sheet.addRow([
        section.title,
        row.label,
        row.operator ? OPERATIONS[row.operator] : '',
        UNITS[row.kind],
        xlsxValue(row.kind, cell.current),
        xlsxValue(row.kind, cell.previous),
        xlsxValue(row.kind, cell.variation),
        row.source,
      ])
      const format = row.kind === 'percent' ? '0.00 %' : row.kind === 'days' ? '0' : AMOUNT_FORMAT
      for (const column of [5, 6, 7]) added.getCell(column).numFmt = format
      if (row.kind === 'total') added.font = { bold: true }
    }
  }
  sheet.columns = [{ width: 34 }, { width: 58 }, { width: 10 }, { width: 8 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 70 }]
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}

/** The export file of the indicators of a fiscal year (the current one by default). */
export async function exportFinancialIndicators(
  companyId: string,
  query: FinancialIndicatorsExportQuery,
  now: Date = new Date(),
): Promise<GeneratedFile> {
  const [report, company] = await Promise.all([
    getFinancialIndicators(companyId, query, now),
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
  ])
  const name = company?.name ?? ''
  const base = `SIG_${fileNamePart(name)}_${report.fiscalYear.year}`
  if (query.format === 'csv') {
    return { content: financialIndicatorsCsv(report, name), fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8' }
  }
  return { content: await financialIndicatorsWorkbook(report, name), fileName: `${base}.xlsx`, contentType: XLSX_CONTENT_TYPE }
}
