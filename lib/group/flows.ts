/**
 * Money between the companies of a group (Trésorerie of the group space and
 * Argent entre mes sociétés of its simple mode, docs/vue-groupe.md): the
 * intragroup flows the eliminations found (combine.ts), as money that went
 * from one company to another, for the flow diagram and the plain
 * sentences. Pure: no runtime import but the money formatter.
 *
 * Direction of the money: a management fee or an invoice is paid by the
 * buyer to the seller, a dividend by the company that distributes it, a
 * loan or an advance in current account goes from the lender to the
 * borrower; a trade balance is what a client company still owes. Amounts
 * are the larger of the two sides (the books may disagree: the gap is kept).
 */

import type { Eliminations, FlowCategory } from './combine'
import { addIsoDays } from '@/lib/utils/date'
import { formatCentsFr } from '@/lib/utils/money'

export type MoneyFlowKind = 'management_fee' | 'invoice' | 'dividend' | 'loan' | 'current_account' | 'trade'

export interface MoneyFlow {
  /** Who the money came from (or who owes, for a balance). */
  fromId: string
  toId: string
  kind: MoneyFlowKind
  cents: number
  /** Difference between the two books (0 when they agree). */
  gapCents: number
  /** Over the period (operations, dividends) or a balance at its end (loans, current accounts, trade). */
  nature: 'period' | 'balance'
}

export const MONEY_FLOW_LABELS: Record<MoneyFlowKind, string> = {
  management_fee: 'Frais de gestion',
  invoice: 'Factures',
  dividend: 'Dividendes',
  loan: 'Prêts',
  current_account: 'Avances en compte courant',
  trade: 'Factures à régler',
}

const balanceKind = (categories: readonly FlowCategory[]): MoneyFlowKind =>
  categories.includes('loan') ? 'loan' : categories.includes('current_account') ? 'current_account' : 'trade'

export function moneyFlows(eliminations: Pick<Eliminations, 'operations' | 'dividends' | 'balances'>): MoneyFlow[] {
  const flows: MoneyFlow[] = []
  for (const p of eliminations.operations) {
    const cents = Math.max(p.revenueCents, p.chargeCents)
    if (cents <= 0) continue
    flows.push({ fromId: p.buyerId, toId: p.sellerId, kind: p.categories.includes('management_fee') ? 'management_fee' : 'invoice', cents, gapCents: p.gapCents, nature: 'period' })
  }
  for (const d of eliminations.dividends) {
    if (d.cents > 0) flows.push({ fromId: d.payerId, toId: d.receiverId, kind: 'dividend', cents: d.cents, gapCents: 0, nature: 'period' })
  }
  for (const b of eliminations.balances) {
    const cents = Math.max(b.receivableCents, b.payableCents)
    if (cents <= 0) continue
    const kind = balanceKind(b.categories)
    // A loan or an advance: money the creditor sent; a trade balance: what the debtor still owes.
    flows.push(kind === 'trade' ? { fromId: b.debtorId, toId: b.creditorId, kind, cents, gapCents: b.gapCents, nature: 'balance' } : { fromId: b.creditorId, toId: b.debtorId, kind, cents, gapCents: b.gapCents, nature: 'balance' })
  }
  return flows.sort((a, b) => b.cents - a.cents)
}

export interface FlowDiagram {
  /** Left column: who pays or lends; right column: who receives, each company at most once per column. */
  nodes: Array<{ name: string; companyId: string; side: 'from' | 'to' }>
  links: Array<{ source: number; target: number; value: number; kind: MoneyFlowKind }>
}

/**
 * The flows as a two-column diagram (a Sankey needs no cycle: a company
 * that both pays and receives appears once on each side). Amounts in euros
 * for the chart, one link per pair and kind.
 */
export function flowDiagram(flows: readonly MoneyFlow[], names: ReadonlyMap<string, string>): FlowDiagram {
  const nodes: FlowDiagram['nodes'] = []
  const index = new Map<string, number>()
  const nodeOf = (companyId: string, side: 'from' | 'to') => {
    const key = `${side}:${companyId}`
    const existing = index.get(key)
    if (existing !== undefined) return existing
    nodes.push({ name: names.get(companyId) ?? 'Société du groupe', companyId, side })
    index.set(key, nodes.length - 1)
    return nodes.length - 1
  }
  const links: FlowDiagram['links'] = []
  for (const f of flows) {
    if (f.cents <= 0 || f.fromId === f.toId) continue
    links.push({ source: nodeOf(f.fromId, 'from'), target: nodeOf(f.toId, 'to'), value: f.cents / 100, kind: f.kind })
  }
  return { nodes, links }
}

