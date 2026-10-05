/**
 * The tables of the group space as export documents (export-doc.ts): one
 * builder per page, from the same report the page and the MCP tools read.
 * Pure: the service loads, these lay out.
 */

import { DEADLINE_CATEGORY_LABELS } from '@/lib/deadlines/types'
import { INDICATOR_SECTIONS } from '@/lib/reports/financial-indicators/rows'
import type { FinancialIndicators } from '@/lib/reports/financial-indicators/indicators'
import { formatIsoDateFr } from '@/lib/utils/date'
import { DEADLINE_COLUMNS, DEADLINE_COLUMN_LABELS } from './deadline-summary'
import type { ExportDoc, Row, Section } from './export-doc'
import { percentCell } from './export-doc'
import type { GroupCompaniesReport } from './get-group-companies.service'
import type { GroupDeadlinesReport } from './get-group-deadlines.service'
import type { GroupEvolutionReport } from './get-group-evolution.service'
import type { GroupIndicatorsReport } from './get-group-indicators.service'
import type { GroupLedgerReport } from './get-group-ledger.service'
import type { GroupPersonsReport } from './get-group-persons.service'
import type { GroupTreasuryReport } from './get-group-treasury.service'
import type { PeriodRef } from './get-group-view.service'
import { FLOW_CATEGORY_LABELS, FIGURE_ROWS } from './labels'
import type { GroupTransaction } from './list-group-transactions.service'
import type { GroupCompanyLink } from './members'

const period = (fy: PeriodRef) => `exercice ${fy.year} du ${formatIsoDateFr(fy.startDate)} au ${formatIsoDateFr(fy.endDate)}`
const roleOf = (c: GroupCompanyLink) => (c.role === 'holding' ? 'Holding' : 'Filiale')
const NOT_READ = 'Filiale non accessible'

function notReadRows(unreachable: ReadonlyArray<{ name: string | null }>, width: number): Row[] {
  return unreachable.map((u) => [u.name ?? NOT_READ, 'Non lue, faute d’accès', ...Array<null>(Math.max(0, width - 2)).fill(null)])
}

export function companiesDoc(report: GroupCompaniesReport): ExportDoc {
  const header = ['Société', 'Rôle', 'SIREN', 'Forme juridique', 'Détention par la holding', 'Dirigeants', 'Exercice lu', ...FIGURE_ROWS.map((r) => r.label)]
  const rows: Row[] = report.companies.map((c) => [
    c.company.name,
    roleOf(c.company),
    c.siren,
    c.legalForm ?? c.legalType,
    percentCell(c.company.ownershipBp),
    c.officers.map((o) => (o.title ? `${o.name} (${o.title})` : o.name)).join(', '),
    c.fiscalYear ? `Du ${formatIsoDateFr(c.fiscalYear.startDate)} au ${formatIsoDateFr(c.fiscalYear.endDate)}` : 'Aucun exercice sur la période',
    ...FIGURE_ROWS.map((r) => (c.figures ? { cents: c.figures[r.key] } : null)),
  ])
  rows.push(...notReadRows(report.unreachable, header.length))
  return { title: `Sociétés du groupe ${report.holding.name}, ${period(report.fiscalYear)}`, holdingName: report.holding.name, year: report.fiscalYear.year, sections: [{ name: 'Sociétés', header, rows, amountColumns: [] }] }
}

/** An indicator value as a cell: amounts in cents, ratios in percent, delays in days. */
export function indicatorCell(kind: 'amount' | 'total' | 'percent' | 'days', value: number | null): Row[number] {
  if (value === null) return null
  if (kind === 'percent') return `${(Math.round(value * 1000) / 10).toFixed(1).replace('.', ',')} %`
  if (kind === 'days') return `${value} j`
  return { cents: value }
}

