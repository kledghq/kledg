/**
 * Report exports as files: the journal, the balance sheet and the income
 * statement as Excel workbooks, the balance sheet and the income statement
 * as PDF. Each export checks that the fiscal years belong to the company
 * (404 otherwise), builds the same report as the screen and names the file
 * after the company and the day of the export (UTC calendar day).
 */

import { renderToStream } from '@react-pdf/renderer'
import { prisma } from '@/lib/prisma'
import { PDF_CONTENT_TYPE, XLSX_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { toIsoDateUtc } from '@/lib/utils/date'
import { generateBalanceSheetPDFData } from '@/lib/pdf/generate-balance-sheet-pdf-data.service'
import { generateIncomeStatementPDFData } from '@/lib/pdf/generate-income-statement-pdf-data.service'
import { BalanceSheetPDF } from '@/lib/pdf/templates/balance-sheet-pdf'
import { IncomeStatementPDF } from '@/lib/pdf/templates/income-statement-pdf'
import { generateBalanceSheet } from './balance-sheet/generate-balance-sheet.service'
import { generateBalanceSheetComparison } from './balance-sheet/generate-comparison.service'
import { generateBalanceSheetExcel } from './balance-sheet/generate-excel-export.service'
import { generateIncomeStatement } from './income-statement/generate-income-statement.service'
import { generateIncomeStatementExcel } from './income-statement/generate-excel-export.service'
import { getJournalReport } from './journal/get-journal-report.service'
import { generateJournalExcel } from './journal/generate-excel-export.service'
import { assertFiscalYearsOwned, type ReportVariant } from './report-query'

/** The company name as a file name part (letters and digits, the rest as _). */
export function fileNamePart(name: string | null | undefined): string {
  return name?.replace(/[^a-zA-Z0-9]/g, '_') || 'export'
}

async function companyNamePart(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
  return fileNamePart(company?.name)
}

const xlsx = (content: Uint8Array, fileName: string): GeneratedFile => ({ content, fileName, contentType: XLSX_CONTENT_TYPE })

/** The journal report (validated entries per journal) as an Excel workbook. */
export async function exportJournalExcel(
  companyId: string,
  query: { journalId?: string; startDate?: Date; endDate?: Date },
  now = new Date(),
): Promise<GeneratedFile> {
  // The report filters entries by company: a journal of another company matches nothing.
  const data = await getJournalReport({ companyId, ...query })
  const buffer = await generateJournalExcel(data)
  return xlsx(buffer, `Journal_${await companyNamePart(companyId)}_${toIsoDateUtc(now)}.xlsx`)
}

/** The balance sheet as an Excel workbook, with the N-1 comparison when a previous fiscal year is given. */
export async function exportBalanceSheetExcel(
  companyId: string,
  query: { fiscalYearId: string; previousFiscalYearId?: string; variant: ReportVariant },
  now = new Date(),
): Promise<GeneratedFile> {
  await assertFiscalYearsOwned(companyId, query.fiscalYearId, query.previousFiscalYearId)
  const balanceSheet = await generateBalanceSheet(companyId, query.fiscalYearId, query.variant)
  const comparison = query.previousFiscalYearId
    ? await generateBalanceSheetComparison(companyId, query.fiscalYearId, query.previousFiscalYearId, query.variant)
    : undefined
  const buffer = await generateBalanceSheetExcel(balanceSheet, comparison)
  return xlsx(buffer, `Bilan_${await companyNamePart(companyId)}_${toIsoDateUtc(now)}.xlsx`)
}

/** The income statement as an Excel workbook. */
export async function exportIncomeStatementExcel(
  companyId: string,
  query: { fiscalYearId: string; variant: ReportVariant },
  now = new Date(),
): Promise<GeneratedFile> {
  await assertFiscalYearsOwned(companyId, query.fiscalYearId)
  const incomeStatement = await generateIncomeStatement(companyId, query.fiscalYearId, query.variant)
  const buffer = await generateIncomeStatementExcel(incomeStatement)
  return xlsx(buffer, `Compte_de_resultat_${await companyNamePart(companyId)}_${toIsoDateUtc(now)}.xlsx`)
}

/** Renders a react-pdf document to a buffer. */
async function renderPdf(document: Parameters<typeof renderToStream>[0]): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of await renderToStream(document)) {
    chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks)
}

/** The balance sheet as a PDF. */
export async function exportBalanceSheetPdf(
  companyId: string,
  query: { fiscalYearId: string; variant: ReportVariant },
  now = new Date(),
): Promise<GeneratedFile> {
  await assertFiscalYearsOwned(companyId, query.fiscalYearId)
  const data = await generateBalanceSheetPDFData(companyId, query.fiscalYearId, query.variant)
  return {
    content: await renderPdf(<BalanceSheetPDF {...data} />),
    fileName: `Bilan_${fileNamePart(data.company.name)}_${data.fiscalYear.year}_${toIsoDateUtc(now)}.pdf`,
    contentType: PDF_CONTENT_TYPE,
  }
}

/** The income statement as a PDF. */
export async function exportIncomeStatementPdf(
  companyId: string,
  query: { fiscalYearId: string; variant: ReportVariant },
  now = new Date(),
): Promise<GeneratedFile> {
  await assertFiscalYearsOwned(companyId, query.fiscalYearId)
  const data = await generateIncomeStatementPDFData(companyId, query.fiscalYearId, query.variant)
  return {
    content: await renderPdf(<IncomeStatementPDF {...data} />),
    fileName: `Compte_de_resultat_${fileNamePart(data.company.name)}_${data.fiscalYear.year}_${toIsoDateUtc(now)}.pdf`,
    contentType: PDF_CONTENT_TYPE,
  }
}
