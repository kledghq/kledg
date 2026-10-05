/**
 * Accueil du groupe, Mes sociétés and Argent entre mes sociétés of the
 * group space in simple mode (docs/vue-groupe.md): the reports of the
 * expert views (vue combinée, trésorerie, échéances, alertes), read with
 * the same rules (each company checked, a subsidiary not read counted and
 * never named), then said in plain words (simple-home.ts). No figure is
 * computed here: the simple pages show what the expert views show.
 */

import type { GroupAccess } from '@/lib/management-fees/access'
import { prisma } from '@/lib/prisma'
import { calendarDayOf, todayUtc } from '@/lib/utils/date'
import { getGroupAlerts } from './get-group-alerts.service'
import { getGroupDeadlines } from './get-group-deadlines.service'
import { getGroupTreasury } from './get-group-treasury.service'
import { getGroupView, type GroupViewQuery } from './get-group-view.service'
import { buildSimpleGroupHome, type SimpleGroupHome } from './simple-home'

export async function getSimpleGroupHome(holdingId: string, query: GroupViewQuery, access: GroupAccess, now?: Date): Promise<SimpleGroupHome> {
  const view = await getGroupView(holdingId, query, access)
  const treasury = await getGroupTreasury(holdingId, query, access)
  const deadlines = await getGroupDeadlines(holdingId, query, access, now)
  const alerts = await getGroupAlerts(holdingId, access, now)
  // The holding was checked by the route: its slug for the links.
  const holding = await prisma.company.findUnique({ where: { id: holdingId }, select: { slug: true } })
  return buildSimpleGroupHome({ view, treasury, deadlines, alerts, today: calendarDayOf(todayUtc(now)) as string, holdingSlug: holding?.slug ?? holdingId })
}
