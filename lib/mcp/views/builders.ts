/**
 * Data of the views (lib/mcp/views/schemas.ts) built from what each wired
 * tool already computed: the same service results, the same rights, no
 * other read but the previous fiscal year of a statement (its N-1 column)
 * and the company's name. Pure functions, except the two loaders at the
 * end (statement views with their N-1).
 *
 * Buttons of the actionable lists only name tools of this server and their
 * arguments; the server checks every call again (lib/mcp/views/html/actions.ts).
 */

import { prisma } from '@/lib/prisma'
import type { McpAccess } from '@/lib/mcp/company-access'
import { kledgPageUrl } from '@/lib/mcp/tool-meta'
import { formatIsoDateFr } from '@/lib/utils/date'
import { formatCentsFr, fromCents, toCents } from '@/lib/utils/money'
import { isDebitSide, signedBankCents } from '@/lib/banking/side'
import { generateBalanceSheet } from '@/lib/reports/balance-sheet/generate-balance-sheet.service'
import { generateIncomeStatement } from '@/lib/reports/income-statement/generate-income-statement.service'
import type { BalanceSheetData, BalanceSheetLine } from '@/lib/reports/balance-sheet/types'
import type { IncomeStatementData, IncomeStatementLine } from '@/lib/reports/income-statement/types'
import type { TrialBalanceData } from '@/lib/reports/trial-balance/get-trial-balance.service'
import type { TiersFlowsReport } from '@/lib/reports/third-parties/get-third-party-reports.service'
import { tiersFlowDiagram } from '@/lib/reports/third-parties/tiers-flows'
import type { GroupView } from '@/lib/group/get-group-view.service'
import type { GroupTreasuryReport } from '@/lib/group/get-group-treasury.service'
import type { GroupStructureReport } from '@/lib/group/get-group-structure.service'
import { flowDiagram, moneyFlows, MONEY_FLOW_LABELS, type MoneyFlowKind } from '@/lib/group/flows'
import { INDICATIVE_NOTICE, PARTICIPATION_KIND_LABELS } from '@/lib/group/labels'
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_TONES, type InvoiceStatus } from '@/lib/invoices/status'
import { qontoStanding } from '@/lib/invoices/origin'
import { EXPENSE_STATUS_LABELS, EXPENSE_STATUS_TONES, type ExpenseReportStatus } from '@/lib/expense-reports/status'
import type {
  ActionsView,
  ChartColor,
  ChartView,
  DocumentView,
  OrganigramView,
  StatementRow,
  StatementView,
  ViewAction,
} from './schemas'
import type { UniqueMatch } from '@/lib/reconciliation/unique-match'

type Numeric = number | string | { toString(): string } | null | undefined

/** A number of the tools' output (Prisma Decimal, string or number) as a number of euros. */
function num(value: Numeric): number {
  if (value === null || value === undefined) return 0
  const n = typeof value === 'number' ? value : Number(String(value))
  return Number.isFinite(n) ? n : 0
}

/** A Decimal, string or number of euros as integer cents (sums stay exact, docs/conventions.md#money). */
const cents = (value: Numeric): number => toCents(value ?? 0) ?? 0
/** Euros of a sum of cents. */
const eurosOf = (values: number[]): number => fromCents(values.reduce((sum, c) => sum + c, 0))

const euroText = (value: number) => formatCentsFr(toCents(value) ?? 0)
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

interface FiscalYearLike {
  id: string
  year: number
  startDate: Date | string
  endDate: Date | string
}

const isoDay = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))
const periodText = (fy: FiscalYearLike) => `du ${formatIsoDateFr(isoDay(fy.startDate))} au ${formatIsoDateFr(isoDay(fy.endDate))}`

// ---------------------------------------------------------------- statements

interface TreeLine {
  id: string
  lineLabel: string
  formCode?: string | null
  hideLabel?: boolean
  children?: TreeLine[]
}

/**
 * Rows of a statement tree: a line with children is a subtotal shown above
 * them; a row whose amounts are all zero (and has no row kept below it) is
 * left out and counted.
 */
function treeRows<L extends TreeLine>(lines: readonly L[], valuesOf: (line: L) => Array<number | null>, depth = 0, hidden = { count: 0 }): { rows: StatementRow[]; hidden: { count: number } } {
  const rows: StatementRow[] = []
  for (const line of lines) {
    const children = line.children?.length ? treeRows(line.children as L[], valuesOf, line.hideLabel ? depth : depth + 1, hidden).rows : []
    const values = valuesOf(line)
    const zero = values.every((v) => v === null || v === 0)
    if (line.hideLabel) {
      rows.push(...children)
      continue
    }
    if (zero && children.length === 0) {
      hidden.count++
      continue
    }
    rows.push({ label: line.lineLabel, code: null, depth, kind: line.children?.length ? 'subtotal' : 'line', values })
    rows.push(...children)
  }
  return { rows, hidden }
}

function valuesById<L extends TreeLine>(lines: readonly L[] | undefined, valueOf: (line: L) => number, into = new Map<string, number>()): Map<string, number> {
  for (const line of lines ?? []) {
    into.set(line.id, valueOf(line))
    if (line.children) valuesById(line.children as L[], valueOf, into)
  }
  return into
}

interface StatementContext {
  companyId: string
  companyName: string
  fiscalYear: FiscalYearLike
  previousYear: number | null
  variant: 'complete' | 'simplified'
}

function statementColumns(ctx: StatementContext) {
  return [{ label: `Exercice ${ctx.fiscalYear.year}` }, ...(ctx.previousYear !== null ? [{ label: `Exercice ${ctx.previousYear}` }] : [])]
}

