/**
 * The tables of the group space as export documents (export-doc.ts): one
 * builder per page, from the same report the page and the MCP tools read.
 * Pure: the service loads, these lay out.
 */

import { DEADLINE_CATEGORY_LABELS } from '@/lib/deadlines/types'
import { INDICATOR_SECTIONS } from '@/lib/reports/financial-indicators/rows'
import type { FinancialIndicators } from '@/lib/reports/financial-indicators/indicators'
import { formatIsoDateFr } from '@/lib/utils/date'
import { plural } from '@/lib/utils/plural'
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
import type { GroupStructureReport } from './get-group-structure.service'
import type { GroupTaxReport } from './get-group-tax.service'
import type { PeriodRef } from './get-group-view.service'
import { FLOW_CATEGORY_LABELS, FIGURE_ROWS, PARTICIPATION_KIND_LABELS } from './labels'
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
function indicatorCell(kind: 'amount' | 'total' | 'percent' | 'days', value: number | null): Row[number] {
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

export function transactionsDoc(
  holding: { name: string },
  companies: GroupCompanyLink[],
  items: readonly GroupTransaction[],
  truncated: boolean,
  year: number,
  notRead = 0,
): ExportDoc {
  const names = new Map(companies.map((c) => [c.id, c.name]))
  const notices = [
    truncated ? `Les ${items.length} transactions les plus récentes\u00a0: affinez les filtres pour exporter les autres.` : null,
    // A subsidiary out of reach, or where the user may not export (KLEDG-R3-AUTHZ-04).
    notRead > 0 ? `${plural(notRead, 'filiale n’est pas exportée', 'filiales ne sont pas exportées')}, faute d’accès ou de droit d’export.` : null,
  ].filter((notice): notice is string => notice !== null)
  return {
    title: `Transactions bancaires du groupe ${holding.name}`,
    notice: notices.length > 0 ? notices.join(' ') : null,
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

const KIND_LABELS: Record<string, string> = {
  holding: 'Holding',
  subsidiary: 'Filiale',
  person: 'Personne',
  company: 'Société',
  other: 'Autre actionnaire',
  hidden: 'Société non accessible',
}

export function structureDoc(report: GroupStructureReport, year: number): ExportDoc {
  const labelOf = new Map(report.nodes.map((n) => [n.id, n.label]))
  const nodes: Section = {
    name: 'Organigramme',
    header: ['Nom', 'Nature', 'Niveau', 'Détention par la holding (directe)', 'Détention par la holding (indirecte)', 'Détention par la holding (totale)', 'Dirigeants'],
    rows: report.nodes.map((n) => [
      n.label,
      KIND_LABELS[n.kind] ?? n.kind,
      n.level,
      n.holdingInterest ? percentCell(n.holdingInterest.directBp) : '',
      n.holdingInterest ? percentCell(n.holdingInterest.indirectBp) : '',
      n.holdingInterest ? percentCell(n.holdingInterest.totalBp) : '',
      n.officers.map((o) => (o.title ? `${o.name} (${o.title})` : o.name)).join(', '),
    ]),
    amountColumns: [],
  }
  const edges: Section = {
    name: 'Détentions',
    header: ['Détenteur', 'Société détenue', 'Pourcentage', 'Catégorie'],
    rows: report.edges.map((e) => [labelOf.get(e.from) ?? '', labelOf.get(e.to) ?? '', e.bp === null ? 'Non lu' : percentCell(e.bp), e.kind ? PARTICIPATION_KIND_LABELS[e.kind] : '']),
    amountColumns: [],
  }
  return { title: `Structure du groupe ${report.holding.name}`, holdingName: report.holding.name, year, sections: [nodes, edges] }
}

const CHECK_LABELS = { ok: 'Remplie', ko: 'Non remplie', check: 'À vérifier' } as const

export function taxDoc(report: GroupTaxReport): ExportDoc {
  const sim = report.integration
  const companies: Section = {
    name: 'Impôt par société',
    header: ['Société', 'Rôle', 'Exercice', 'Résultat fiscal', 'Déficits imputés', 'Bénéfice imposable', 'Impôt sur les sociétés', 'Taux réduit', 'Contribution sociale', 'Total', 'Solde à payer', 'Échéance du solde'],
    rows: report.companies.map((c) => [
      c.company.name,
      roleOf(c.company),
      c.fiscalYear ? `Du ${formatIsoDateFr(c.fiscalYear.startDate)} au ${formatIsoDateFr(c.fiscalYear.endDate)}` : 'Aucun exercice',
      c.resultBeforeDeficitsCents,
      c.deficitsImputedCents,
      c.taxableProfitCents,
      c.corporateTaxCents,
      c.reducedRateApplied === null ? '' : c.reducedRateApplied ? 'Oui' : 'Non',
      c.socialContributionCents,
      c.totalCents,
      c.balanceCents,
      c.balanceDue ? formatIsoDateFr(c.balanceDue) : '',
    ]),
    amountColumns: [4, 5, 6, 7, 9, 10, 11],
  }
  companies.rows.push(...notReadRows(report.unreachable, companies.header.length))
  const parent: Section = {
    name: 'Régime mère-fille',
    header: ['Société mère', 'Filiale', 'Détention', 'Seuil de 5 %', 'Dividendes reçus', 'Appliqué dans l’impôt de la mère'],
    rows: report.parentSubsidiary.map((p) => [p.parent.name, p.subsidiary.name, percentCell(p.stakeBp), p.eligible ? 'Atteint' : 'Non atteint', p.dividendsCents, p.applied ? 'Oui' : 'Non']),
    amountColumns: [5],
  }
  const members: Section = {
    name: 'Intégration, périmètre',
    header: ['Société', 'Détention par le groupe', 'Membre possible', 'Conditions'],
    rows: sim.members.map((m) => [
      m.name,
      m.interestBp === null ? 'Société mère' : percentCell(m.interestBp),
      m.member ? 'Oui' : 'Non',
      m.checks.map((c) => `${c.label}\u00a0: ${CHECK_LABELS[c.status]}`).join('\u00a0; '),
    ]),
    amountColumns: [],
  }
  const result: Section = {
    name: 'Intégration, simulation',
    header: ['Ligne', 'Montant', 'Détail'],
    rows: [
      ...sim.results.map((r) => [`Résultat fiscal de ${r.name}`, r.resultBeforeDeficitsCents, '']),
      ...sim.adjustments.map((a) => [a.label, a.origin === 'info' ? null : a.amountCents, a.detail]),
      ['Résultat d’ensemble avant déficits', sim.resultBeforeDeficitsCents, ''],
      ['Déficits antérieurs imputés', sim.deficits.imputedCents, 'Chacun sur le bénéfice de sa société, dans la limite de l’article 209, I'],
      ['Impôt sur les sociétés du groupe', sim.group?.corporateTaxCents ?? null, sim.group?.reducedRate.applied ? 'Taux réduit appliqué une fois' : 'Taux normal'],
      ['Contribution sociale du groupe', sim.group?.socialContribution.cents ?? null, ''],
      ['Total du groupe', sim.group?.totalCents ?? null, ''],
      ['Somme des impôts des sociétés imposées séparément', sim.separateTotalCents, ''],
      ['Économie (positive) ou surcoût (négatif)', sim.savingCents, sim.notice],
    ],
    amountColumns: [2],
  }
  const sources: Section = { name: 'Sources', header: ['Source', 'Lien'], rows: sim.sources.map((s) => [s.label, s.url]), amountColumns: [] }
  return {
    title: `Fiscalité du groupe ${report.holding.name}, ${period(report.fiscalYear)}`,
    holdingName: report.holding.name,
    year: report.fiscalYear.year,
    notice: sim.notice,
    sections: [companies, parent, members, result, sources],
  }
}
