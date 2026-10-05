/**
 * The organigramme data builder (lib/group/structure.ts): nodes and edges
 * from the cap tables, the kinds of the Code de commerce (art. L233-1:
 * filiale above 50 %; art. L233-2: participation from 10 to 50 %), direct
 * and indirect interests, levels, cycles, hidden subsidiaries and layout.
 */

import { describe, expect, it } from 'vitest'
import { buildGroupStructure, companyLevels, edgeLabel, HIDDEN_COMPANY_LABEL, layoutStructure, type StructureInput } from '../structure'

const company = (id: string, role: 'holding' | 'subsidiary' = 'subsidiary') => ({ id, name: id.toUpperCase(), slug: id, role, logo: null, legalType: 'SAS', officers: [] })

/** Claire 60 % and Marc 40 % of H; H 80 % of A and 40 % of B; A 10 % of B; Marc 5 % of B. */
const BASE: StructureInput = {
  holdingId: 'h',
  companies: [{ ...company('h', 'holding'), officers: [{ name: 'Claire Vasseur', title: 'Présidente' }] }, company('a'), company('b')],
  hidden: [],
  holders: [
    { key: 'holder-1', kind: 'person', name: 'Claire Vasseur', photo: 'data:image/png;base64,AAAA' },
    { key: 'holder-2', kind: 'person', name: 'Marc Vasseur', photo: null },
  ],
  holdings: [
    { holderKey: 'holder-1', companyKey: 'h', bp: 6000 },
    { holderKey: 'holder-2', companyKey: 'h', bp: 4000 },
    { holderKey: 'company:h', companyKey: 'a', bp: 8000 },
    { holderKey: 'company:h', companyKey: 'b', bp: 4000 },
    { holderKey: 'company:a', companyKey: 'b', bp: 1000 },
    { holderKey: 'holder-2', companyKey: 'b', bp: 500 },
  ],
}