const variantText = (variant: 'complete' | 'simplified') => (variant === 'complete' ? 'présentation complète' : 'présentation simplifiée')

export function balanceSheetStatement(ctx: StatementContext, current: BalanceSheetData, previous: BalanceSheetData | null): StatementView {
  const withPrevious = previous !== null
  const prev = valuesById<BalanceSheetLine>([...(previous?.actif.lines ?? []), ...(previous?.passif.lines ?? [])], (l) => l.net)
  const valuesOf = (line: BalanceSheetLine) => (withPrevious ? [line.net, prev.get(line.id) ?? 0] : [line.net])
  const hidden = { count: 0 }
  const section = (label: string, data: BalanceSheetData['actif'], prevTotal: number | undefined, totalLabel: string) => ({
    title: data.label || label,
    rows: treeRows(data.lines, valuesOf, 0, hidden).rows,
    total: { label: totalLabel, values: withPrevious ? [data.netTotal, prevTotal ?? 0] : [data.netTotal] },
  })
  const warnings = [...(current.warnings ?? [])]
  if (current.imbalance) warnings.unshift(`Le bilan n'est pas équilibré\u00a0: écart de ${euroText(current.imbalance)} entre l'actif et le passif.`)
  return {
    view: 'statement',
    title: `Bilan, ${ctx.companyName}`,
    subtitle: `Exercice ${ctx.fiscalYear.year}, ${periodText(ctx.fiscalYear)}, ${variantText(ctx.variant)}`,
    columns: statementColumns(ctx),
    sections: [
      section('Actif', current.actif, previous?.actif.netTotal, 'Total actif'),
      section('Passif', current.passif, previous?.passif.netTotal, 'Total passif'),
    ],
    hiddenZeroRows: hidden.count,
    ...(warnings.length && { warnings }),
    links: [{ label: 'Ouvrir le bilan dans Kledg', url: kledgPageUrl(ctx.companyId, 'reports/balance-sheet') }],
  }
}

const INTERMEDIATE: Array<[keyof NonNullable<IncomeStatementData['intermediateResults']>, string]> = [
  ['resultatExploitation', "Résultat d'exploitation"],
  ['resultatFinancier', 'Résultat financier'],
  ['resultatCourant', 'Résultat courant avant impôts'],
  ['resultatExceptionnel', 'Résultat exceptionnel'],
]

export function incomeStatementStatement(ctx: StatementContext, current: IncomeStatementData, previous: IncomeStatementData | null): StatementView {
  const withPrevious = previous !== null
  const prev = valuesById<IncomeStatementLine>([...(previous?.produits.lines ?? []), ...(previous?.charges.lines ?? [])], (l) => l.value)
  const valuesOf = (line: IncomeStatementLine) => (withPrevious ? [line.value, prev.get(line.id) ?? 0] : [line.value])
  const pair = (now: number, before: number | undefined) => (withPrevious ? [now, before ?? 0] : [now])
  const hidden = { count: 0 }
  const totals: NonNullable<StatementView['totals']> = []
  for (const [key, label] of INTERMEDIATE) {
    const value = current.intermediateResults?.[key]
    if (typeof value === 'number') totals.push({ label, values: pair(value, previous?.intermediateResults?.[key]) })
  }
  totals.push({ label: current.netResult >= 0 ? 'Résultat net (bénéfice)' : 'Résultat net (perte)', values: pair(current.netResult, previous?.netResult), emphasis: true })
  return {
    view: 'statement',
    title: `Compte de résultat, ${ctx.companyName}`,
    subtitle: `Exercice ${ctx.fiscalYear.year}, ${periodText(ctx.fiscalYear)}, ${variantText(ctx.variant)}`,
    columns: statementColumns(ctx),
    sections: [
      { title: current.produits.label || 'Produits', rows: treeRows(current.produits.lines, valuesOf, 0, hidden).rows, total: { label: 'Total des produits', values: pair(current.totalProduits, previous?.totalProduits) } },
      { title: current.charges.label || 'Charges', rows: treeRows(current.charges.lines, valuesOf, 0, hidden).rows, total: { label: 'Total des charges', values: pair(current.totalCharges, previous?.totalCharges) } },
    ],
    totals,
    hiddenZeroRows: hidden.count,
    ...(current.warnings?.length && { warnings: current.warnings }),
    links: [{ label: 'Ouvrir le compte de résultat dans Kledg', url: kledgPageUrl(ctx.companyId, 'reports/income-statement') }],
  }
}

const PCG_CLASSES: Record<string, string> = {
  '1': 'Classe 1\u00a0: comptes de capitaux',
  '2': "Classe 2\u00a0: comptes d'immobilisations",
  '3': 'Classe 3\u00a0: comptes de stocks et en-cours',
  '4': 'Classe 4\u00a0: comptes de tiers',
  '5': 'Classe 5\u00a0: comptes financiers',
  '6': 'Classe 6\u00a0: comptes de charges',
  '7': 'Classe 7\u00a0: comptes de produits',
  '8': 'Classe 8\u00a0: comptes spéciaux',
}