export function indicatorsDoc(report: GroupIndicatorsReport): ExportDoc {
  const columns: Array<{ label: string; value: FinancialIndicators | null }> = []
  for (const m of report.members) {
    columns.push({ label: `${m.company.name} N`, value: m.current }, { label: `${m.company.name} N-1`, value: m.previous })
  }
  columns.push({ label: 'Agrégat du groupe N', value: report.combined.current }, { label: 'Agrégat du groupe N-1', value: report.combined.previous })
  const sections: Section[] = INDICATOR_SECTIONS.map((section) => ({
    name: section.title,
    header: ['Indicateur', 'Comptes et lignes', ...columns.map((c) => c.label)],
    rows: section.rows.map((row) => [row.label, row.source, ...columns.map((c) => (c.value ? indicatorCell(row.kind, row.value(c.value)) : null))]),
    amountColumns: [],
  }))
  return {
    title: `Indicateurs du groupe ${report.holding.name}, ${period(report.fiscalYear)}`,
    notice: report.notice,
    holdingName: report.holding.name,
    year: report.fiscalYear.year,
    sections,
  }
}

export function evolutionDoc(report: GroupEvolutionReport): ExportDoc {
  const metrics = [
    { key: 'produitsCents', label: 'Produits' },
    { key: 'chargesCents', label: 'Charges' },
    { key: 'resultatCents', label: 'Résultat' },
    { key: 'tresorerieCents', label: 'Trésorerie' },
  ] as const
  const sections: Section[] = metrics.map((metric) => ({
    name: metric.label,
    header: ['Mois', ...report.companies.map((c) => c.name), 'Groupe'],
    rows: report.months.map((m) => [m.month, ...report.companies.map((c) => m.byCompany[c.id]?.[metric.key] ?? null), m.total[metric.key]]),
    amountColumns: Array.from({ length: report.companies.length + 1 }, (_, i) => i + 2),
  }))
  return { title: `Évolution du groupe ${report.holding.name}, ${period(report.fiscalYear)}`, holdingName: report.holding.name, year: report.fiscalYear.year, sections }
}

export function treasuryDoc(report: GroupTreasuryReport): ExportDoc {
  const names = new Map(report.companies.map((c) => [c.company.id, c.company.name]))
  const nameOf = (id: string) => names.get(id) ?? 'Société du groupe'
  const accounts: Section = {
    name: 'Comptes bancaires',
    header: ['Société', 'Compte', 'IBAN', 'Banque', 'Devise', 'Solde', 'Dernière synchronisation'],
    rows: report.companies.flatMap((c) => c.accounts.map((a) => [c.company.name, a.name, a.maskedIban, a.provider, a.currency, a.balanceCents, a.lastSyncedAt])),
    amountColumns: [6],
  }
  const withCash = report.companies.filter((c) => c.ledgerCents !== null)
  const months: Section = {
    name: 'Trésorerie par mois',
    header: ['Mois', ...withCash.map((c) => c.company.name), 'Groupe'],
    rows: report.months.map((m) => [m.month, ...withCash.map((c) => m.byCompany[c.company.id] ?? 0), m.totalCents]),
    amountColumns: Array.from({ length: withCash.length + 1 }, (_, i) => i + 2),
  }
  const current: Section = {
    name: 'Comptes courants',
    header: ['Créancier', 'Débiteur', 'Nature', 'Créance', 'Dette', 'Écart'],
    rows: report.currentAccounts.map((b) => [nameOf(b.creditorId), nameOf(b.debtorId), b.categories.map((c) => FLOW_CATEGORY_LABELS[c]).join(', '), b.receivableCents, b.payableCents, b.gapCents]),
    amountColumns: [4, 5, 6],
  }
  return { title: `Trésorerie du groupe ${report.holding.name}, ${period(report.fiscalYear)}`, holdingName: report.holding.name, year: report.fiscalYear.year, sections: [accounts, months, current] }
}

export function personsDoc(report: GroupPersonsReport, year: number): ExportDoc {
  const kind = { person: 'Personne physique', company: 'Société', other: 'Personne morale', officer: 'Dirigeant non associé' } as const
  const header = ['Associé ou dirigeant', 'Nature', 'Fonctions', ...report.companies.flatMap((c) => [`${c.name} direct`, `${c.name} indirect`, `${c.name} total`])]
  const names = new Map(report.companies.map((c) => [c.id, c.name]))
  const rows: Row[] = report.holders.map((h) => [
    h.name ?? NOT_READ,
    kind[h.kind],
    h.titles.map((t) => `${t.title ?? 'Dirigeant'} de ${names.get(t.companyId) ?? 'société du groupe'}`).join(', '),
    ...report.companies.flatMap((c) => {
      const i = h.interests.find((x) => x.companyId === c.id)
      return i ? [percentCell(i.directBp), percentCell(i.indirectBp), percentCell(i.totalBp)] : [null, null, null]
    }),
  ])
  return {
    title: `Associés et dirigeants du groupe ${report.holding.name}`,
    holdingName: report.holding.name,
    year,
    sections: [{ name: 'Associés et dirigeants', header, rows, amountColumns: [] }],
  }
}

