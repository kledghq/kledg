/**
 * Flows of a year with the customers and suppliers (tiers-flows.ts): only
 * billing lines count (an entry with a class 7 line for a customer, a class
 * 6 or 2 line for a supplier), payments and the opening entry never; credit
 * notes are netted; the 8 largest per side are shown, the rest grouped;
 * names come from the Tiers record, else the lines, else one group.
 */

import { describe, expect, it } from 'vitest'
import { buildTiersFlows, FLOW_TOP, NO_AUXILIARY_CODE, shareOf, tiersFlowDiagram, type FlowEntry, type FlowEntryLine } from '../tiers-flows'

const line = (accountCode: string, debitCents: number, creditCents: number, aux?: [string, string | null]): FlowEntryLine => ({
  accountCode,
  debitCents,
  creditCents,
  auxiliaryAccountNumber: aux?.[0] ?? null,
  auxiliaryAccountLabel: aux?.[1] ?? null,
})
const entry = (lines: FlowEntryLine[], opening = false): FlowEntry => ({ opening, lines })

const sale = (aux: [string, string | null], cents: number) => entry([line('411000', cents, 0, aux), line('706000', 0, Math.round(cents / 1.2)), line('445710', 0, cents - Math.round(cents / 1.2))])
const purchase = (aux: [string, string | null], cents: number, account = '606100') => entry([line(account, cents, 0), line('401000', 0, cents, aux)])