export function trialBalanceStatement(companyId: string, companyName: string, data: TrialBalanceData): StatementView {
  const byClass = new Map<string, StatementView['sections'][number]>()
  /** Subtotals in cents: no float drift. */
  const sums = new Map<string, [number, number, number]>()
  let hidden = 0
  for (const row of data.balances) {
    if (row.debit === 0 && row.credit === 0 && row.balance === 0) {
      hidden++
      continue
    }
    const key = row.code.charAt(0)
    let section = byClass.get(key)
    if (!section) {
      section = { title: PCG_CLASSES[key] ?? `Classe ${key}`, rows: [] }
      byClass.set(key, section)
      sums.set(key, [0, 0, 0])
    }
    section.rows.push({ label: row.label, code: row.code, depth: 0, kind: 'line', values: [row.debit, row.credit, row.balance] })
    const s = sums.get(key)!
    sums.set(key, [s[0] + cents(row.debit), s[1] + cents(row.credit), s[2] + cents(row.balance)])
  }
  const sections = [...byClass.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, section]) => ({ ...section, total: { label: `Total classe ${key}`, values: sums.get(key)!.map(fromCents) } }))
  return {
    view: 'statement',
    title: `Balance générale, ${companyName}`,
    subtitle: `Du ${formatIsoDateFr(data.period.startDate)} au ${formatIsoDateFr(data.period.endDate)} (exercice ${data.fiscalYear.year}). Solde\u00a0: débit moins crédit.`,
    columns: [{ label: 'Débit' }, { label: 'Crédit' }, { label: 'Solde' }],
    sections,
    totals: [{ label: 'Total général', values: [data.totals.debit, data.totals.credit, data.totals.balance], emphasis: true }],
    hiddenZeroRows: hidden,
    links: [{ label: 'Ouvrir la balance dans Kledg', url: kledgPageUrl(companyId, 'reports/trial-balance') }],
  }
}

// -------------------------------------------------------------------- charts

export function tiersFlowsChart(companyId: string, report: TiersFlowsReport, kind: 'customers' | 'suppliers' | 'all'): ChartView {
  const flows = {
    customers: kind === 'suppliers' ? { ...report.customers, shown: [] } : report.customers,
    suppliers: kind === 'customers' ? { ...report.suppliers, shown: [] } : report.suppliers,
  }
  const diagram = tiersFlowDiagram(flows, report.company.name)
  const column = { customer: 0, company: 1, supplier: 2 } as const
  const customers = report.customers.totalCents / 100
  const suppliers = report.suppliers.totalCents / 100
  const parts = [
    kind !== 'suppliers' ? `${euroText(customers)} facturés à ${plural(report.customers.tiers.length, 'client', 'clients')}` : null,
    kind !== 'customers' ? `${euroText(suppliers)} facturés par ${plural(report.suppliers.tiers.length, 'fournisseur', 'fournisseurs')}` : null,
  ].filter(Boolean)
  return {
    view: 'chart',
    title: `Flux avec les clients et fournisseurs, ${report.company.name}`,
    subtitle: `Exercice ${report.fiscalYear.year}, montants TTC facturés, avoirs déduits`,
    chart: {
      kind: 'sankey',
      nodes: diagram.nodes.map((n) => ({ label: n.name, column: column[n.role] })),
      links: diagram.links.filter((l) => l.value > 0).map((l) => ({ source: l.source, target: l.target, value: l.value, color: l.role === 'customer' ? 'flow-customer' : 'flow-supplier', kind: l.role === 'customer' ? 'Vente' : 'Achat' })),
      legend: [
        ...(kind !== 'suppliers' ? [{ label: 'Clients', color: 'flow-customer' as const }] : []),
        ...(kind !== 'customers' ? [{ label: 'Fournisseurs', color: 'flow-supplier' as const }] : []),
      ],
    },
    summary: `Diagramme des flux de l'exercice ${report.fiscalYear.year}\u00a0: ${parts.join(', ')}.`,
    figures: [
      ...(kind !== 'suppliers' ? [{ label: 'Facturé aux clients', value: customers }] : []),
      ...(kind !== 'customers' ? [{ label: 'Facturé par les fournisseurs', value: suppliers }] : []),
    ],
    links: [{ label: 'Ouvrir les tiers dans Kledg', url: kledgPageUrl(companyId, 'tiers') }],
  }
}

const FLOW_COLORS: Record<MoneyFlowKind, ChartColor> = {
  management_fee: 'flow-management-fee',
  invoice: 'flow-invoice',
  dividend: 'flow-dividend',
  loan: 'flow-loan',
  current_account: 'flow-current-account',
  trade: 'flow-trade',
}

export function groupFlowsChart(companyId: string, view: GroupView): ChartView {
  const names = new Map(view.members.map((m) => [m.id, m.name]))
  const flows = moneyFlows(view.eliminations)
  const diagram = flowDiagram(flows, names)
  const kinds = (Object.keys(MONEY_FLOW_LABELS) as MoneyFlowKind[]).filter((k) => flows.some((f) => f.kind === k))
  const total = flows.reduce((sum, f) => sum + f.cents, 0) / 100
  return {
    view: 'chart',
    title: `Flux entre les sociétés du groupe ${view.holding.name}`,
    subtitle: `Exercice ${view.fiscalYear.year}\u00a0: à gauche la société qui paie ou prête, à droite celle qui reçoit`,
    notice: INDICATIVE_NOTICE,
    chart: {
      kind: 'sankey',
      nodes: diagram.nodes.map((n) => ({ label: n.name, column: n.side === 'from' ? 0 : 1 })),
      links: diagram.links.filter((l) => l.value > 0).map((l) => ({ source: l.source, target: l.target, value: l.value, color: FLOW_COLORS[l.kind], kind: MONEY_FLOW_LABELS[l.kind] })),
      legend: kinds.map((k) => ({ label: MONEY_FLOW_LABELS[k], color: FLOW_COLORS[k] })),
    },
    summary: flows.length
      ? `Diagramme des flux entre les sociétés du groupe sur l'exercice ${view.fiscalYear.year}\u00a0: ${plural(flows.length, 'flux', 'flux')} pour ${euroText(total)} au total.`
      : `Aucun flux entre les sociétés lues sur l'exercice ${view.fiscalYear.year}.`,
    figures: [
      { label: "Chiffre d'affaires combiné", value: view.combined.chiffreAffairesCents / 100 },
      { label: 'Après éliminations', value: view.afterEliminations.chiffreAffairesCents / 100 },
      { label: 'Trésorerie combinée', value: view.combined.tresorerieCents / 100 },
    ],
    ...(view.warnings.length && { warnings: view.warnings }),
    links: [{ label: 'Ouvrir la vue groupe dans Kledg', url: kledgPageUrl(companyId, 'group/treasury') }],
  }
}

