/**
 * Reads the same thing in every company of a group (the group space,
 * docs/vue-groupe.md): the holding first, then each subsidiary the user may
 * read, by name. One loop for every screen, so the rule of perimeter.ts
 * holds everywhere:
 * - a subsidiary out of reach is counted, never read nor named;
 * - a subsidiary where the role is too low is named, not read;
 * - each read runs in the company's own row level security scope, after the
 *   access check (readIfAllowed), never in a system context.
 *
 * The holding is read the same way: the route or the tool already checked
 * it, reading it again in its own scope costs one check and keeps one path.
 */

import { MAX_GROUP_SUBSIDIARIES } from '@/lib/management-fees/holding'
import type { GroupAccess } from '@/lib/management-fees/access'
import { plural } from '@/lib/utils/plural'
import { readIfAllowed, resolveGroup, type GroupMemberRef, type UnreachableSubsidiary } from './perimeter'

export interface MemberRead<T> {
  ref: GroupMemberRef
  value: T
}

export interface GroupMembers<T> {
  holding: GroupMemberRef
  /** The holding, then the readable subsidiaries by name, with what was read in each. */
  members: Array<MemberRead<T>>
  unreachable: UnreachableSubsidiary[]
  /** Subsidiaries beyond MAX_GROUP_SUBSIDIARIES, not read. */
  truncated: number
}

/** Runs `read` in the scope of every company of the group the user may read. */
export async function readGroupMembers<T>(holdingId: string, access: GroupAccess, read: (ref: GroupMemberRef) => Promise<T>): Promise<GroupMembers<T>> {
  const perimeter = await resolveGroup(holdingId, access)
  const members: Array<MemberRead<T>> = []
  const unreachable = [...perimeter.unreachable]
  // One company after the other, each in its own scope: a handful of companies, not a list of rows.
  for (const ref of [perimeter.holding, ...perimeter.subsidiaries]) {
    const result = await readIfAllowed(access, ref.id, () => read(ref))
    if (result.ok) members.push({ ref, value: result.value })
    else unreachable.push(result.unreachable)
  }
  return { holding: perimeter.holding, members, unreachable, truncated: perimeter.truncated }
}

/** The French warnings about the subsidiaries a screen of the group space could not read. */
export function perimeterWarnings(unreachable: number, truncated: number): string[] {
  const warnings: string[] = []
  if (unreachable === 1) warnings.push('Une filiale n’est pas lue, faute d’accès : elle n’apparaît pas sur cette page.')
  else if (unreachable > 1) warnings.push(`${unreachable} filiales ne sont pas lues, faute d’accès : elles n’apparaissent pas sur cette page.`)
  if (truncated > 0) {
    warnings.push(`${plural(truncated, 'autre filiale n’est pas lue', 'autres filiales ne sont pas lues')} : l’espace groupe lit au plus ${MAX_GROUP_SUBSIDIARIES} filiales.`)
  }
  return warnings
}

/** Reference of a company of the group in an answer: what a page needs to name it and link into it. */
export interface GroupCompanyLink {
  id: string
  name: string
  slug: string
  role: 'holding' | 'subsidiary'
  /** The holding's stake in basis points (6000 = 60 %), for a subsidiary. */
  ownershipBp: number | null
}

export function linkOf(ref: GroupMemberRef): GroupCompanyLink {
  return { id: ref.id, name: ref.name, slug: ref.slug, role: ref.role, ownershipBp: ref.stake?.percentBp ?? null }
}
