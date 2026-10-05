/**
 * The group space in simple mode (docs/vue-groupe.md, docs/mode-simple.md):
 * the same figures as the expert views, said in plain words. Pure: every
 * figure comes from a report the expert views already show (vue combinée,
 * trésorerie, échéances, alertes), and the tests compare them to the cent.
 * No account number nor accounting term (SIMPLE_MODE_JARGON): sentences
 * come from lib/simple/vocabulary.ts and flows.ts.
 */

import { addIsoDays } from '@/lib/utils/date'
import { formatCentsFr } from '@/lib/utils/money'
import { declarationHint, declarationTitle, profitTitle } from '@/lib/simple/vocabulary'
import { plural } from '@/lib/utils/plural'
import type { GroupAlerts } from './get-group-alerts.service'
import type { GroupDeadlinesReport } from './get-group-deadlines.service'
import type { GroupTreasuryReport } from './get-group-treasury.service'
import type { GroupView } from './get-group-view.service'
import { flowSentence, moneyFlows, monthsElapsed, oweSentence, type MoneyFlowKind } from './flows'

export interface SimpleGroupCompany {
  id: string
  name: string
  slug: string
  role: 'holding' | 'subsidiary'
  /** "Détenue à 80 % par Lumen Holding", "Société de tête". */
  ownership: string
  /** Money on the bank accounts (euros), as the bank last reported it. */
  moneyCents: number
  /** Sales and profit since the start of the year, null without books on the period. */
  salesCents: number | null
  profitCents: number | null
  nextDeadline: { title: string; date: string; overdue: boolean } | null
}

export interface SimpleGroupHome {
  holding: { id: string; name: string; slug: string }
  groupName: string
  /** Start of the holding's year, for "depuis janvier". */
  since: string
  moneyCents: number
  /** "Bénéfice depuis janvier" or "Perte depuis janvier". */
  earnedTitle: string
  earnedCents: number
  owes: Array<{ text: string; cents: number }>
  taxes: Array<{ companyName: string; slug: string; title: string; hint: string; overdue: boolean; date: string }>
  todo: Array<{ company: { name: string; slug: string }; items: Array<{ label: string; href: string }> }>
  companies: SimpleGroupCompany[]
  flows: Array<{ kind: MoneyFlowKind; text: string; cents: number }>
  /** Plain notes: companies not read, figures added up without the money that stays inside the group. */
  notes: string[]
}

export const SIMPLE_GROUP_LABELS = {
  home: 'Accueil du groupe',
  companies: 'Mes sociétés',
  structure: 'Qui possède quoi',
  flows: 'Argent entre mes sociétés',
  money: 'Argent sur les comptes du groupe',
  owes: 'Qui doit quoi à qui dans le groupe',
  taxes: 'Impôts et déclarations à venir',
  todo: 'À faire dans chaque société',
} as const

const TAX_HORIZON_DAYS = 45

export function buildSimpleGroupHome(input: { view: GroupView; treasury: GroupTreasuryReport; deadlines: GroupDeadlinesReport; alerts: GroupAlerts; today: string; holdingSlug: string }): SimpleGroupHome {
  const { view, treasury, deadlines, alerts, today } = input
  const names = new Map(view.members.map((m) => [m.id, m.name]))
  const slugs = new Map(view.members.map((m) => [m.id, m.slug]))
  const since = view.fiscalYear.startDate
  const months = monthsElapsed(view.fiscalYear.startDate, view.fiscalYear.endDate, today)
  const flows = moneyFlows(view.eliminations)

  const limit = addIsoDays(today, TAX_HORIZON_DAYS)
  const open = deadlines.deadlines.filter((d) => !d.settled && (d.status === 'overdue' || (d.date >= today && d.date <= limit)))
  const taxes = open.slice(0, 8).map((d) => {
    const overdue = d.status === 'overdue'
    return {
      companyName: names.get(d.companyId) ?? deadlines.companies.find((c) => c.company.id === d.companyId)?.company.name ?? 'Société du groupe',
      slug: slugs.get(d.companyId) ?? deadlines.companies.find((c) => c.company.id === d.companyId)?.company.slug ?? '',
      title: declarationTitle(d.id.split(':')[0]),
      hint: declarationHint(overdue ? 'overdue' : d.status === 'filed' ? 'filed' : 'todo', d.date, d.amountCents ? formatCentsFr(d.amountCents) : null),
      overdue,
      date: d.date,
    }
  })

  const todo = alerts.companies.flatMap((c) => {
    const items: Array<{ label: string; href: string }> = []
    if (c.unreconciled > 0) items.push({ label: `${plural(c.unreconciled, 'opération bancaire', 'opérations bancaires')} à vérifier`, href: `/${c.company.slug}/simple/depenses` })
    if (c.overdue > 0) items.push({ label: `${plural(c.overdue, 'déclaration', 'déclarations')} en retard`, href: `/${c.company.slug}/simple` })
    return items.length > 0 ? [{ company: { name: c.company.name, slug: c.company.slug }, items }] : []
  })

  const bankOf = new Map(treasury.companies.map((c) => [c.company.id, c.bankEurCents]))
  const companies: SimpleGroupCompany[] = view.members.map((m) => {
    const next = deadlines.deadlines.find((d) => d.companyId === m.id && !d.settled && (d.status === 'overdue' || d.date >= today)) ?? null
    return {
      id: m.id,
      name: m.name,
      slug: m.slug,
      role: m.role,
      ownership: m.role === 'holding' ? 'Société de tête du groupe' : `Détenue à ${m.ownershipBp === null ? '?' : `${(m.ownershipBp / 100).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} %`} par ${view.holding.name}`,
      moneyCents: bankOf.get(m.id) ?? 0,
      salesCents: m.figures?.chiffreAffairesCents ?? null,
      profitCents: m.figures?.resultatCents ?? null,
      nextDeadline: next ? { title: declarationTitle(next.id.split(':')[0]), date: next.date, overdue: next.status === 'overdue' } : null,
    }
  })

  const notes: string[] = []
  const hidden = view.unreachable.length + view.truncated
  if (hidden > 0) notes.push(`${plural(hidden, 'société du groupe n’est pas comptée', 'sociétés du groupe ne sont pas comptées')}\u00a0: vous n’y avez pas accès.`)
  if (flows.some((f) => f.nature === 'period')) notes.push('L’argent qui circule entre vos sociétés ne compte qu’une fois dans ce que gagne le groupe.')

  const eur = treasury.totalsByCurrency.find((t) => t.currency === 'EUR')
  return {
    holding: { id: view.holding.id, name: view.holding.name, slug: input.holdingSlug },
    groupName: `Groupe ${view.holding.name}`,
    since,
    moneyCents: eur?.balanceCents ?? 0,
    earnedTitle: profitTitle(view.afterEliminations.resultatCents, since),
    earnedCents: view.afterEliminations.resultatCents,
    owes: flows.filter((f) => f.nature === 'balance').map((f) => ({ text: oweSentence(f, names), cents: f.cents })),
    taxes,
    todo,
    companies,
    flows: flows.map((f) => ({ kind: f.kind, text: flowSentence(f, names, months), cents: f.cents })),
    notes,
  }
}