export function groupTreasuryChart(companyId: string, report: GroupTreasuryReport): ChartView {
  const points = report.months.map((m) => ({ x: m.month, y: m.totalCents / 100 }))
  const last = points[points.length - 1]
  const lowest = points.reduce<{ x: string; y: number } | null>((low, p) => (low === null || p.y < low.y ? p : low), null)
  return {
    view: 'chart',
    title: `Trésorerie du groupe ${report.holding.name}`,
    subtitle: `Exercice ${report.fiscalYear.year}\u00a0: solde des comptes 512 des sociétés lues, en fin de mois`,
    chart: { kind: 'area', x: 'month', series: [{ name: 'Trésorerie comptable (512)', color: 'treasury', points }] },
    summary: last
      ? `Trésorerie comptable du groupe par mois sur l'exercice ${report.fiscalYear.year}\u00a0: ${euroText(last.y)} à fin ${last.x}${lowest ? `, au plus bas ${euroText(lowest.y)} (${lowest.x})` : ''}.`
      : `Pas de trésorerie comptable sur l'exercice ${report.fiscalYear.year}.`,
    figures: report.totalsByCurrency.map((t) => ({ label: `Soldes bancaires (${t.currency})`, value: t.balanceCents / 100 })).slice(0, 4),
    ...(report.warnings.length && { warnings: report.warnings }),
    links: [{ label: 'Ouvrir la trésorerie du groupe dans Kledg', url: kledgPageUrl(companyId, 'group/treasury') }],
  }
}

// ---------------------------------------------------------- actionable lists

const executionModeOf = (access: Pick<McpAccess, 'canAdmin' | 'executionMode'>) => (access.canAdmin ? access.executionMode : null)

interface EntryLike {
  id: string
  number: string | number | null
  date: string
  journal: string
  description: string | null
  reference: string | null
  status: string
  lines: Array<{ account: string; accountLabel: string; debit: Numeric; credit: Numeric; label: string | null }>
}

export function entriesList(
  companyId: string,
  access: Pick<McpAccess, 'canAdmin' | 'executionMode'>,
  args: Record<string, unknown>,
  fiscalYear: { year: number },
  entries: readonly EntryLike[],
): ActionsView {
  const fullControl = access.canAdmin
  const drafts = entries.filter((e) => e.status === 'draft')
  const onlyDrafts = args.status === 'draft'
  const items = entries.map((e) => {
    const draft = e.status === 'draft'
    const actions: ViewAction[] = []
    if (draft && fullControl) {
      actions.push({ kind: 'tool', label: 'Valider', tool: 'validate_entries', arguments: { companyId, entryIds: [e.id] }, highImpact: true })
      actions.push({ kind: 'tool', label: 'Supprimer', tool: 'delete_draft_entry', arguments: { companyId, entryId: e.id }, highImpact: true, danger: true })
    }
    actions.push({ kind: 'link', label: 'Ouvrir', url: kledgPageUrl(companyId, `entries/${e.id}`) })
    return {
      id: e.id,
      cells: {
        number: e.number === null ? null : String(e.number),
        date: e.date,
        journal: e.journal,
        description: [e.description, e.reference].filter(Boolean).join(', ') || null,
        amount: eurosOf(e.lines.map((l) => cents(l.debit))),
        status: draft ? 'Brouillon' : 'Validée',
      },
      breakdown: e.lines.map((l) => ({
        label: `${l.account} ${l.accountLabel}${l.label ? `\u00a0: ${l.label}` : ''}`,
        debit: num(l.debit) || null,
        credit: num(l.credit) || null,
      })),
      selectable: draft && fullControl,
      actions,
    }
  })
  const notice = drafts.length
    ? fullControl
      ? access.executionMode === 'validation'
        ? 'Valider ou supprimer passe par un aperçu, puis votre approbation dans Kledg\u00a0: l’assistant ne peut pas approuver.'
        : 'Valider ou supprimer montre d’abord un aperçu\u00a0; rien ne change avant votre confirmation.'
      : 'Les brouillons se valident dans Kledg (cette connexion n’a pas le contrôle total).'
    : undefined
  return {
    view: 'actions',
    title: onlyDrafts ? 'Écritures en brouillon' : 'Écritures',
    subtitle: `Exercice ${fiscalYear.year}, ${plural(entries.length, 'écriture', 'écritures')} (les plus récentes d’abord)`,
    ...(notice && { notice }),
    executionMode: executionModeOf(access),
    columns: [
      { key: 'number', label: 'N°', format: 'text' },
      { key: 'date', label: 'Date', format: 'date' },
      { key: 'journal', label: 'Journal', format: 'text' },
      { key: 'description', label: 'Libellé', format: 'text' },
      { key: 'amount', label: 'Montant', format: 'euros', align: 'end' },
      { key: 'status', label: 'Statut', format: 'text' },
    ],
    items,
    ...(fullControl && drafts.length > 1 && { bulk: { label: 'Valider la sélection', tool: 'validate_entries', argument: 'entryIds', arguments: { companyId }, highImpact: true } }),
    refresh: { tool: 'list_entries', arguments: args },
    figures: [
      { label: 'Brouillons', value: drafts.length, format: 'number' },
      { label: 'Montant des brouillons', value: eurosOf(drafts.flatMap((e) => e.lines.map((l) => cents(l.debit)))), format: 'euros' },
    ],
    empty: onlyDrafts ? 'Aucune écriture en brouillon sur cette période.' : 'Aucune écriture sur cette période.',
    links: [{ label: 'Ouvrir les écritures dans Kledg', url: kledgPageUrl(companyId, 'entries') }],
  }
}

