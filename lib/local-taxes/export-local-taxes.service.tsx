/**
 * The local taxes of a year as a PDF or a CSV file: the same CFE schedule,
 * CVAE computation, plafonnement estimate, deadlines with their status and
 * sources as the page. CSV cells go through lib/reports/csv-safe (formula
 * injection, separators), amounts with a decimal comma and a byte order
 * mark so Excel reads UTF-8. A worksheet, never an official form.
 */

import { renderToStream } from '@react-pdf/renderer'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { PDF_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { LocalTaxesPDF } from '@/lib/pdf/templates/local-taxes-pdf'
import { buildCsv } from '@/lib/reports/csv-safe'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { centsToFecAmount } from '@/lib/utils/money'
import { loadLocalTaxes, LocalTaxesQuerySchema, type LocalTaxesView } from './load-local-taxes.service'

export const LocalTaxesExportQuerySchema = LocalTaxesQuerySchema.extend({
  format: z.enum(['pdf', 'csv'], { error: 'Format d’export inconnu : pdf ou csv' }).default('pdf'),
})
export type LocalTaxesExportQuery = z.infer<typeof LocalTaxesExportQuerySchema>

const amount = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : centsToFecAmount(cents))

/** French wording of the CVAE status of a year, shared by the page, the exports and the MCP tool. */
export function cvaeStatusText(view: LocalTaxesView): string {
  if (view.cvae.status === 'abolished') return `Supprimée à partir de 2030 : aucune CVAE pour ${view.year}`
  if (view.cvae.status === 'not-covered') return `Année antérieure à 2024, non calculée par Kledg`
  const c = view.cvae.computation
  if (!c) return 'Aucun exercice clos cette année : rien à calculer'
  if (!c.declarationRequired) return 'Chiffre d’affaires jusqu’à 152 500 € : ni déclaration ni CVAE'
  if (!c.taxable) return 'Déclaration 1330-CVAE seulement : pas de CVAE jusqu’à 500 000 € de chiffre d’affaires'
  return c.franchise ? 'CVAE de 63 € ou moins : non due' : `CVAE due au taux de ${c.rateLabel}`
}

function localTaxesCsv(view: LocalTaxesView, companyName: string): string {
  const { cfe, cvae } = view
  const c = cvae.computation
  const rows: Array<Array<string | number | null>> = [
    ['Société', companyName],
    ['Année', view.year],
    [],
    ['CFE', 'Montant'],
    ['Avis d’imposition', amount(cfe.avis?.totalCents)],
    ['Acompte du 15 juin', amount(cfe.schedule.acompteCents)],
    ['Solde du 15 décembre', amount(cfe.schedule.balanceCents)],
    ['Charge prévue au 63511', amount(cfe.expected.cents)],
    [],
    ['CVAE', view.cvae.status === 'in-force' ? `Taux maximal ${view.cvae.maxRate ?? ''}` : '', cvaeStatusText(view)],
  ]
  if (c && cvae.books) {
    rows.push(
      ['Chiffre d’affaires', amount(cvae.books.turnoverCents)],
      ['Chiffre d’affaires sur douze mois', amount(cvae.turnoverAnnualCents)],
      ['Valeur ajoutée des soldes intermédiaires de gestion', amount(cvae.books.sigValueAddedCents)],
      ['Subventions d’exploitation (74)', amount(cvae.books.subsidiesCents)],
      ['Autres produits de gestion courante (75)', amount(cvae.books.otherProductsCents)],
      ['Transferts de charges (791)', amount(cvae.books.chargeTransfersCents)],
      ['Autres charges de gestion courante (65)', amount(-cvae.books.otherChargesCents)],
      ...cvae.adjustments.map((a) => [`Ajustement : ${a.label}`, amount(a.amountCents)]),
      ['Valeur ajoutée retenue', amount(c.valueAdded.cents), c.valueAdded.capped ? 'Plafonnée' : ''],
      ['Taux effectif', c.rateLabel],
      ['CVAE brute', amount(c.grossCents)],
      ['Dégrèvement', amount(c.degrevementCents)],
      ['CVAE', amount(c.cvaeCents)],
      ['Contribution complémentaire', amount(c.complementaryCents)],
      ['Total', amount(c.totalCents)],
    )
  }
  if (view.plafonnement) rows.push(['Plafonnement en fonction de la valeur ajoutée, estimation', amount(view.plafonnement.excessCents)])
  rows.push([], ['Échéance', 'Date', 'Statut', 'Déposée le', 'Payée le', 'Montant'])
  for (const d of view.deadlines) rows.push([d.label, d.date, d.status.label, d.status.filedOn ?? '', d.status.paidOn ?? '', amount(d.status.amountCents)])
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

export async function exportLocalTaxes(companyId: string, query: LocalTaxesExportQuery, options: { now?: Date } = {}): Promise<GeneratedFile> {
  const [view, company] = await Promise.all([loadLocalTaxes(companyId, query, options), prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })])
  const companyName = company?.name ?? ''
  const base = `Impots_locaux_${view.year}_${fileNamePart(companyName)}`
  if (query.format === 'csv') {
    return { content: `﻿${localTaxesCsv(view, companyName)}`, fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8' }
  }
  const generatedOn = calendarDayOf(todayUtc(options.now)) as string
  return {
    content: await renderPdf(<LocalTaxesPDF view={view} companyName={companyName} generatedOn={generatedOn} statusText={cvaeStatusText(view)} />),
    fileName: `${base}.pdf`,
    contentType: PDF_CONTENT_TYPE,
  }
}
