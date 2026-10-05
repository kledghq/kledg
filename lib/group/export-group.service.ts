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

import { z } from 'zod'
import { XLSX_CONTENT_TYPE, type GeneratedFile } from '@/lib/api/download'
import type { GroupAccess } from '@/lib/management-fees/access'
import { fileNamePart } from '@/lib/reports/export-reports.service'
import { formatIsoDateFr } from '@/lib/utils/date'
import { percentCell, toCsv, toWorkbook, type ExportDoc, type Row } from './export-doc'
import { companiesDoc, deadlinesDoc, evolutionDoc, indicatorsDoc, ledgerDoc, personsDoc, structureDoc, taxDoc, transactionsDoc, treasuryDoc } from './export-space'
import { getGroupStructure } from './get-group-structure.service'
import { getGroupTax, GroupTaxQuerySchema } from './get-group-tax.service'
import { getGroupCompanies } from './get-group-companies.service'
import { getGroupDeadlines } from './get-group-deadlines.service'
import { getGroupEvolution } from './get-group-evolution.service'
import { getGroupIndicators } from './get-group-indicators.service'
import { getGroupLedger, GroupLedgerQuerySchema } from './get-group-ledger.service'
import { getGroupPersons } from './get-group-persons.service'
import { getGroupTreasury } from './get-group-treasury.service'
import { getGroupView, periodRef, resolveHoldingFiscalYear, type GroupView } from './get-group-view.service'
import { getParticipations, type ParticipationsReport } from './get-participations.service'
import { FIGURE_ROWS, FLOW_CATEGORY_LABELS, INDICATIVE_NOTICE, PARTICIPATION_KIND_LABELS } from './labels'
import { GroupTransactionsQuerySchema, listGroupTransactions, MAX_GROUP_TRANSACTIONS_PAGE, type GroupTransaction } from './list-group-transactions.service'

export const GROUP_REPORTS = ['combined', 'participations', 'companies', 'indicators', 'evolution', 'treasury', 'persons', 'deadlines', 'transactions', 'ledger', 'structure', 'tax'] as const
export type GroupReport = (typeof GROUP_REPORTS)[number]

/** File name of each report, before the holding and the year. */
const FILE_NAMES: Record<GroupReport, string> = {
  combined: 'Vue_groupe',
  participations: 'Participations',
  companies: 'Societes_du_groupe',
  indicators: 'Indicateurs_du_groupe',
  evolution: 'Evolution_du_groupe',
  treasury: 'Tresorerie_du_groupe',
  persons: 'Associes_et_dirigeants',
  deadlines: 'Echeances_du_groupe',
  transactions: 'Transactions_du_groupe',
  ledger: 'Grand_livre_combine',
  structure: 'Structure_du_groupe',
  tax: 'Fiscalite_du_groupe',
}

/** Transactions exported at most (the most recent ones, with a notice). */
export const MAX_EXPORTED_TRANSACTIONS = 5000

export const GroupExportQuerySchema = GroupLedgerQuerySchema.extend(GroupTransactionsQuerySchema.omit({ limit: true, cursor: true }).shape).extend(GroupTaxQuerySchema.omit({ fiscalYearId: true }).shape).extend({
  report: z.enum(GROUP_REPORTS, { error: 'Rapport inconnu' }).default('combined'),
  format: z.enum(['csv', 'xlsx'], { error: "Format d'export inconnu\u00a0: csv ou xlsx" }).default('xlsx'),
})
export type GroupExportQuery = z.infer<typeof GroupExportQuerySchema>

const percent = percentCell

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

/** The transactions of the export: the most recent ones, page after page, up to MAX_EXPORTED_TRANSACTIONS. */
async function exportedTransactions(holdingId: string, query: GroupExportQuery, access: GroupAccess) {
  const items: GroupTransaction[] = []
  let cursor: string | undefined
  let page = await listGroupTransactions(holdingId, { ...query, limit: MAX_GROUP_TRANSACTIONS_PAGE }, access)
  items.push(...page.items)
  while (page.nextCursor && items.length < MAX_EXPORTED_TRANSACTIONS) {
    cursor = page.nextCursor
    page = await listGroupTransactions(holdingId, { ...query, limit: MAX_GROUP_TRANSACTIONS_PAGE, cursor }, access)
    items.push(...page.items)
  }
  return { companies: page.companies, items: items.slice(0, MAX_EXPORTED_TRANSACTIONS), truncated: page.nextCursor !== null || items.length > MAX_EXPORTED_TRANSACTIONS }
}

async function buildDoc(holdingId: string, query: GroupExportQuery, access: GroupAccess): Promise<ExportDoc> {
  switch (query.report) {
    case 'combined':
      return { ...combinedRows(await getGroupView(holdingId, query, access)), notice: INDICATIVE_NOTICE }
    case 'participations':
      return participationRows(await getParticipations(holdingId, query, access))
    case 'companies':
      return companiesDoc(await getGroupCompanies(holdingId, query, access))
    case 'indicators':
      return indicatorsDoc(await getGroupIndicators(holdingId, query, access))
    case 'evolution':
      return evolutionDoc(await getGroupEvolution(holdingId, query, access))
    case 'treasury':
      return treasuryDoc(await getGroupTreasury(holdingId, query, access))
    case 'deadlines':
      return deadlinesDoc(await getGroupDeadlines(holdingId, query, access))
    case 'ledger':
      return ledgerDoc(await getGroupLedger(holdingId, query, access))
    case 'tax':
      return taxDoc(await getGroupTax(holdingId, query, access))
    case 'structure': {
      const fy = periodRef(await resolveHoldingFiscalYear(holdingId, query.fiscalYearId))
      return structureDoc(await getGroupStructure(holdingId, access), fy.year)
    }
    case 'persons': {
      const fy = periodRef(await resolveHoldingFiscalYear(holdingId, query.fiscalYearId))
      return personsDoc(await getGroupPersons(holdingId, access), fy.year)
    }
    case 'transactions': {
      const fy = periodRef(await resolveHoldingFiscalYear(holdingId, query.fiscalYearId))
      const { companies, items, truncated } = await exportedTransactions(holdingId, query, access)
      const holding = companies.find((c) => c.role === 'holding')
      return transactionsDoc({ name: holding?.name ?? '' }, companies, items, truncated, fy.year)
    }
  }
}

export async function exportGroup(holdingId: string, query: GroupExportQuery, access: GroupAccess): Promise<GeneratedFile> {
  const doc = await buildDoc(holdingId, query, access)
  const base = `${FILE_NAMES[query.report]}_${fileNamePart(doc.holdingName)}_${doc.year}`
  if (query.format === 'csv') return { content: toCsv(doc), fileName: `${base}.csv`, contentType: 'text/csv; charset=utf-8' }
  return { content: await toWorkbook(doc), fileName: `${base}.xlsx`, contentType: XLSX_CONTENT_TYPE }
}