interface BankTransactionLike {
  id: string
  date: string
  amount: Numeric
  side: string
  label: string | null
  counterpartyName: string | null
  reconciled: boolean
  bankAccount: string
}

/** Signed amount of a bank transaction: money out (debit) negative. */
const signedCents = (t: { amount: Numeric; side: string }) => signedBankCents(cents(t.amount), t.side)
const signed = (t: { amount: Numeric; side: string }) => fromCents(signedCents(t))

/** What "Rapprocher" asks before its call: the match in words, and a second click. */
function reconcileQuestion(match: UniqueMatch): string {
  const what =
    match.kind === 'entry'
      ? `Rapprocher cette transaction avec l’écriture existante (${match.label}, ${euroText(match.amount)})\u00a0?`
      : `Créer l’écriture en brouillon de la ${match.label.replace(/^Règle/, 'règle')} et rapprocher cette transaction (${euroText(match.amount)})\u00a0?`
  return `${what} Cliquez à nouveau pour confirmer.`
}

/**
 * The transactions to reconcile. With full control and `matches` (the
 * unique match of each transaction the server found, computed only when
 * the user may reconcile), a transaction that has one gets "Rapprocher",
 * a direct call of reconcile_transaction with that entry (or the rule's
 * lines) after a confirmation click; the others keep "Proposer une
 * écriture" (a message to the assistant) and "Pointer sans écriture".
 */
export function bankTransactionsList(
  companyId: string,
  access: Pick<McpAccess, 'canAdmin' | 'executionMode'>,
  args: Record<string, unknown>,
  transactions: readonly BankTransactionLike[],
  matches: ReadonlyMap<string, UniqueMatch> = new Map(),
): ActionsView {
  const open = transactions.filter((t) => !t.reconciled)
  const items = transactions.map((t) => {
    const amount = signed(t)
    const actions: ViewAction[] = []
    const match = !t.reconciled && access.canAdmin ? matches.get(t.id) : undefined
    if (match) {
      actions.push({
        kind: 'tool',
        label: 'Rapprocher',
        tool: 'reconcile_transaction',
        arguments: { companyId, ...match.arguments },
        // reconcile_transaction is a direct write (confirmation: false in lib/mcp/full-control/banking.ts)
        highImpact: false,
        primary: true,
        confirm: reconcileQuestion(match),
      })
    } else if (!t.reconciled) {
      actions.push({
        kind: 'message',
        label: 'Proposer une écriture',
        prompt: `Propose l'écriture de rapprochement de la transaction bancaire ${t.id} du ${formatIsoDateFr(t.date)} (${t.label ?? 'sans libellé'}, ${euroText(amount)}) de la société ${companyId}. Montre-moi la proposition avant de rapprocher quoi que ce soit.`,
      })
      if (access.canAdmin) {
        actions.push({
          kind: 'tool',
          label: 'Pointer sans écriture',
          tool: 'reconcile_transaction',
          arguments: { companyId, transactionId: t.id, withoutEntry: true },
          highImpact: false,
          confirm: 'Marquer cette transaction comme rapprochée sans écriture (pointage)\u00a0? À faire seulement si son écriture existe déjà ou n’est pas nécessaire. Cliquez à nouveau pour confirmer.',
        })
      }
    }
    return {
      id: t.id,
      cells: {
        date: t.date,
        label: t.label,
        counterparty: t.counterpartyName,
        bankAccount: t.bankAccount,
        amount,
        state: t.reconciled ? 'Rapprochée' : 'À rapprocher',
      },
      ...(match && {
        match: { kind: match.kind, entryId: match.entryId, lineId: match.lineId, ruleId: match.ruleId, label: match.label, amount: match.amount, date: match.date },
      }),
      actions,
    }
  })
  return {
    view: 'actions',
    title: args.onlyUnreconciled === false ? 'Transactions bancaires' : 'Transactions à rapprocher',
    subtitle: `${plural(transactions.length, 'transaction', 'transactions')}, les plus récentes d’abord`,
    ...(items.some((i) => i.match) && {
      notice: 'Rapprocher apparaît quand Kledg trouve une seule correspondance (une écriture existante ou une seule règle)\u00a0; rien ne change avant votre second clic.',
    }),
    executionMode: executionModeOf(access),
    columns: [
      { key: 'date', label: 'Date', format: 'date' },
      { key: 'label', label: 'Libellé', format: 'text' },
      { key: 'counterparty', label: 'Contrepartie', format: 'text' },
      { key: 'bankAccount', label: 'Compte', format: 'text' },
      { key: 'amount', label: 'Montant', format: 'euros', align: 'end' },
      { key: 'state', label: 'État', format: 'text' },
    ],
    items,
    refresh: { tool: 'list_bank_transactions', arguments: args },
    figures: [
      { label: 'À rapprocher', value: open.length, format: 'number' },
      { label: 'Encaissements', value: eurosOf(open.filter((t) => !isDebitSide(t.side)).map(signedCents)), format: 'euros' },
      { label: 'Décaissements', value: eurosOf(open.filter((t) => isDebitSide(t.side)).map(signedCents)), format: 'euros' },
    ],
    empty: 'Aucune transaction à rapprocher\u00a0: tout est à jour.',
    links: [{ label: 'Ouvrir le rapprochement dans Kledg', url: kledgPageUrl(companyId, 'reconciliation') }],
  }
}

