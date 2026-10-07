/**
 * The perimeter of a group view: the holding and its subsidiaries (one
 * definition, lib/management-fees/holding.ts: the companies that record the
 * holding among their shareholders), split into those the user may read and
 * those they may not.
 *
 * Invariants owned here:
 * - every subsidiary is checked with the user's own role there
 *   (reports:read, or reports:export for an export: GroupAccess.readPermission),
 *   through a GroupAccess: the web routes build it from the
 *   user's roles, the MCP tools from their company guard, which also applies
 *   the connection's company grant (lib/management-fees/access.ts);
 * - a subsidiary out of reach (not a member, outside an assistant's grant)
 *   is counted, never read: neither its name nor its id leaves the server;
 *   a subsidiary where the user's role is too low is named (the user is a
 *   member of it) and not read either;
 * - reads of a reachable subsidiary run in its own row level security
 *   scope (inCompany), never in a system context.
 */

import { ForbiddenError, NotFoundError } from '@/lib/accounting/errors'
import { prisma } from '@/lib/prisma'
import { COMPANY_NOT_FOUND_MESSAGE } from '@/lib/rbac/authorize'
import { withUserContext } from '@/lib/rls/context'
import { inCompany, type GroupAccess } from '@/lib/management-fees/access'
import { listSubsidiaryIds, MAX_GROUP_SUBSIDIARIES } from '@/lib/management-fees/holding'
import type { GroupCompanyRef } from './match'
import { readStake, type Stake } from './read-member'

export const GROUP_READ = { reports: ['read'] } as const
/** An export of the group space takes each company's figures out of Kledg: the right to export them, in each one. */
export const GROUP_EXPORT = { reports: ['export'] } as const

/** The same access, reading only the companies where the user may export (KLEDG-R3-AUTHZ-04). */
export function exportAccess(access: GroupAccess): GroupAccess {
  return { ...access, readPermission: GROUP_EXPORT }
}

export interface GroupMemberRef extends GroupCompanyRef {
  /** The company's slug, for links into its own pages. */
  slug: string
  role: 'holding' | 'subsidiary'
  /** The holding's stake, for a subsidiary. */
  stake: Stake | null
}

export interface UnreachableSubsidiary {
  /** Null when the user is not a member (or the assistant was not granted it): the company is not named. */
  name: string | null
  reason: 'out_of_reach' | 'role'
}

export interface GroupPerimeter {
  holding: GroupMemberRef
  /** Reachable subsidiaries, by name. */
  subsidiaries: GroupMemberRef[]
  unreachable: UnreachableSubsidiary[]
  /** Subsidiaries beyond MAX_GROUP_SUBSIDIARIES, not read. */
  truncated: number
}

/** Runs `fn` in the scope of `companyId` after the access check; null when the company may not be read, with why. */
export async function readIfAllowed<T>(
  access: GroupAccess,
  companyId: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; unreachable: UnreachableSubsidiary }> {
  try {
    return { ok: true, value: await inCompany(access, companyId, access.readPermission ?? GROUP_READ, fn) }
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, unreachable: { name: null, reason: 'out_of_reach' } }
    if (error instanceof ForbiddenError) {
      // A 403 means the user is a member there (lib/rbac/authorize.ts): the name is theirs to see.
      const company = await withUserContext(access.userId, () => prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }), { companyIds: [companyId] })
      return { ok: false, unreachable: { name: company?.name ?? null, reason: 'role' } }
    }
    throw error
  }
}

/** The holding (already authorized by the route or tool) and its subsidiaries, each checked. */
export async function resolveGroup(holdingId: string, access: GroupAccess): Promise<GroupPerimeter> {
  const [holding, ids] = await Promise.all([
    prisma.company.findUnique({ where: { id: holdingId }, select: { id: true, name: true, siren: true, slug: true } }),
    listSubsidiaryIds(holdingId),
  ])
  if (!holding) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  const subsidiaries: GroupMemberRef[] = []
  const unreachable: UnreachableSubsidiary[] = []
  // One check per subsidiary, each in its own scope: a handful of companies, not a list of rows.
  for (const id of ids.slice(0, MAX_GROUP_SUBSIDIARIES)) {
    const read = await readIfAllowed(access, id, async () => {
      const [company, stake] = await Promise.all([
        prisma.company.findUnique({ where: { id }, select: { id: true, name: true, siren: true, slug: true } }),
        readStake(id, holdingId),
      ])
      return company ? { ...company, stake } : null
    })
    if (!read.ok) unreachable.push(read.unreachable)
    else if (read.value) subsidiaries.push({ ...read.value, role: 'subsidiary' })
  }
  subsidiaries.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  unreachable.sort((a, b) => (a.name ?? '￿').localeCompare(b.name ?? '￿', 'fr'))
  return {
    holding: { ...holding, role: 'holding', stake: null },
    subsidiaries,
    unreachable,
    truncated: Math.max(0, ids.length - MAX_GROUP_SUBSIDIARIES),
  }
}
