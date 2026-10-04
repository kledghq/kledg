/**
 * Exports of the group view: the combined view (figures per company, total,
 * eliminations, after eliminations, intragroup flows, treasury by month) or
 * the participations table, as a CSV file or an Excel workbook. Same figures
 * as the page and the MCP tools (one service each).
 *
 * CSV cells go through lib/reports/csv-safe (formula injection, separators),
 * amounts with a decimal comma, a byte order mark so Excel reads UTF-8. The
 * workbook keeps numbers as numbers (ExcelJS writes text as text, never a
 * formula).
 */

import ExcelJS from 'exceljs'
import { z } from 'zod'
import { XLSX_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import type { GroupAccess } from '@/lib/management-fees/access'
import { buildCsv } from '@/lib/reports/csv-safe'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { formatIsoDateFr } from '@/lib/utils/date'
import { centsToFecAmount, fromCents } from '@/lib/utils/money'
import { getGroupView, GroupViewQuerySchema, type GroupView } from './get-group-view.service'
import { getParticipations, type ParticipationsReport } from './get-participations.service'
import { FIGURE_ROWS, FLOW_CATEGORY_LABELS, INDICATIVE_NOTICE, PARTICIPATION_KIND_LABELS } from './labels'

export const GroupExportQuerySchema = GroupViewQuerySchema.extend({
  report: z.enum(['combined', 'participations'], { error: 'Rapport inconnu\u00a0: combined ou participations' }).default('combined'),
  format: z.enum(['csv', 'xlsx'], { error: "Format d'export inconnu\u00a0: csv ou xlsx" }).default('xlsx'),
})
export type GroupExportQuery = z.infer<typeof GroupExportQuerySchema>

const AMOUNT_FORMAT = '#,##0.00 [$€-40C];-#,##0.00 [$€-40C]'
const percent = (bp: number | null) => (bp === null ? '' : `${centsToFecAmount(bp)} %`)

type Cell = string | number | null
type Row = Cell[]

/** Rows of the combined view, cents kept as numbers (formatted per output). */
interface Section {
  name: string
  header: string[]
  rows: Row[]
  /** 1-based columns holding cents. */
  amountColumns: number[]
}

interface ExportDoc {
  title: string
  holdingName: string
  year: number
  sections: Section[]
}

function combinedRows(view: GroupView): ExportDoc {
  const names = new Map(view.members.map((m) => [m.id, m.name]))
  const nameOf = (id: string) => names.get(id) ?? 'Société du groupe'
  const figures = {
    name: 'Vue combinée',
    header: ['Indicateur', ...view.members.map((m) => m.name), 'Total agrégé', 'Éliminations', 'Après éliminations'],
    rows: FIGURE_ROWS.map(({ key, label }) => [
      label,
      ...view.members.map((m) => (m.figures ? m.figures[key] : null)),
      view.combined[key],
      view.eliminations.effect[key],
      view.afterEliminations[key],
    ]),
    amountColumns: Array.from({ length: view.members.length + 3 }, (_, i) => i + 2),
  }
  const members = {
    name: 'Sociétés',
    header: ['Société', 'SIREN', 'Rôle', 'Détention par la holding', 'Exercice lu'],
    rows: [
      ...view.members.map((m) => [
        m.name,
        m.siren,
        m.role === 'holding' ? 'Holding' : 'Filiale',
        percent(m.ownershipBp),
        m.fiscalYear ? `Du ${formatIsoDateFr(m.fiscalYear.startDate)} au ${formatIsoDateFr(m.fiscalYear.endDate)}` : 'Aucun exercice sur la période',
      ]),
      ...view.unreachable.map((u) => [u.name ?? 'Filiale non accessible', null, 'Filiale', null, 'Non lue, faute d’accès']),
    ],
    amountColumns: [],
  }
  const flows = {
    name: 'Flux intragroupe',
    header: ['Société', 'Avec', 'Nature', 'Compte', 'Référence', 'Montant', 'Éliminé'],
    rows: view.flows.map((f) => [
      nameOf(f.companyId),
      nameOf(f.counterpartyId),
      FLOW_CATEGORY_LABELS[f.category],
      f.accountCode,
      f.reference,
      f.cents,
      f.inBooks ? 'Oui' : 'Non, pas encore comptabilisé',
    ]),
    amountColumns: [6],
  }
  const treasury = {
    name: 'Trésorerie',
    header: ['Mois', ...view.members.filter((m) => m.figures).map((m) => m.name), 'Groupe'],
    rows: view.treasury.map((t) => [t.month, ...view.members.filter((m) => m.figures).map((m) => t.byCompany[m.id] ?? 0), t.totalCents]),
    amountColumns: Array.from({ length: view.members.filter((m) => m.figures).length + 1 }, (_, i) => i + 2),
  }
  const fy = view.fiscalYear
  return {
    holdingName: view.holding.name,
    year: fy.year,
    title: `Vue groupe ${view.holding.name}, exercice ${fy.year} du ${formatIsoDateFr(fy.startDate)} au ${formatIsoDateFr(fy.endDate)}`,
    sections: [figures, members, flows, treasury],
  }
}

function participationRows(report: ParticipationsReport): ExportDoc {
  const fy = report.fiscalYear
  const header = [
    'Société',
    'SIREN',
    'Catégorie',
    'Détention',
    'Nombre de titres',
    'Valeur brute des titres',
    'Dépréciation',
    'Valeur nette des titres',
    'Capital',
    'Capitaux propres',
    'Quote-part des capitaux propres',
    "Chiffre d'affaires",
    'Résultat',
    'Prêts et avances consentis',
    'Dividendes encaissés',
  ]
  const rows: Row[] = report.rows.map((r) => [
    r.name,
    r.siren,
    PARTICIPATION_KIND_LABELS[r.kind],
    percent(r.ownershipBp),
    r.numberOfShares,
    r.bookValueGrossCents,
    r.depreciationCents,
    r.bookValueNetCents,
    r.capitalCents,
    r.capitauxPropresCents,
    r.quotePartCents,
    r.chiffreAffairesCents,
    r.resultatCents,
    r.loansCents,
    r.dividendsCents,
  ])
  for (const u of report.unattributed) rows.push([`${u.accountCode} ${u.label}`, null, 'Titres non rattachés', null, null, u.cents, null, null, null, null, null, null, null, null, null])
  for (const u of report.unreachable) rows.push([u.name ?? 'Filiale non accessible', null, 'Non lue, faute d’accès', null, null, null, null, null, null, null, null, null, null, null, null])
  return {
    holdingName: report.holding.name,
    year: fy.year,
    title: `Filiales et participations de ${report.holding.name}, exercice ${fy.year} du ${formatIsoDateFr(fy.startDate)} au ${formatIsoDateFr(fy.endDate)}`,
    sections: [{ name: 'Participations', header, rows, amountColumns: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }],
  }
}

function toCsv(doc: ExportDoc, notice: string | null): string {
  const out: Array<Array<string | number | null>> = [[doc.title]]
  if (notice) out.push([notice])
  for (const section of doc.sections) {
    out.push([], [section.name], section.header)
    for (const row of section.rows) {
      out.push(row.map((cell, i) => (section.amountColumns.includes(i + 1) && typeof cell === 'number' ? centsToFecAmount(cell) : cell)))
    }
  }
  return `﻿${buildCsv(out)}`
}

async function toWorkbook(doc: ExportDoc, notice: string | null): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  for (const section of doc.sections) {
    const sheet = workbook.addWorksheet(section.name)
    sheet.addRow([doc.title]).font = { bold: true }
    if (notice) sheet.addRow([notice])
    sheet.addRow([])
    sheet.addRow(section.header).font = { bold: true }
    for (const row of section.rows) {
      const added = sheet.addRow(row.map((cell, i) => (section.amountColumns.includes(i + 1) && typeof cell === 'number' ? fromCents(cell) : cell)))
      for (const column of section.amountColumns) added.getCell(column).numFmt = AMOUNT_FORMAT
    }
    sheet.columns = section.header.map((_, i) => ({ width: i === 0 ? 36 : 20 }))
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}

export async function exportGroup(holdingId: string, query: GroupExportQuery, access: GroupAccess): Promise<GeneratedFile> {
  const combined = query.report === 'combined'
  const doc = combined ? combinedRows(await getGroupView(holdingId, query, access)) : participationRows(await getParticipations(holdingId, query, access))
  const notice = combined ? INDICATIVE_NOTICE : null
  const base = `${combined ? 'Vue_groupe' : 'Participations'}_${fileNamePart(doc.holdingName)}_${doc.year}`
  if (query.format === 'csv') return { content: toCsv(doc, notice), fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8' }
  return { content: await toWorkbook(doc, notice), fileName: `${base}.xlsx`, contentType: XLSX_CONTENT_TYPE }
}