interface MissingReceiptsLike {
  period: { startDate: string | null; endDate: string | null } | null
  threshold: number
  count: number
  total: number
  truncated: boolean
  transactions: Array<{
    id: string
    date: string
    label: string | null
    counterparty: string | null
    amount: number
    bankAccount: string
    reconciled: boolean
    supplier?: { name: string; invoicesUrl: string | null } | null
  }>
}

export function missingReceiptsList(companyId: string, access: Pick<McpAccess, 'canAdmin' | 'executionMode'>, args: Record<string, unknown>, result: MissingReceiptsLike): ActionsView {
  return {
    view: 'actions',
    title: 'Justificatifs manquants',
    subtitle:
      result.period?.startDate && result.period.endDate
        ? `Transactions sans justificatif du ${formatIsoDateFr(result.period.startDate)} au ${formatIsoDateFr(result.period.endDate)}`
        : 'Transactions sans justificatif',
    notice: 'Chaque pièce justificative se conserve 10 ans (Code de commerce, art. L123-22). Les justificatifs se joignent à la banque (Qonto) puis se synchronisent dans Kledg.',
    ...(result.truncated && { warnings: [`Liste limitée\u00a0: ${result.count} transactions au total, les plus récentes affichées.`] }),
    executionMode: executionModeOf(access),
    columns: [
      { key: 'date', label: 'Date', format: 'date' },
      { key: 'label', label: 'Libellé', format: 'text' },
      { key: 'counterparty', label: 'Contrepartie', format: 'text' },
      { key: 'supplier', label: 'Fournisseur', format: 'text' },
      { key: 'bankAccount', label: 'Compte', format: 'text' },
      { key: 'amount', label: 'Montant', format: 'euros', align: 'end' },
    ],
    items: result.transactions.map((t) => ({
      id: t.id,
      cells: { date: t.date, label: t.label, counterparty: t.counterparty, supplier: t.supplier?.name ?? null, bankAccount: t.bankAccount, amount: t.amount },
      actions: [
        {
          kind: 'message' as const,
          label: 'Retrouver la pièce',
          prompt: `Aide-moi à retrouver le justificatif de la transaction bancaire ${t.id} du ${formatIsoDateFr(t.date)} (${t.label ?? 'sans libellé'}${t.counterparty ? `, ${t.counterparty}` : ''}, ${euroText(t.amount)}) de la société ${companyId}\u00a0: quel document chercher et auprès de qui${t.supplier ? ` (fournisseur reconnu\u00a0: ${t.supplier.name}${t.supplier.invoicesUrl ? `, factures sur ${t.supplier.invoicesUrl}` : ''})` : ''}.`,
        },
      ],
    })),
    refresh: { tool: 'list_missing_receipts', arguments: args },
    figures: [
      { label: 'Sans justificatif', value: result.count, format: 'number' },
      { label: 'Montant concerné', value: result.total, format: 'euros' },
      ...(result.threshold > 0 ? [{ label: 'Seuil', value: result.threshold, format: 'euros' as const }] : []),
    ],
    empty: 'Aucun justificatif manquant au-dessus du seuil\u00a0: tout est en ordre.',
    links: [{ label: 'Ouvrir les justificatifs manquants dans Kledg', url: kledgPageUrl(companyId, 'banking/missing-receipts') }],
  }
}

// ----------------------------------------------------------------- documents

interface InvoiceLike {
  id: string
  direction: string
  number: string | null
  creditNote: boolean
  issueDate: string
  dueDate: string
  tiers: { name: string; auxiliaryAccountNumber?: string | null } | null
  parties: { sellerSiren: string | null; sellerVatNumber: string | null; buyerSiren: string | null; buyerVatNumber: string | null }
  status: string
  lines: Array<{ label: string; quantity: Numeric; unitPrice: number; vatRatePercent: number; totalExclTax: number; accountCode: string | null }>
  vatBreakdown: Array<{ ratePercent: number; base: number; vat: number }>
  totalExclTax: number
  totalVat: number
  totalInclTax: number
  paid: number
  remaining: number
  lettering: string | null
  entry: { entryNumber?: string | number | null } | null
  payments: Array<{ amount: number; entryNumber: string | number | null; date: string }>
  source: string | null
  origin?: string | null
  createdInQonto?: boolean
  qontoDraft?: boolean
  qontoId?: string | null
}

const TONES: Record<string, DocumentView['status']['tone']> = { neutral: 'neutral', info: 'info', warning: 'warning', success: 'success' }

/** "Origine" of an invoice: created in Qonto by Kledg (and still a draft there), imported from Qonto, or entered in Kledg. */
function originFacts(invoice: InvoiceLike): Array<{ label: string; value: string }> {
  const qonto = qontoStanding({
    source: invoice.source,
    origin: invoice.origin ?? null,
    createdInQonto: invoice.createdInQonto ?? false,
    qontoDraft: invoice.qontoDraft ?? false,
    qontoId: invoice.qontoId ?? null,
  })
  if (qonto.label) {
    return [
      { label: 'Origine', value: qonto.label },
      ...(qonto.draftLabel ? [{ label: 'Dans Qonto', value: qonto.draftLabel }] : []),
      ...(qonto.qontoId ? [{ label: 'Identifiant Qonto', value: qonto.qontoId }] : []),
    ]
  }
  if (!invoice.source) return []
  return [{ label: 'Origine', value: invoice.source === 'MANUAL' ? 'Saisie dans Kledg' : invoice.source }]
}

