/**
 * The aged balance and the auxiliary balance as Excel workbooks: one sheet
 * per side (Clients, Fournisseurs), the same figures as the screen, amounts
 * in euros, file named after the company and the report day, like the other
 * report exports (lib/reports/export-reports.service.tsx).
 */

import ExcelJS from 'exceljs'
import { prisma } from '@/lib/prisma'
import { XLSX_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { formatIsoDateFr } from '@/lib/utils/date'
import { fromCents } from '@/lib/utils/money'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { describePaymentTerms } from './payment-terms'
import {
  AGE_BUCKET_LABELS,
  AGE_BUCKETS,
  KIND_LABELS,
  type AgedSection,
  type AuxiliarySection,
  type ThirdPartyKind,
} from './third-party-balances'
import {
  getAgedBalance,
  getAuxiliaryBalance,
  type AgedBalanceQuery,
  type AuxiliaryBalanceQuery,
} from './get-third-party-reports.service'

const KINDS: ThirdPartyKind[] = ['customers', 'suppliers']
const AMOUNT_FORMAT = '#,##0.00 [$€-40C];-#,##0.00 [$€-40C]'

async function companyName(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
  return company?.name ?? ''
}

async function toFile(workbook: ExcelJS.Workbook, fileName: string): Promise<GeneratedFile> {
  const buffer = await workbook.xlsx.writeBuffer()
  return { content: new Uint8Array(buffer as ArrayBuffer), fileName, contentType: XLSX_CONTENT_TYPE }
}

function agedSheet(workbook: ExcelJS.Workbook, section: AgedSection, title: string) {
  const sheet = workbook.addWorksheet(KIND_LABELS[section.kind])
  sheet.addRow([title])
  sheet.addRow([])
  sheet.addRow(['Tiers', 'Libellé', 'Comptes', ...AGE_BUCKETS.map((b) => AGE_BUCKET_LABELS[b]), 'Total'])
  for (const tiers of section.tiers) {
    sheet.addRow([tiers.code, tiers.label, tiers.accountCodes.join(', '), ...AGE_BUCKETS.map((b) => fromCents(tiers.buckets[b])), fromCents(tiers.buckets.totalCents)])
  }
  sheet.addRow(['TOTAL', '', '', ...AGE_BUCKETS.map((b) => fromCents(section.totals[b])), fromCents(section.totals.totalCents)])
  sheet.columns = [{ width: 16 }, { width: 34 }, { width: 14 }, ...AGE_BUCKETS.map(() => ({ width: 15, style: { numFmt: AMOUNT_FORMAT } })), { width: 16, style: { numFmt: AMOUNT_FORMAT } }]
  sheet.getRow(3).font = { bold: true }
  sheet.getRow(sheet.rowCount).font = { bold: true }
}

/** The aged balance on its report day, customers and suppliers. */
export async function exportAgedBalanceExcel(companyId: string, query: AgedBalanceQuery, now = new Date()): Promise<GeneratedFile> {
  const [report, name] = await Promise.all([getAgedBalance(companyId, query, now), companyName(companyId)])
  const workbook = new ExcelJS.Workbook()
  const title = `Balance âgée ${name} au ${formatIsoDateFr(report.asOf)}, délai de paiement ${describePaymentTerms(report.terms)}`
  for (const kind of KINDS) agedSheet(workbook, report[kind], title)
  return toFile(workbook, `Balance_agee_${fileNamePart(name)}_${report.asOf}.xlsx`)
}

function auxiliarySheet(workbook: ExcelJS.Workbook, section: AuxiliarySection, title: string) {
  const sheet = workbook.addWorksheet(KIND_LABELS[section.kind])
  sheet.addRow([title])
  sheet.addRow([])
  sheet.addRow(['Tiers', 'Libellé', 'Comptes', 'Solde au début', 'Débit', 'Crédit', 'Solde', 'Non lettré'])
  const amounts = (t: Omit<AuxiliarySection['totals'], never>) =>
    [t.openingCents, t.debitCents, t.creditCents, t.closingCents, t.unletteredCents].map(fromCents)
  for (const tiers of section.tiers) sheet.addRow([tiers.code, tiers.label, tiers.accountCodes.join(', '), ...amounts(tiers)])
  sheet.addRow(['TOTAL', '', '', ...amounts(section.totals)])
  sheet.columns = [{ width: 16 }, { width: 34 }, { width: 14 }, ...Array.from({ length: 5 }, () => ({ width: 16, style: { numFmt: AMOUNT_FORMAT } }))]
  sheet.getRow(3).font = { bold: true }
  sheet.getRow(sheet.rowCount).font = { bold: true }
}

/** The auxiliary balance of a period, customers and suppliers (signed debit - credit). */
export async function exportAuxiliaryBalanceExcel(companyId: string, query: AuxiliaryBalanceQuery, now = new Date()): Promise<GeneratedFile> {
  const [report, name] = await Promise.all([getAuxiliaryBalance(companyId, query, now), companyName(companyId)])
  const workbook = new ExcelJS.Workbook()
  const title = `Balance auxiliaire ${name} du ${formatIsoDateFr(report.period.startDate)} au ${formatIsoDateFr(report.period.endDate)} (soldes débit moins crédit)`
  for (const kind of KINDS) auxiliarySheet(workbook, report[kind], title)
  return toFile(workbook, `Balance_auxiliaire_${fileNamePart(name)}_${report.period.endDate}.xlsx`)
}
