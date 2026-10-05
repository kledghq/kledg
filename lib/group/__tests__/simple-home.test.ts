/**
 * Money between the companies of a group (lib/group/flows.ts) and the
 * group space in simple mode (lib/group/simple-home.ts): the simple pages
 * show the expert figures to the cent, in plain words without jargon
 * (SIMPLE_MODE_JARGON, docs/mode-simple.md).
 */

import { describe, expect, it } from 'vitest'
import { jargonIn } from '@/lib/simple/vocabulary'
import { flowDiagram, flowSentence, moneyFlows, monthsElapsed, oweSentence, treasuryOutlook } from '../flows'
import { buildSimpleGroupHome } from '../simple-home'
import { groupAlerts, groupDeadlines, groupTreasury, groupView } from './group-fixtures'

const names = new Map([
  ['h', 'Lumen Holding'],
  ['a', 'Atelier Lumen'],
  ['s', 'Studio Lumen'],
])

describe('moneyFlows', () => {
  it('turns the eliminations into money going from one company to another', () => {
    const flows = moneyFlows(groupView().eliminations)
    expect(flows.map((f) => [f.kind, f.fromId, f.toId, f.cents, f.gapCents, f.nature])).toEqual([
      ['current_account', 'h', 's', 2_500_000, 0, 'balance'],
      ['management_fee', 'a', 'h', 1_800_000, 0, 'period'],
      ['dividend', 'a', 'h', 1_000_000, 0, 'period'],
      // A trade balance: Studio still owes Atelier; the larger side, with the gap.
      ['trade', 's', 'a', 120_000, 20_000, 'balance'],
    ])
  })

  it('draws a payer column and a receiver column (no cycle for the Sankey)', () => {
    const diagram = flowDiagram(moneyFlows(groupView().eliminations).filter((f) => f.nature === 'period'), names)
    expect(diagram.nodes).toEqual([
      { name: 'Atelier Lumen', companyId: 'a', side: 'from' },
      { name: 'Lumen Holding', companyId: 'h', side: 'to' },
    ])
    expect(diagram.links).toEqual([
      { source: 0, target: 1, value: 18_000, kind: 'management_fee' },
      { source: 0, target: 1, value: 10_000, kind: 'dividend' },
    ])
  })

  it('says each flow in plain words, the management fees per month on average', () => {
    const [advance, fees, dividend, trade] = moneyFlows(groupView().eliminations)
    expect(monthsElapsed('2026-01-01', '2026-12-31', '2026-10-05')).toBe(10)
    expect(flowSentence(fees, names, 12)).toBe('Lumen Holding facture 18 000,00 € à Atelier Lumen pour la gestion, soit 1 500,00 € par mois en moyenne')
    expect(flowSentence(dividend, names, 10)).toBe('Atelier Lumen a versé 10 000,00 € de dividendes à Lumen Holding')
    expect(flowSentence(advance, names, 10)).toBe('Lumen Holding a avancé 25 000,00 € à Studio Lumen, à rembourser')
    expect(oweSentence(advance, names)).toBe('Studio Lumen doit 25 000,00 € à Lumen Holding')
    expect(oweSentence(trade, names)).toBe('Studio Lumen doit 1 200,00 € à Atelier Lumen')
  })
})

describe('treasuryOutlook', () => {
  it('gives the pace of the last three months and the known payments of the next 90 days', () => {
    const outlook = treasuryOutlook(groupView().treasury, groupDeadlines().deadlines, '2026-10-05')
    // (135 000 - 120 000) / 3 = 5 000 € a month.
    expect(outlook.monthlyTrendCents).toBe(500_000)
    // CFE 1 750 € on 15 December and VAT 1 200 € on 24 October; the overdue VAT and the paid IS are not upcoming.
    expect(outlook.upcomingCents).toBe(295_000)
    expect(outlook.projectedCents).toBe(13_500_000 + 1_500_000 - 295_000)
    expect(outlook.hints[0]).toBe('Au rythme des 3 derniers mois, la trésorerie du groupe augmente de 5 000,00 € par mois.')
  })
})

describe('buildSimpleGroupHome', () => {
  const view = groupView()
  const treasury = groupTreasury()
  const home = buildSimpleGroupHome({ view, treasury, deadlines: groupDeadlines(), alerts: groupAlerts(), today: '2026-10-05', holdingSlug: 'lumen-holding' })

  it('shows the figures of the expert views to the cent', () => {
    // Argent sur les comptes du groupe = the bank balances in euros of the Trésorerie view.
    expect(home.moneyCents).toBe(treasury.totalsByCurrency[0].balanceCents)
    // Ce que gagne le groupe = the result after eliminations of Pilotage.
    expect(home.earnedCents).toBe(view.afterEliminations.resultatCents)
    expect(home.earnedTitle).toBe('Bénéfice depuis janvier')
    for (const c of home.companies) {
      const member = view.members.find((m) => m.id === c.id)!
      expect(c.salesCents).toBe(member.figures?.chiffreAffairesCents)
      expect(c.profitCents).toBe(member.figures?.resultatCents)
      expect(c.moneyCents).toBe(treasury.companies.find((t) => t.company.id === c.id)?.bankEurCents)
    }
    expect(home.companies.map((c) => c.ownership)).toEqual(['Société de tête du groupe', 'Détenue à 80 % par Lumen Holding', 'Détenue à 100 % par Lumen Holding'])
  })

  it('says who owes whom, the taxes coming and what to do in each company', () => {
    expect(home.owes.map((o) => o.text)).toEqual(['Studio Lumen doit 25 000,00 € à Lumen Holding', 'Studio Lumen doit 1 200,00 € à Atelier Lumen'])
    expect(home.taxes.map((t) => [t.companyName, t.title, t.hint, t.overdue])).toEqual([
      ['Atelier Lumen', 'Déclarer et payer la TVA', 'En retard depuis le 24 septembre, 4 500,00 €', true],
      ['Studio Lumen', 'Déclarer et payer la TVA', 'Avant le 24 octobre, 1 200,00 €', false],
    ])
    expect(home.todo).toEqual([
      { company: { name: 'Atelier Lumen', slug: 'atelier-lumen' }, items: [{ label: '4 opérations bancaires à vérifier', href: '/atelier-lumen/simple/depenses' }, { label: '1 déclaration en retard', href: '/atelier-lumen/simple' }] },
      { company: { name: 'Studio Lumen', slug: 'studio-lumen' }, items: [{ label: '1 opération bancaire à vérifier', href: '/studio-lumen/simple/depenses' }] },
    ])
    expect(home.notes[0]).toBe('1 société du groupe n’est pas comptée : vous n’y avez pas accès.')
  })

  it('uses no accounting jargon', () => {
    const texts = [
      home.earnedTitle,
      ...home.owes.map((o) => o.text),
      ...home.taxes.flatMap((t) => [t.title, t.hint]),
      ...home.todo.flatMap((t) => t.items.map((i) => i.label)),
      ...home.companies.flatMap((c) => [c.ownership, c.nextDeadline?.title ?? '']),
      ...home.flows.map((f) => f.text),
      ...home.notes,
    ]
    expect(texts.flatMap(jargonIn)).toEqual([])
  })
})