export function invoiceDocument(companyId: string, invoice: InvoiceLike): DocumentView {
  const sale = invoice.direction === 'SALE'
  const kindLabel = invoice.creditNote ? (sale ? 'Avoir client' : 'Avoir fournisseur') : sale ? 'Facture de vente' : "Facture d'achat"
  const status = invoice.status as InvoiceStatus
  const siren = sale ? invoice.parties.buyerSiren : invoice.parties.sellerSiren
  const vat = sale ? invoice.parties.buyerVatNumber : invoice.parties.sellerVatNumber
  const details = [
    invoice.tiers?.auxiliaryAccountNumber ? `Compte ${invoice.tiers.auxiliaryAccountNumber}` : null,
    siren ? `SIREN ${siren}` : null,
    vat ? `TVA ${vat}` : null,
  ].filter((d): d is string => d !== null)
  return {
    view: 'document',
    kind: invoice.creditNote ? 'credit_note' : 'invoice',
    title: `${kindLabel}${invoice.number ? ` n° ${invoice.number}` : ''}`,
    subtitle: invoice.tiers?.name ?? undefined,
    status: { label: INVOICE_STATUS_LABELS[status] ?? invoice.status, tone: TONES[INVOICE_STATUS_TONES[status]] ?? 'neutral' },
    parties: invoice.tiers ? [{ role: sale ? 'Client' : 'Fournisseur', name: invoice.tiers.name, details }] : [],
    facts: [
      { label: 'Date', value: invoice.issueDate, format: 'date' },
      { label: 'Échéance', value: invoice.dueDate, format: 'date' },
      ...(invoice.entry?.entryNumber ? [{ label: 'Écriture', value: String(invoice.entry.entryNumber) }] : []),
      ...(invoice.lettering ? [{ label: 'Lettrage', value: invoice.lettering }] : []),
      ...originFacts(invoice),
    ],
    tables: [
      {
        title: 'Lignes',
        columns: [
          { label: 'Désignation', format: 'text' },
          { label: 'Quantité', format: 'number', align: 'end' },
          { label: 'Prix unitaire HT', format: 'euros' },
          { label: 'TVA', format: 'percent', align: 'end' },
          { label: 'Total HT', format: 'euros' },
          { label: 'Compte', format: 'text' },
        ],
        rows: invoice.lines.map((l) => [l.label, num(l.quantity), l.unitPrice, l.vatRatePercent, l.totalExclTax, l.accountCode]),
      },
      ...(invoice.vatBreakdown.length
        ? [{ title: 'TVA par taux', columns: [{ label: 'Taux', format: 'percent' as const }, { label: 'Base HT', format: 'euros' as const }, { label: 'TVA', format: 'euros' as const }], rows: invoice.vatBreakdown.map((b) => [b.ratePercent, b.base, b.vat]) }]
        : []),
      ...(invoice.payments.length
        ? [{ title: 'Paiements enregistrés', columns: [{ label: 'Écriture', format: 'text' as const }, { label: 'Date', format: 'date' as const }, { label: 'Montant', format: 'euros' as const }], rows: invoice.payments.map((p) => [p.entryNumber === null ? null : String(p.entryNumber), p.date, p.amount]) }]
        : []),
    ],
    totals: [
      { label: 'Total HT', value: invoice.totalExclTax },
      { label: 'TVA', value: invoice.totalVat },
      { label: 'Total TTC', value: invoice.totalInclTax, emphasis: true },
      ...(invoice.paid ? [{ label: 'Déjà payé', value: invoice.paid }] : []),
      { label: 'Reste à payer', value: invoice.remaining },
    ],
    links: [{ label: 'Ouvrir la facture dans Kledg', url: kledgPageUrl(companyId, `invoices/${invoice.id}`) }],
  }
}

interface ExpenseReportLike {
  id: string
  number: string | null
  label: string | null
  claimant: { name: string; kind: string; auxiliaryAccountNumber?: string | null }
  periodStart: string
  periodEnd: string
  status: string
  returnNote: string | null
  totalOwed: number
  recoverableVat: number
  charges: number
  lines: Array<{ kind: string; date: string; supplier: string | null; label: string | null; categoryLabel: string; accountCode: string | null; amountPaid: number; recoverableVat: number; receipt: string | null; mileage?: { distanceKm: Numeric } }>
  entry: { entryNumber?: string | number | null } | null
  lettering: string | null
}

const CLAIMANT_KINDS: Record<string, string> = { EMPLOYEE: 'Salarié', DIRIGEANT: 'Dirigeant', ASSOCIE: 'Associé' }