describe('buildGroupStructure', () => {
  it('makes a node per person and company and an edge per holding, with the kind between companies', () => {
    const s = buildGroupStructure(BASE)
    expect(s.nodes.map((n) => [n.id, n.kind, n.level])).toEqual([
      ['holder-1', 'person', 0],
      ['holder-2', 'person', 0],
      ['h', 'holding', 1],
      ['a', 'subsidiary', 2],
      ['b', 'subsidiary', 3],
    ])
    expect(s.edges.map((e) => [e.from, e.to, e.bp, e.kind])).toEqual([
      ['holder-1', 'h', 6000, null],
      ['holder-2', 'h', 4000, null],
      ['h', 'a', 8000, 'filiale'],
      ['h', 'b', 4000, 'participation'],
      ['a', 'b', 1000, 'participation'],
      ['holder-2', 'b', 500, null],
    ])
    expect(s.levels).toBe(4)
    expect(s.nodes.find((n) => n.id === 'h')?.officers).toEqual([{ name: 'Claire Vasseur', title: 'Présidente' }])
  })

  it("computes the holding's interest and each holder's direct and indirect percentages", () => {
    const s = buildGroupStructure(BASE)
    const b = s.nodes.find((n) => n.id === 'b')!
    // H holds 40 % of B directly and 80 % x 10 % = 8 % through A.
    expect(b.holdingInterest).toEqual({ directBp: 4000, indirectBp: 800, totalBp: 4800 })
    // Claire: 60 % x 48 % = 28,8 %; Marc: 5 % + 40 % x 48 % = 24,2 %.
    expect(b.holders.map((h) => [h.label, h.directBp, h.indirectBp, h.totalBp])).toEqual([
      ['H', 4000, 800, 4800],
      ['Claire Vasseur', 0, 2880, 2880],
      ['Marc Vasseur', 500, 1920, 2420],
      ['A', 1000, 0, 1000],
    ])
    expect(s.nodes.find((n) => n.id === 'a')?.holdingInterest).toEqual({ directBp: 8000, indirectBp: 0, totalBp: 8000 })
  })

  it('adds up two rows of one holder in one company', () => {
    const s = buildGroupStructure({ ...BASE, holdings: [...BASE.holdings, { holderKey: 'company:h', companyKey: 'a', bp: 1500 }] })
    expect(s.edges.find((e) => e.id === 'h->a')).toMatchObject({ bp: 9500, kind: 'filiale' })
  })

  it('guards cycles: two companies holding each other keep finite levels and interests', () => {
    const s = buildGroupStructure({
      holdingId: 'h',
      companies: [company('h', 'holding'), company('a'), company('b')],
      hidden: [],
      holders: [],
      holdings: [
        { holderKey: 'company:h', companyKey: 'a', bp: 9000 },
        { holderKey: 'company:a', companyKey: 'b', bp: 6000 },
        { holderKey: 'company:b', companyKey: 'a', bp: 1000 },
        { holderKey: 'company:a', companyKey: 'h', bp: 500 },
      ],
    })
    expect(s.nodes.map((n) => [n.id, n.level])).toEqual([
      ['h', 1],
      ['a', 2],
      ['b', 3],
    ])
    const a = s.nodes.find((n) => n.id === 'a')!
    // H holds 90 % of A; the chain H, A, B, A would pass twice through A: cut (ownership.ts).
    expect(a.holdingInterest).toEqual({ directBp: 9000, indirectBp: 0, totalBp: 9000 })
    // H in B: 90 % x 60 %.
    expect(s.nodes.find((n) => n.id === 'b')?.holdingInterest).toEqual({ directBp: 0, indirectBp: 5400, totalBp: 5400 })
    expect(companyLevels('h', ['h', 'a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'h', to: 'a' }]).get('b')).toBe(3)
  })

  it('shows a subsidiary not read as "Société non accessible", without percentage, and its own holdings', () => {
    const s = buildGroupStructure({
      ...BASE,
      hidden: [{ key: 'hidden-1', name: null }],
      holdings: [...BASE.holdings, { holderKey: 'company:h', companyKey: 'hidden-1', bp: null }, { holderKey: 'hidden-1', companyKey: 'a', bp: 500 }],
    })
    const hidden = s.nodes.find((n) => n.kind === 'hidden')!
    expect(hidden).toMatchObject({ id: 'hidden-1', label: HIDDEN_COMPANY_LABEL, slug: null, holdingInterest: null, holders: [], level: 2 })
    expect(s.edges.find((e) => e.to === 'hidden-1')).toMatchObject({ from: 'h', bp: null, kind: null })
    expect(edgeLabel({ bp: null })).toBe('Non lue')
    expect(s.edges.find((e) => e.from === 'hidden-1')).toMatchObject({ to: 'a', bp: 500, kind: 'autre' })
    expect(s.nodes.find((n) => n.id === 'a')!.holders.map((h) => h.label)).toContain(HIDDEN_COMPANY_LABEL)
  })

  it('formats the percentage of an edge', () => {
    expect(edgeLabel({ bp: 8000 })).toBe('80 %')
    expect(edgeLabel({ bp: 3333 })).toBe('33,33 %')
    expect(edgeLabel({ bp: 1250 })).toBe('12,5 %')
  })
})

describe('layoutStructure', () => {
  it('lays the levels out as rows centred on the widest one', () => {
    const s = buildGroupStructure(BASE)
    const layout = layoutStructure(s.nodes, { width: 100, height: 40, gapX: 10, gapY: 20, margin: 5 })
    expect(layout.width).toBe(2 * 100 + 10 + 10)
    expect(layout.height).toBe(4 * 40 + 3 * 20 + 10)
    expect(layout.boxes.get('holder-1')).toEqual({ x: 5, y: 5, width: 100, height: 40 })
    expect(layout.boxes.get('h')).toEqual({ x: 60, y: 65, width: 100, height: 40 })
    expect(layout.boxes.get('b')?.y).toBe(185)
  })
})
