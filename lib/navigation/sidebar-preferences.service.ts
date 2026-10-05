/**
 * Personal sidebar menus (GET and PUT /api/companies/[id]/sidebar-preferences,
 * the company layout). docs/modes-et-menu.md.
 *
 * Invariant: a menu belongs to one user in one company. Every query is keyed
 * by the signed-in user's id and the company the route resolved (or the
 * companies the layout listed for that user), so no request reads or writes
 * another user's menu; there is no id to pass. Row level security enforces
 * the same (sidebar_preferences is a "company and user" table, docs/rls.md).
 * Callers hand sanitized ids (components/layout/sidebar-menu.ts).
 */

import { prisma } from '@/lib/prisma'
import { enforceRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { withUserContext } from '@/lib/rls/context'
import type { CurrentUser } from '@/lib/session'
import { isNothingHidden, NOTHING_HIDDEN, type SidebarHidden } from './sidebar-preferences'

/** Companies listed at most (the company switcher lists the user's companies). */
const MAX_COMPANIES = 500

export async function getSidebarPreferences(userId: string, companyId: string): Promise<SidebarHidden> {
  const row = await prisma.sidebarPreference.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { hiddenItems: true, hiddenGroups: true },
  })
  return row ?? NOTHING_HIDDEN
}

/** Saves the user's menu in the company; nothing hidden removes the row (the whole menu again). */
export async function saveSidebarPreferences(userId: string, companyId: string, hidden: SidebarHidden): Promise<SidebarHidden> {
  // A toggle saves at once: the dashboard's budget, per user.
  await enforceRateLimit('sidebar-preferences', userId)
  if (isNothingHidden(hidden)) {
    await prisma.sidebarPreference.deleteMany({ where: { userId, companyId } })
    return { hiddenItems: [], hiddenGroups: [] }
  }
  const data = { hiddenItems: hidden.hiddenItems, hiddenGroups: hidden.hiddenGroups }
  await prisma.sidebarPreference.upsert({
    where: { userId_companyId: { userId, companyId } },
    create: { userId, companyId, ...data },
    update: data,
  })
  return data
}

/**
 * The user's menus in the companies of the switcher, by company id and slug
 * (the URL holds either), for the company layout. Companies without a row
 * are left out. A database error must not break every page: the whole menu
 * then shows.
 */
export async function listSidebarPreferences(
  user: Pick<CurrentUser, 'id'>,
  companies: ReadonlyArray<{ id: string; slug: string | null }>,
): Promise<Record<string, SidebarHidden>> {
  if (companies.length === 0) return {}
  const companyIds = companies.map((company) => company.id)
  try {
    const rows = await withUserContext(
      user.id,
      () =>
        prisma.sidebarPreference.findMany({
          where: { userId: user.id, companyId: { in: companyIds } },
          select: { companyId: true, hiddenItems: true, hiddenGroups: true },
          take: MAX_COMPANIES,
        }),
      { companyIds },
    )
    const byRef: Record<string, SidebarHidden> = {}
    for (const row of rows) {
      const hidden = { hiddenItems: row.hiddenItems, hiddenGroups: row.hiddenGroups }
      byRef[row.companyId] = hidden
      const slug = companies.find((company) => company.id === row.companyId)?.slug
      if (slug) byRef[slug] = hidden
    }
    return byRef
  } catch (error) {
    logger.warn('Sidebar preferences not loaded, whole menu shown:', (error as Error).message)
    return {}
  }
}