describe('buildTiersFlows', () => {
  it('counts the billing lines, never the payments nor the opening entry', () => {
    const flows = buildTiersFlows([
      sale(['C001', 'Martin SA'], 120_000),
      // Payment of the customer: bank and 411, no class 7
      entry([line('512000', 120_000, 0), line('411000', 0, 120_000, ['C001', 'Martin SA'])]),
      purchase(['F001', 'Papeterie'], 8_000),
      // Payment of the supplier
      entry([line('401000', 8_000, 0, ['F001', 'Papeterie']), line('512000', 0, 8_000)]),
      // Opening entry: excluded even if it carried a class 7 or 6 line
      entry([line('411000', 50_000, 0, ['C001', 'Martin SA']), line('706000', 0, 50_000)], true),
      entry([line('606100', 9_000, 0), line('401000', 0, 9_000, ['F001', 'Papeterie'])], true),
    ])
    expect(flows.customers.tiers).toEqual([{ code: 'C001', name: 'Martin SA', cents: 120_000, count: 1 }])
    expect(flows.customers.totalCents).toBe(120_000)
    expect(flows.suppliers.tiers).toEqual([{ code: 'F001', name: 'Papeterie', cents: 8_000, count: 1 }])
  })

  it('counts a fixed asset purchase (class 2) for the supplier, and a sale only for the customer side', () => {
    const flows = buildTiersFlows([
      purchase(['F002', 'Informatique Pro'], 240_000, '218300'),
      // A class 6 line in a sale entry does not make the 411 line a purchase
      entry([line('411000', 10_000, 0, ['C002', 'Durand']), line('706000', 0, 10_000)]),
    ])
    expect(flows.suppliers.tiers.map((t) => [t.code, t.cents])).toEqual([['F002', 240_000]])
    expect(flows.customers.tiers.map((t) => [t.code, t.cents])).toEqual([['C002', 10_000]])
  })

  it('nets credit notes and drops a tiers whose amount is not positive', () => {
    const flows = buildTiersFlows([
      sale(['C001', 'Martin SA'], 100_000),
      // Credit note: 411 credit against 706 debit
      entry([line('706000', 30_000, 0), line('411000', 0, 30_000, ['C001', 'Martin SA'])]),
      sale(['C002', 'Durand'], 20_000),
      entry([line('706000', 25_000, 0), line('411000', 0, 25_000, ['C002', 'Durand'])]),
      // Supplier credit note cancelling the invoice
      purchase(['F001', 'Papeterie'], 5_000),
      entry([line('401000', 5_000, 0, ['F001', 'Papeterie']), line('609000', 0, 5_000)]),
    ])
    expect(flows.customers.tiers).toEqual([{ code: 'C001', name: 'Martin SA', cents: 70_000, count: 1 }])
    expect(flows.customers.totalCents).toBe(70_000)
    expect(flows.suppliers.tiers).toEqual([])
    expect(flows.suppliers.totalCents).toBe(0)
  })

  it('names a tiers after its Tiers record, else its lines, else its auxiliary account; lines without one form one group', () => {
    const directory = new Map([['C001', { name: 'Martin et Fils', terms: null }]])
    const flows = buildTiersFlows(
      [
        sale(['C001', 'MARTIN'], 1_000),
        sale(['C002', null], 2_000),
        sale(['C002', 'Durand SARL'], 3_000),
        sale(['C003', null], 500),
        entry([line('411000', 4_000, 0), line('706000', 0, 4_000)]),
        entry([line('411000', 1_000, 0, ['  ', 'Vide']), line('706000', 0, 1_000)]),
      ],
      directory,
    )
    expect(flows.customers.tiers).toEqual([
      // Same amount: by name
      { code: 'C002', name: 'Durand SARL', cents: 5_000, count: 1 },
      { code: NO_AUXILIARY_CODE, name: 'Sans compte auxiliaire', cents: 5_000, count: 1 },
      { code: 'C001', name: 'Martin et Fils', cents: 1_000, count: 1 },
      { code: 'C003', name: 'C003', cents: 500, count: 1 },
    ])
  })

  it('shows the 8 largest per side and groups the others', () => {
    const entries = Array.from({ length: 11 }, (_, i) => sale([`C${String(i + 1).padStart(3, '0')}`, `Client ${i + 1}`], (i + 1) * 1_000))
    entries.push(purchase(['F001', 'Seul fournisseur'], 7_000))
    const flows = buildTiersFlows(entries)
    expect(flows.customers.tiers).toHaveLength(11)
    expect(flows.customers.shown).toHaveLength(FLOW_TOP + 1)
    expect(flows.customers.shown.slice(0, 3).map((t) => t.name)).toEqual(['Client 11', 'Client 10', 'Client 9'])
    expect(flows.customers.shown[FLOW_TOP]).toEqual({ code: '(autres)', name: 'Autres clients (3)', cents: 6_000, count: 3 })
    expect(flows.customers.totalCents).toBe(66_000)
    expect(flows.suppliers.shown).toEqual(flows.suppliers.tiers)

    const many = buildTiersFlows(Array.from({ length: 9 }, (_, i) => purchase([`F${i}`, `Fournisseur ${i}`], 1_000 + i)))
    expect(many.suppliers.shown[FLOW_TOP].name).toBe('Autres fournisseurs (1)')
  })
})

describe('tiersFlowDiagram', () => {
  it('links the customers into the company and the company into its suppliers, with shares', () => {
    const flows = buildTiersFlows([sale(['C001', 'Martin SA'], 75_000), sale(['C002', 'Durand'], 25_000), purchase(['F001', 'Papeterie'], 40_000)])
    const diagram = tiersFlowDiagram(flows, 'Atelier Lumen')
    expect(diagram.nodes.map((n) => [n.name, n.role, n.share])).toEqual([
      ['Martin SA', 'customer', 75],
      ['Durand', 'customer', 25],
      ['Atelier Lumen', 'company', 100],
      ['Papeterie', 'supplier', 100],
    ])
    expect(diagram.links).toEqual([
      { source: 0, target: 2, value: 750, role: 'customer', cents: 75_000, share: 75 },
      { source: 1, target: 2, value: 250, role: 'customer', cents: 25_000, share: 25 },
      { source: 2, target: 3, value: 400, role: 'supplier', cents: 40_000, share: 100 },
    ])
  })

  it('is empty when nothing was billed', () => {
    expect(tiersFlowDiagram(buildTiersFlows([]), 'Atelier Lumen')).toEqual({ nodes: [], links: [] })
    expect(shareOf(1, 0)).toBe(0)
    expect(shareOf(1, 3)).toBe(33.3)
  })
})
