/**
 * The VAT return worksheet of a period as a PDF or a CSV file: the same
 * lines, figures, checks and sources as the page. CSV cells go through
 * lib/reports/csv-safe (formula injection, separators), amounts with a
 * decimal comma for French spreadsheets and a byte order mark so Excel
 * reads UTF-8. The file names the company, the form and the period.
 */

import { renderToStream } from '@react-pdf/renderer'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { PDF_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { buildCsv } from '@/lib/reports/csv-safe'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { VatReturnPDF } from '@/lib/pdf/templates/vat-return-pdf'
import { ConflictError } from '@/lib/accounting/errors'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { centsToFecAmount } from '@/lib/utils/money'
import { buildVatReturn, VatReturnQuerySchema, type VatReturnView } from './load-vat-return.service'

export const VatReturnExportQuerySchema = VatReturnQuerySchema.extend({
  format: z.enum(['pdf', 'csv'], { error: "Format d'export inconnu : pdf ou csv" }).default('pdf'),
})
export type VatReturnExportQuery = z.infer<typeof VatReturnExportQuerySchema>

const STATUS = { computed: 'Calculé', manual: 'À remplir', total: 'Total' } as const
const SEVERITY = { blocking: 'À corriger', warning: 'À vérifier', info: 'Information', ok: 'OK' } as const
const books = (cents: number | null) => (cents === null ? '' : centsToFecAmount(cents))

export function vatReturnCsv(view: VatReturnView, companyName: string): string {
  const period = view.period
  const rows: Array<Array<string | number | null>> = [
    ['Société', companyName],
    ['Formulaire', view.formTitle],
    ['Période', period ? `${period.label}, du ${period.start} au ${period.end}` : ''],
    ['Échéance', view.deadline ? `${view.deadline.date}${view.deadline.estimated ? ' (jour indicatif)' : ''}` : ''],
    ['Chiffres fiables', view.reliable ? 'Oui' : 'Non : voir les contrôles'],
    [],
    ['Ligne', 'Case', 'Libellé', 'Base comptable', 'Taxe ou montant comptable', 'Base à déclarer (€)', 'Montant à déclarer (€)', 'Origine', 'Explication'],
    ...(view.computation?.lines ?? []).map((l) => [l.code, l.box, l.label, books(l.baseCents), books(l.amountCents), l.base, l.amount, STATUS[l.status], l.hint]),
  ]
  const acomptes = view.computation?.acomptes
  if (acomptes) {
    rows.push([], ['Acomptes de l’année suivante', 'Base (ligne 57)', acomptes.nextBaseEuros, 'Juillet (55 %)', acomptes.nextJulyEuros, 'Décembre (40 %)', acomptes.nextDecemberEuros, acomptes.nextDue ? 'Dus' : 'Pas d’acompte, base sous 1 000 €'])
  }
  rows.push([], ['Contrôle', 'Résultat', 'Détail'])
  for (const check of view.checks) {
    rows.push([check.title, SEVERITY[check.severity], check.detail])
    for (const item of check.items ?? []) rows.push(['', '', item])
  }
  rows.push([], ['Ce que Kledg ne peut pas savoir'])
  for (const text of view.notFromTheBooks) rows.push([text])
  rows.push([], ['Sources'])
  for (const source of view.sources) rows.push([source.label, source.url])
  return buildCsv(rows)
}

async function renderPdf(document: Parameters<typeof renderToStream>[0]): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of await renderToStream(document)) {
    chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks)
}

export async function exportVatReturn(companyId: string, query: VatReturnExportQuery, now?: Date): Promise<GeneratedFile> {
  const [{ view }, company] = await Promise.all([
    buildVatReturn(companyId, query.period, now),
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
  ])
  if (view.status !== 'ready' || !view.period) throw new ConflictError('Aucune déclaration de TVA à exporter pour cette société.')
  const companyName = company?.name ?? ''
  const base = `TVA_${view.period.form}_${view.period.key}_${fileNamePart(companyName)}`
  if (query.format === 'csv') {
    return { content: `﻿${vatReturnCsv(view, companyName)}`, fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8' }
  }
  const generatedOn = calendarDayOf(todayUtc(now)) as string
  return { content: await renderPdf(<VatReturnPDF view={view} companyName={companyName} generatedOn={generatedOn} />), fileName: `${base}.pdf`, contentType: PDF_CONTENT_TYPE }
}
