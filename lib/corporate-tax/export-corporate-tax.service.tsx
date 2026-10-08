/**
 * The impôt sur les sociétés worksheet of a fiscal year as a PDF or a CSV
 * file: the same lines, figures, acomptes, checks and sources as the page.
 * CSV cells go through lib/reports/csv-safe (formula injection,
 * separators), amounts with a decimal comma and a byte order mark so Excel
 * reads UTF-8. A worksheet, never the official form.
 */

import { renderToStream } from '@react-pdf/renderer'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError } from '@/lib/accounting/errors'
import { PDF_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import type { GroupAccess } from '@/lib/management-fees/access'
import { CorporateTaxPDF } from '@/lib/pdf/templates/corporate-tax-pdf'
import { buildCsv } from '@/lib/reports/csv-safe'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { centsToFecAmount } from '@/lib/utils/money'
import { buildCorporateTax, CorporateTaxQuerySchema, type CorporateTaxView } from './load-corporate-tax.service'

export const CorporateTaxExportQuerySchema = CorporateTaxQuerySchema.extend({
  format: z.enum(['pdf', 'csv'], { error: "Format d'export inconnu : pdf ou csv" }).default('pdf'),
})
export type CorporateTaxExportQuery = z.infer<typeof CorporateTaxExportQuerySchema>

const ORIGIN = { books: 'Comptes', group: 'Filiales', manual: 'Saisi', total: 'Total' } as const
const SEVERITY = { blocking: 'À corriger', warning: 'À vérifier', info: 'Information', ok: 'OK' } as const
const amount = (cents: number | null) => (cents === null ? '' : centsToFecAmount(cents))

function corporateTaxCsv(view: CorporateTaxView, companyName: string): string {
  const c = view.computation
  const fy = view.fiscalYear
  const rows: Array<Array<string | number | null>> = [
    ['Société', companyName],
    ['Exercice', fy ? `${fy.year}, du ${fy.startDate} au ${fy.endDate}` : ''],
    ['Formulaires', view.formTitle],
    ['Chiffres fiables', view.reliable ? 'Oui' : 'Non : voir les contrôles'],
    [],
    ['Ligne', 'Libellé', 'Origine', 'Montant comptable', 'Montant à déclarer (€)', 'Explication'],
    ...(c?.lines ?? []).map((l) => [l.formLine, l.label, ORIGIN[l.origin], amount(l.amountCents), l.euros, l.hint]),
  ]
  if (c) {
    rows.push(
      [],
      ['Impôt sur les sociétés', 'Base', 'Impôt'],
      ['Taux réduit de 15 %', amount(c.reducedRate.baseCents), amount(c.reducedRate.taxCents)],
      ['Taux normal de 25 %', amount(c.normalRate.baseCents), amount(c.normalRate.taxCents)],
      ['Impôt sur les sociétés', '', amount(c.corporateTaxCents)],
      ['Contribution sociale de 3,3 %', amount(c.socialContribution.baseCents), amount(c.socialContribution.cents)],
      ['Crédits d’impôt', '', amount(c.creditsCents)],
      ['Total de l’exercice', '', amount(c.totalCents)],
    )
  }
  if (view.balance) {
    rows.push([], ['Relevé de solde (2572-SD)', 'Échéance', view.balance.deadline?.date ?? '', 'Acomptes versés', amount(view.balance.paidCents), 'Solde', amount(view.balance.balanceCents)])
  }
  if (view.acomptes) {
    rows.push([], [`Acomptes de l’exercice ${view.acomptes.exercice.year} (2571-SD)`, 'Échéance', 'Montant', 'Explication'])
    for (const item of view.acomptes.items) rows.push([`Acompte n° ${item.number}`, item.date, amount(item.amountCents), item.note])
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

export async function exportCorporateTax(companyId: string, query: CorporateTaxExportQuery, options: { now?: Date; access?: GroupAccess | null } = {}): Promise<GeneratedFile> {
  const [{ view }, company] = await Promise.all([
    buildCorporateTax(companyId, query, options),
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
  ])
  if (view.status !== 'ready' || !view.fiscalYear) throw new ConflictError('Aucun impôt sur les sociétés à exporter pour cette société.')
  const companyName = company?.name ?? ''
  const base = `IS_${view.fiscalYear.year}_${fileNamePart(companyName)}`
  if (query.format === 'csv') {
    return { content: `﻿${corporateTaxCsv(view, companyName)}`, fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8' }
  }
  const generatedOn = calendarDayOf(todayUtc(options.now)) as string
  return { content: await renderPdf(<CorporateTaxPDF view={view} companyName={companyName} generatedOn={generatedOn} />), fileName: `${base}.pdf`, contentType: PDF_CONTENT_TYPE }
}