export function deadlinesDoc(report: GroupDeadlinesReport): ExportDoc {
  const names = new Map(report.companies.map((c) => [c.company.id, c.company.name]))
  const summary: Section = {
    name: 'Synthèse',
    header: ['Société', ...DEADLINE_COLUMNS.map((c) => DEADLINE_COLUMN_LABELS[c])],
    rows: report.companies.map((c) => [
      c.company.name,
      ...DEADLINE_COLUMNS.map((col) => {
        const s = c.summary[col]
        return s.total === 0 ? '' : `${s.settled}/${s.total} réglées${s.overdue ? `, ${s.overdue} en retard` : ''}`
      }),
    ]),
    amountColumns: [],
  }
  const list: Section = {
    name: 'Échéances',
    header: ['Date', 'Société', 'Catégorie', 'Formulaire', 'Échéance', 'Statut', 'Montant'],
    rows: report.deadlines.map((d) => [d.date, names.get(d.companyId) ?? '', DEADLINE_CATEGORY_LABELS[d.category], d.form, d.label, d.statusLabel, d.amountCents === null ? null : { cents: d.amountCents }]),
    amountColumns: [],
  }
  return { title: `Impôts et échéances du groupe ${report.holding.name}, ${period(report.fiscalYear)}`, holdingName: report.holding.name, year: report.fiscalYear.year, sections: [summary, list] }
}

export function transactionsDoc(holding: { name: string }, companies: GroupCompanyLink[], items: readonly GroupTransaction[], truncated: boolean, year: number): ExportDoc {
  const names = new Map(companies.map((c) => [c.id, c.name]))
  return {
    title: `Transactions bancaires du groupe ${holding.name}`,
    notice: truncated ? `Les ${items.length} transactions les plus récentes : affinez les filtres pour exporter les autres.` : null,
    holdingName: holding.name,
    year,
    sections: [
      {
        name: 'Transactions',
        header: ['Date', 'Société', 'Compte', 'Libellé', 'Contrepartie', 'Référence', 'Montant', 'Rapprochée'],
        rows: items.map((t) => [t.date, names.get(t.companyId) ?? '', t.bankAccountName, t.label, t.counterpartyName, t.reference, t.side === 'debit' ? -t.amountCents : t.amountCents, t.reconciled ? 'Oui' : 'Non']),
        amountColumns: [7],
      },
    ],
  }
}

export function ledgerDoc(report: GroupLedgerReport): ExportDoc {
  const names = new Map(report.companies.map((c) => [c.id, c.name]))
  const accounts: Section = {
    name: 'Grand livre combiné',
    header: ['Compte', 'Libellé', ...report.companies.map((c) => `${c.name} solde`), 'Débit total', 'Crédit total', 'Solde total'],
    rows: report.accounts.map((a) => [a.code, a.label, ...report.companies.map((c) => a.byCompany[c.id]?.balanceCents ?? null), a.total.debitCents, a.total.creditCents, a.total.balanceCents]),
    amountColumns: Array.from({ length: report.companies.length + 3 }, (_, i) => i + 3),
  }
  const sections = [accounts]
  if (report.detail) {
    sections.push({
      name: `Compte ${report.detail.code}`,
      header: ['Date', 'Société', 'Journal', 'Écriture', 'Libellé', 'Débit', 'Crédit'],
      rows: report.detail.lines.map((l) => [l.date, names.get(l.companyId) ?? '', l.journal, l.entryNumber, l.label, l.debitCents, l.creditCents]),
      amountColumns: [6, 7],
    })
  }
  return { title: `Grand livre combiné du groupe ${report.holding.name}, ${period(report.fiscalYear)}`, notice: report.notice, holdingName: report.holding.name, year: report.fiscalYear.year, sections }
}
