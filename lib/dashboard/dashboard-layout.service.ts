/**
 * Personal dashboard layouts (GET, PUT, DELETE /api/dashboard/layout).
 *
 * Invariant: a layout belongs to one user in one company. Every query is
 * keyed by the signed-in user's id and the company the route resolved, so
 * no request can read or write another user's layout; there is no id to
 * pass. What is returned or stored only holds widgets the user may see
 * (lib/dashboard/layout.ts).
 */

import { prisma } from '@/lib/prisma'
import type { Permission } from '@/lib/rbac/authorize'
import { enforceRateLimit } from '@/lib/rate-limit'
import { defaultLayout, parseStoredLayout, sanitizeLayout, toStoredLayout, type DashboardLayoutInput } from './layout'
import { profileOf, widgetPermission, type DashboardProfile, type LayoutItem, type WidgetDefinition } from './widgets'

export interface LayoutAccess {
  /** The user's roles in the company (['admin'] for instance administrators). */
  roles: string[]
  can: (permission: Permission) => boolean
}

export interface DashboardLayoutView {
  items: LayoutItem[]
  /** True when the user never saved a layout (or reset it): the default of their role. */
  isDefault: boolean
  profile: DashboardProfile
}

function allowedBy(access: LayoutAccess) {
  return (widget: WidgetDefinition) => access.can(widgetPermission(widget))
}

function defaultView(access: LayoutAccess): DashboardLayoutView {
  const profile = profileOf(access.roles)
  return { items: defaultLayout(profile, allowedBy(access)), isDefault: true, profile }
}

export async function getDashboardLayout(userId: string, companyId: string, access: LayoutAccess): Promise<DashboardLayoutView> {
  const row = await prisma.dashboardLayout.findUnique({
    where: { userId_companyId: { userId, companyId } },
    select: { layout: true },
  })
  const items = row ? parseStoredLayout(row.layout, allowedBy(access)) : null
  if (!items) return defaultView(access)
  return { items, isDefault: false, profile: profileOf(access.roles) }
}

/** Saves the user's layout; unknown widgets and widgets the user may not see are dropped. */
export async function saveDashboardLayout(
  userId: string,
  companyId: string,
  input: DashboardLayoutInput,
  access: LayoutAccess,
): Promise<DashboardLayoutView> {
  await enforceRateLimit('dashboard-layout', userId)
  const items = sanitizeLayout(input.items, allowedBy(access))
  const layout = toStoredLayout(items)
  await prisma.dashboardLayout.upsert({
    where: { userId_companyId: { userId, companyId } },
    create: { userId, companyId, layout },
    update: { layout },
  })
  return { items, isDefault: false, profile: profileOf(access.roles) }
}

/** Back to the default layout of the user's role: the saved row is removed. */
export async function resetDashboardLayout(userId: string, companyId: string, access: LayoutAccess): Promise<DashboardLayoutView> {
  await enforceRateLimit('dashboard-layout', userId)
  await prisma.dashboardLayout.deleteMany({ where: { userId, companyId } })
  return defaultView(access)
}
