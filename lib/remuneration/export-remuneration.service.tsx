/**
 * The "Rémunération et dividendes" simulation as a PDF or a CSV file: the
 * same inputs, scenarios, rows, notes and sources as the page
 * (lib/remuneration/breakdown.ts). CSV cells go through lib/reports/csv-safe
 * (formula injection, separators), amounts with a decimal comma and a byte
 * order mark so Excel reads UTF-8. An indicative simulation, never advice.
 */

import { renderToStream } from '@react-pdf/renderer'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ConflictError } from '@/lib/accounting/errors'
import { PDF_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import { RemunerationPDF } from '@/lib/pdf/templates/remuneration-pdf'
import { buildCsv } from '@/lib/reports/csv-safe'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { centsToFecAmount } from '@/lib/utils/money'
import { breakdownRows, DISCLAIMER, SCENARIO_ORDER, STATUS_LABELS } from './breakdown'
import { loadRemuneration, RemunerationQuerySchema, type RemunerationView } from './load-remuneration.service'

export const RemunerationExportQuerySchema = RemunerationQuerySchema.extend({
  format: z.enum(['pdf', 'csv'], { error: "Format d'export inconnu : pdf ou csv" }).default('pdf'),
})
export type RemunerationExportQuery = z.infer<typeof RemunerationExportQuerySchema>

const percent = (bp: number) => `${(bp / 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`

export function remunerationCsv(view: RemunerationView, companyName: string): string {
  const sim = view.simulation
  const inputs = view.inputs
  const fy = view.fiscalYear
  const rows: Array<Array<string | number | null>> = [
    ['Société', companyName],
    ['Exercice', fy ? `${fy.year}, du ${fy.startDate} au ${fy.endDate}` : ''],
    ['Scénario enregistré', view.scenario?.name ?? ''],
    ['Avertissement', DISCLAIMER],
  ]
  if (sim && inputs) {
    rows.push(
      [],
      ['Hypothèse', 'Valeur'],
      ['Résultat avant rémunération et impôt', centsToFecAmount(inputs.resultBeforePayCents)],
      ['Statut du dirigeant', STATUS_LABELS[inputs.status]],
      ['Taux réduit de 15 %', inputs.reducedRate ? 'Oui' : 'Non'],
      ['Plafond du taux réduit', centsToFecAmount(inputs.reducedRateCeilingCents)],
      ['Part du capital détenue', percent(inputs.shareBp)],
      ['Part distribuée', percent(inputs.distributionBp)],
      ['Parts du foyer', String(inputs.householdParts).replace('.', ',')],
      ['Autres revenus imposables du foyer', centsToFecAmount(inputs.otherIncomeCents)],
      ['Capital social', centsToFecAmount(inputs.capitalCents)],
      ['Réserve légale', centsToFecAmount(inputs.legalReserveCents)],
      ['Pertes antérieures', centsToFecAmount(inputs.priorLossesCents)],
      [],
      ['Ligne', ...SCENARIO_ORDER.map((id) => sim.scenarios[id].label)],
      ['Part du résultat en rémunération', ...SCENARIO_ORDER.map((id) => percent(sim.scenarios[id].remunerationShareBp))],
      ...breakdownRows(sim).map((r) => [r.label, ...SCENARIO_ORDER.map((id) => centsToFecAmount(r.values[id]))]),
      ['Imposition des dividendes', ...SCENARIO_ORDER.map((id) => (sim.scenarios[id].dividends.receivedCents > 0 ? (sim.scenarios[id].dividends.taxation === 'pfu' ? 'PFU' : 'Barème') : ''))],
    )
    rows.push([], ['À savoir'])
    for (const text of [...view.checks, ...sim.notes]) rows.push([text])
  }
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

export async function exportRemuneration(companyId: string, query: RemunerationExportQuery, options: { now?: Date } = {}): Promise<GeneratedFile> {
  const [view, company] = await Promise.all([loadRemuneration(companyId, query, options), prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })])
  if (view.status !== 'ready' || !view.fiscalYear) throw new ConflictError('Aucune simulation à exporter pour cette société.')
  const companyName = company?.name ?? ''
  const base = `Remuneration_dividendes_${view.fiscalYear.year}_${fileNamePart(companyName)}`
  if (query.format === 'csv') {
    return { content: `﻿${remunerationCsv(view, companyName)}`, fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8' }
  }
  const generatedOn = calendarDayOf(todayUtc(options.now)) as string
  return { content: await renderPdf(<RemunerationPDF view={view} companyName={companyName} generatedOn={generatedOn} />), fileName: `${base}.pdf`, contentType: PDF_CONTENT_TYPE }
}
