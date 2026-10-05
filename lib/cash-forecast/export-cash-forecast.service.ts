/**
 * The cash forecast as a CSV file: the periods (opening and closing
 * balance, what comes in and goes out, each component counted, the lowest
 * balance and whether it is under the threshold), then every flow counted.
 * The same figures as the page for the same parameters.
 *
 * Cells go through lib/reports/csv-safe (formula injection, separators),
 * amounts with a decimal comma as French spreadsheets expect in a ";"
 * separated file, and a byte order mark so Excel reads UTF-8.
 */

import { prisma } from '@/lib/prisma'
import type { GeneratedFile } from '@/lib/api/download'
import { buildCsv } from '@/lib/reports/csv-safe'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { formatIsoDateFr } from '@/lib/utils/date'
import { centsToFecAmount } from '@/lib/utils/money'
import { COMPONENT_INFO } from './components'
import { getCashForecast, type CashForecastQuery, type CashForecastView } from './load-cash-forecast.service'
import { periodLabel } from './wording'

type Row = Array<string | number | null>

export function cashForecastCsv(view: CashForecastView, company: string): string {
  const { projection } = view
  const amount = (cents: number) => centsToFecAmount(cents)
  const rows: Row[] = [
    [`Prévision de trésorerie ${company} du ${formatIsoDateFr(projection.start)} au ${formatIsoDateFr(projection.end)}, établie le ${formatIsoDateFr(view.today)}`],
    ['Projection à partir des données connues, sans garantie : les montants réels peuvent différer.'],
    [`Solde de départ : ${amount(projection.openingCents)} (${view.opening.source === 'bank' ? 'soldes déclarés par les banques' : view.opening.source === 'ledger' ? 'comptes 512' : 'aucun solde connu'})`],
    [`Seuil d’alerte : ${projection.thresholdCents === null ? 'aucun' : amount(projection.thresholdCents)}`],
    [],
    [
      'Période',
      'Du',
      'Au',
      'Solde de début',
      'Encaissements',
      'Décaissements',
      ...projection.components.map((c) => COMPONENT_INFO[c].label),
      'Solde de fin',
      'Solde le plus bas',
      'Jour du solde le plus bas',
      'Sous le seuil',
    ],
    ...projection.periods.map((p): Row => [
      periodLabel(p, projection.granularity),
      formatIsoDateFr(p.start),
      formatIsoDateFr(p.end),
      amount(p.openingCents),
      amount(p.inflowsCents),
      amount(p.outflowsCents),
      ...projection.components.map((c) => amount(p.byComponent[c] ?? 0)),
      amount(p.closingCents),
      amount(p.lowestCents),
      formatIsoDateFr(p.lowestDay),
      p.belowThreshold ? 'Oui' : 'Non',
    ]),
    [],
    ['Date', 'Composante', 'Libellé', 'Montant', 'En retard'],
    ...view.items
      .filter((item) => projection.components.includes(item.component))
      .map((item): Row => [
        formatIsoDateFr(item.day),
        COMPONENT_INFO[item.component].label,
        item.label,
        amount(item.amountCents),
        item.overdue ? 'Oui' : 'Non',
      ]),
  ]
  if (view.unknownTaxes.length > 0) {
    rows.push([], ['Échéances fiscales sans montant connu (non comptées)'])
    for (const tax of view.unknownTaxes) rows.push([formatIsoDateFr(tax.day), tax.label])
  }
  return `﻿${buildCsv(rows)}`
}

/** GET /api/cash-forecast/export: the CSV of the forecast for the parameters given (the saved ones by default). */
export async function exportCashForecast(companyId: string, query: CashForecastQuery, now?: Date): Promise<GeneratedFile> {
  const [view, company] = await Promise.all([
    getCashForecast(companyId, query, now),
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
  ])
  const name = company?.name ?? ''
  return {
    content: cashForecastCsv(view, name),
    fileName: `Prevision_tresorerie_${fileNamePart(name)}_${view.today}.csv`,
    contentType: 'text/csv; charset=utf-8',
  }
}