export function expenseReportDocument(companyId: string, report: ExpenseReportLike): DocumentView {
  return {
    view: 'document',
    kind: 'expense_report',
    title: `Note de frais${report.number ? ` n° ${report.number}` : ''}`,
    subtitle: [report.label, `du ${formatIsoDateFr(report.periodStart)} au ${formatIsoDateFr(report.periodEnd)}`].filter(Boolean).join(', '),
    ...(report.returnNote && { notice: `Renvoyée avec ce motif\u00a0: ${report.returnNote}` }),
    status: { label: EXPENSE_STATUS_LABELS[report.status as ExpenseReportStatus] ?? report.status, tone: TONES[EXPENSE_STATUS_TONES[report.status as ExpenseReportStatus]] ?? 'neutral' },
    parties: [
      {
        role: 'Bénéficiaire',
        name: report.claimant.name,
        details: [CLAIMANT_KINDS[report.claimant.kind] ?? report.claimant.kind, report.claimant.auxiliaryAccountNumber ? `Compte ${report.claimant.auxiliaryAccountNumber}` : null].filter((d): d is string => !!d),
      },
    ],
    facts: [
      { label: 'Début', value: report.periodStart, format: 'date' },
      { label: 'Fin', value: report.periodEnd, format: 'date' },
      ...(report.entry?.entryNumber ? [{ label: 'Écriture', value: String(report.entry.entryNumber) }] : []),
      ...(report.lettering ? [{ label: 'Lettrage (remboursée)', value: report.lettering }] : []),
    ],
    tables: [
      {
        title: 'Dépenses',
        columns: [
          { label: 'Date', format: 'date' },
          { label: 'Dépense', format: 'text' },
          { label: 'Catégorie', format: 'text' },
          { label: 'Compte', format: 'text' },
          { label: 'Payé TTC', format: 'euros' },
          { label: 'TVA récupérable', format: 'euros' },
          { label: 'Justificatif', format: 'text' },
        ],
        rows: report.lines.map((l) => [
          l.date,
          l.kind === 'MILEAGE' ? `Indemnités kilométriques${l.mileage ? `, ${num(l.mileage.distanceKm)} km` : ''}${l.label ? `\u00a0: ${l.label}` : ''}` : [l.supplier, l.label].filter(Boolean).join('\u00a0: ') || null,
          l.categoryLabel,
          l.accountCode,
          l.amountPaid,
          l.recoverableVat,
          l.kind === 'MILEAGE' ? 'Barème' : l.receipt === 'INVOICE' ? 'Facture' : l.receipt === 'RECEIPT' ? 'Ticket' : l.receipt === 'NONE' ? 'Aucun' : l.receipt,
        ]),
      },
    ],
    totals: [
      { label: 'Charges', value: report.charges },
      { label: 'TVA récupérable', value: report.recoverableVat },
      { label: 'Total dû au bénéficiaire', value: report.totalOwed, emphasis: true },
    ],
    links: [{ label: 'Ouvrir la note de frais dans Kledg', url: kledgPageUrl(companyId, `expense-reports/${report.id}`) }],
  }
}

// --------------------------------------------------------------- organigram

const pct = (bp: number | null | undefined) => (bp === null || bp === undefined ? null : Math.min(100, Math.max(0, bp / 100)))

export function groupStructureOrganigram(companyId: string, report: GroupStructureReport): OrganigramView {
  const warnings = [...report.warnings]
  if (report.unreachable.length) warnings.push(`${plural(report.unreachable.length, 'filiale non accessible', 'filiales non accessibles')} à cette connexion\u00a0: ni nom ni pourcentage.`)
  return {
    view: 'organigram',
    title: `Structure du groupe ${report.holding.name}`,
    subtitle: 'Associés, holding et sociétés détenues\u00a0; filiale au-delà de 50 %, participation de 10 à 50 % (Code de commerce, art. L233-1 et L233-2)',
    nodes: report.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      kind: n.kind,
      level: n.level,
      order: n.order,
      legalType: n.legalType,
      interestPercent: pct(n.holdingInterest?.totalBp),
      holders: n.holders.map((h) => ({ label: h.label, percent: pct(h.totalBp) })),
      officers: n.officers.map((o) => (o.title ? `${o.name} (${o.title})` : o.name)),
    })),
    edges: report.edges.map((e) => ({ from: e.from, to: e.to, percent: pct(e.bp), kind: e.kind ? PARTICIPATION_KIND_LABELS[e.kind] : null })),
    ...(warnings.length && { warnings }),
    links: [{ label: 'Ouvrir la structure dans Kledg', url: kledgPageUrl(companyId, 'group/structure') }],
  }
}

// ------------------------------------------------------------------ loaders

async function statementContext(companyId: string, fiscalYear: FiscalYearLike, variant: 'complete' | 'simplified') {
  const [company, previous] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    prisma.fiscalYear.findFirst({
      where: { companyId, endDate: { lt: typeof fiscalYear.startDate === 'string' ? new Date(fiscalYear.startDate) : fiscalYear.startDate } },
      orderBy: { endDate: 'desc' },
      select: { id: true, year: true },
    }),
  ])
  return { ctx: { companyId, companyName: company?.name ?? 'Société', fiscalYear, previousYear: previous?.year ?? null, variant }, previousId: previous?.id ?? null }
}

/** Bilan with its N-1 column when the company has a previous fiscal year in Kledg. */
export async function balanceSheetView(companyId: string, fiscalYear: FiscalYearLike, variant: 'complete' | 'simplified', current: BalanceSheetData): Promise<StatementView> {
  const { ctx, previousId } = await statementContext(companyId, fiscalYear, variant)
  const previous = previousId ? await generateBalanceSheet(companyId, previousId, variant) : null
  return balanceSheetStatement(ctx, current, previous)
}

/** Compte de résultat with its N-1 column when the company has a previous fiscal year in Kledg. */
export async function incomeStatementView(companyId: string, fiscalYear: FiscalYearLike, variant: 'complete' | 'simplified', current: IncomeStatementData): Promise<StatementView> {
  const { ctx, previousId } = await statementContext(companyId, fiscalYear, variant)
  const previous = previousId ? await generateIncomeStatement(companyId, previousId, variant) : null
  return incomeStatementStatement(ctx, current, previous)
}

export async function trialBalanceView(companyId: string, data: TrialBalanceData): Promise<StatementView> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
  return trialBalanceStatement(companyId, company?.name ?? 'Société', data)
}