/** Calendar months from `start` (yyyy-mm-dd) to `today`, within [1, 12]. */
export function monthsElapsed(start: string, end: string, today: string): number {
  const last = today < end ? today : end
  const months = (Number(last.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(last.slice(5, 7)) - Number(start.slice(5, 7)) + 1
  return Math.min(12, Math.max(1, months))
}

/**
 * A flow in plain words for the simple mode (no account number, no
 * accounting term): "Lumen Holding facture 18 000,00 € à Atelier Lumen pour
 * la gestion, soit 1 500,00 € par mois en moyenne".
 */
export function flowSentence(flow: MoneyFlow, names: ReadonlyMap<string, string>, months: number): string {
  const from = names.get(flow.fromId) ?? 'Une société du groupe'
  const to = names.get(flow.toId) ?? 'une société du groupe'
  const amount = formatCentsFr(flow.cents)
  switch (flow.kind) {
    case 'management_fee': {
      const monthly = months > 1 ? `, soit ${formatCentsFr(Math.round(flow.cents / months))} par mois en moyenne` : ''
      return `${to} facture ${amount} à ${from} pour la gestion${monthly}`
    }
    case 'invoice':
      return `${from} a acheté pour ${amount} à ${to}`
    case 'dividend':
      return `${from} a versé ${amount} de dividendes à ${to}`
    case 'loan':
      return `${from} a prêté ${amount} à ${to}`
    case 'current_account':
      return `${from} a avancé ${amount} à ${to}, à rembourser`
    case 'trade':
      return `${from} doit encore ${amount} à ${to} pour des factures`
  }
}

/** "Atelier Lumen doit 25 000,00 € à Lumen Holding": a balance between two companies, in plain words. */
export function oweSentence(flow: MoneyFlow, names: ReadonlyMap<string, string>): string {
  const lender = flow.kind === 'trade' ? flow.toId : flow.fromId
  const borrower = flow.kind === 'trade' ? flow.fromId : flow.toId
  return `${names.get(borrower) ?? 'Une société du groupe'} doit ${formatCentsFr(flow.cents)} à ${names.get(lender) ?? 'une société du groupe'}`
}

export interface TreasuryOutlook {
  /** Average change per month over the last three months (or fewer) up to today. */
  monthlyTrendCents: number | null
  /** Amounts of the deadlines not settled in the next 90 days. */
  upcomingCents: number
  upcomingCount: number
  /** Cash in three months at the same pace, minus those amounts. Indicative. */
  projectedCents: number | null
  lastCents: number | null
  hints: string[]
}

/**
 * Hints about the group's cash (Trésorerie of the group space): the pace of
 * the last three months and the payments the deadlines already know. A
 * projection at the same pace, never a forecast: the page says so.
 */
export function treasuryOutlook(
  months: ReadonlyArray<{ month: string; totalCents: number }>,
  deadlines: ReadonlyArray<{ date: string; settled: boolean; amountCents: number | null }>,
  today: string,
): TreasuryOutlook {
  const past = months.filter((m) => m.month <= today.slice(0, 7))
  const last = past.at(-1) ?? null
  const span = Math.min(3, past.length - 1)
  const trend = last && span > 0 ? Math.round((last.totalCents - past[past.length - 1 - span].totalCents) / span) : null
  const horizon = addIsoDays(today, 90)
  const upcoming = deadlines.filter((d) => !d.settled && d.date >= today && d.date <= horizon && (d.amountCents ?? 0) > 0)
  const upcomingCents = upcoming.reduce((s, d) => s + (d.amountCents ?? 0), 0)
  const projectedCents = last && trend !== null ? last.totalCents + 3 * trend - upcomingCents : null
  const hints: string[] = []
  if (trend !== null) {
    hints.push(trend === 0 ? 'La trésorerie du groupe est stable sur les derniers mois.' : `Au rythme des ${span === 1 ? 'derniers mois' : `${span} derniers mois`}, la trésorerie du groupe ${trend > 0 ? 'augmente' : 'baisse'} de ${formatCentsFr(Math.abs(trend))} par mois.`)
  }
  if (upcoming.length > 0) hints.push(`${formatCentsFr(upcomingCents)} d’échéances à payer dans les 90 prochains jours, d’après les montants enregistrés dans le suivi des déclarations.`)
  if (projectedCents !== null) hints.push(`À ce rythme et après ces échéances, la trésorerie serait d’environ ${formatCentsFr(projectedCents)} dans trois mois (projection indicative).`)
  return { monthlyTrendCents: trend, upcomingCents, upcomingCount: upcoming.length, projectedCents, lastCents: last?.totalCents ?? null, hints }
}

