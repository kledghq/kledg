/**
 * Flows of a fiscal year between the company and its tiers: what each
 * customer was billed and what each supplier billed the company, from the
 * validated entries of the year, for the flow diagram of the Tiers page
 * (docs/factures-et-tiers.md#flux-de-lexercice). Pure module: the service
 * (tiers-flows.service.ts) loads the entries, the tests feed them directly.
 *
 * A line of a customer (411) or supplier (401) account counts only when it
 * bills: its entry also has a line on a revenue account (class 7) for a
 * customer, on an expense (class 6) or fixed asset (class 2) account for a
 * supplier. Payments (bank, class 5) and the opening entry are left out; a
 * credit note is a billing entry the other way round, so it is netted.
 *
 * Amounts are TTC, in cents: a customer is billed debit - credit of its
 * lines, a supplier bills credit - debit. Tiers are grouped by auxiliary
 * account (FEC CompAuxNum), named after the Tiers record, else the label of
 * their lines; lines without auxiliary account form one group per side.
 */

import { kindOfAccount, type ThirdPartyKind, type TiersDirectory } from './third-party-balances'

/** Tiers shown one by one on each side of the diagram, the rest grouped. */
export const FLOW_TOP = 8

export const NO_AUXILIARY_CODE = '(sans compte auxiliaire)'
const NO_AUXILIARY_NAME = 'Sans compte auxiliaire'
const OTHERS_CODE = '(autres)'

export interface FlowEntryLine {
  accountCode: string
  auxiliaryAccountNumber: string | null
  auxiliaryAccountLabel: string | null
  debitCents: number
  creditCents: number
}

export interface FlowEntry {
  /** Entry of the opening journal (à-nouveaux): never a billing. */
  opening: boolean
  lines: FlowEntryLine[]
}

export interface TiersFlow {
  /** Auxiliary account number, NO_AUXILIARY_CODE or OTHERS_CODE. */
  code: string
  name: string
  cents: number
  /** Tiers grouped in this flow: 1, or the number of tiers behind "Autres". */
  count: number
}

export interface TiersFlowSide {
  kind: ThirdPartyKind
  totalCents: number
  /** Every tiers with a positive amount, largest first. */
  tiers: TiersFlow[]
  /** The FLOW_TOP largest, then one "Autres" flow for the rest. */
  shown: TiersFlow[]
}

export interface TiersFlows {
  customers: TiersFlowSide
  suppliers: TiersFlowSide
}

const OTHERS_NAMES: Record<ThirdPartyKind, (n: number) => string> = {
  customers: (n) => `Autres clients (${n})`,
  suppliers: (n) => `Autres fournisseurs (${n})`,
}

/** Whether an entry bills a tiers of this kind: a sale (class 7), or a purchase (class 6 or 2). */
function bills(entry: FlowEntry, kind: ThirdPartyKind): boolean {
  if (entry.opening) return false
  return entry.lines.some((l) => (kind === 'customers' ? l.accountCode.startsWith('7') : l.accountCode.startsWith('6') || l.accountCode.startsWith('2')))
}

function side(kind: ThirdPartyKind, totals: Map<string, { cents: number; label: string | null }>, directory: TiersDirectory): TiersFlowSide {
  const tiers = [...totals]
    .filter(([, t]) => t.cents > 0)
    .map(([code, t]): TiersFlow => ({
      code,
      name: code === NO_AUXILIARY_CODE ? NO_AUXILIARY_NAME : directory.get(code)?.name || t.label || code,
      cents: t.cents,
      count: 1,
    }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name, 'fr'))
  const rest = tiers.slice(FLOW_TOP)
  const shown = rest.length
    ? [...tiers.slice(0, FLOW_TOP), { code: OTHERS_CODE, name: OTHERS_NAMES[kind](rest.length), cents: rest.reduce((sum, t) => sum + t.cents, 0), count: rest.length }]
    : tiers
  return { kind, totalCents: tiers.reduce((sum, t) => sum + t.cents, 0), tiers, shown }
}

/** Billed amounts of the year per customer and per supplier. */
export function buildTiersFlows(entries: readonly FlowEntry[], directory: TiersDirectory = new Map()): TiersFlows {
  const totals: Record<ThirdPartyKind, Map<string, { cents: number; label: string | null }>> = { customers: new Map(), suppliers: new Map() }
  for (const entry of entries) {
    const billing = { customers: bills(entry, 'customers'), suppliers: bills(entry, 'suppliers') }
    for (const line of entry.lines) {
      const kind = kindOfAccount(line.accountCode)
      if (!kind || !billing[kind]) continue
      const key = line.auxiliaryAccountNumber?.trim() || NO_AUXILIARY_CODE
      const cents = kind === 'customers' ? line.debitCents - line.creditCents : line.creditCents - line.debitCents
      const current = totals[kind].get(key) ?? { cents: 0, label: null }
      totals[kind].set(key, { cents: current.cents + cents, label: current.label || line.auxiliaryAccountLabel?.trim() || null })
    }
  }
  return { customers: side('customers', totals.customers, directory), suppliers: side('suppliers', totals.suppliers, directory) }
}

/** Share of a flow in its side, in percent rounded to one decimal (0 when the side is empty). */
export function shareOf(cents: number, totalCents: number): number {
  return totalCents > 0 ? Math.round((cents / totalCents) * 1000) / 10 : 0
}

export interface TiersFlowNode {
  name: string
  role: 'customer' | 'company' | 'supplier'
  cents: number
  share: number
}

export interface TiersFlowDiagram {
  nodes: TiersFlowNode[]
  links: Array<{ source: number; target: number; value: number; role: 'customer' | 'supplier'; cents: number; share: number }>
}

/**
 * Nodes and links of the diagram (recharts Sankey): customers on the left
 * into the company, the company into its suppliers on the right. Values
 * in euros, for the thickness only; cents and shares go to the tooltip.
 */
export function tiersFlowDiagram(flows: TiersFlows, companyName: string): TiersFlowDiagram {
  const { customers, suppliers } = flows
  if (customers.shown.length === 0 && suppliers.shown.length === 0) return { nodes: [], links: [] }
  const nodes: TiersFlowNode[] = customers.shown.map((t) => ({ name: t.name, role: 'customer', cents: t.cents, share: shareOf(t.cents, customers.totalCents) }))
  const company = nodes.length
  nodes.push({ name: companyName, role: 'company', cents: Math.max(customers.totalCents, suppliers.totalCents), share: 100 })
  const links: TiersFlowDiagram['links'] = customers.shown.map((t, i) => ({ source: i, target: company, value: t.cents / 100, role: 'customer', cents: t.cents, share: nodes[i].share }))
  for (const t of suppliers.shown) {
    const share = shareOf(t.cents, suppliers.totalCents)
    nodes.push({ name: t.name, role: 'supplier', cents: t.cents, share })
    links.push({ source: company, target: nodes.length - 1, value: t.cents / 100, role: 'supplier', cents: t.cents, share })
  }
  return { nodes, links }
}
