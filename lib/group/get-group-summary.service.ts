/**
 * Who the group is, for the switcher and the breadcrumb of the group space
 * (docs/vue-groupe.md): the holding, how many companies the group counts
 * (read and not read) and the holding's shareholders, shown as an avatar
 * stack in the switcher and the header of the views (else the holding's
 * logo). A company shareholder is shown only when the user reads it.
 *
 * The holding's shareholders are rows of the holding, read in the request's
 * scope after the route checked the holding. The subsidiaries are only
 * counted here (perimeter.ts): none is named unless the user reads it.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { COMPANY_NOT_FOUND_MESSAGE } from '@/lib/rbac/authorize'
import type { GroupAccess } from '@/lib/management-fees/access'
import { readIfAllowed, resolveGroup } from './perimeter'
import { percentToBp } from './periods'

export interface GroupSummary {
  holding: { id: string; slug: string; name: string; legalType: string | null; logo: string | null }
  /** "Groupe <holding>". */
  name: string
  /** Companies of the group the user reads, the holding included. */
  readableCount: number
  /** Subsidiaries not read (no access, role too low, beyond the limit). */
  unreadableCount: number
  /**
   * The holding's shareholders the user may see, largest stake first (the
   * avatar stack of the switcher and of the group views): natural persons
   * with their photo, companies with their logo when the user reads them.
   * A company shareholder the user cannot read, or a row without a name,
   * is left out.
   */
  shareholders: GroupShareholder[]
}

export interface GroupShareholder {
  name: string
  /** Photo of a person, logo of a company. */
  photo: string | null
  percentBp: number
  kind: 'person' | 'company'
}

/** Shareholders of the holding listed at most (the stack shows three and "+N"). */
export const MAX_SUMMARY_SHAREHOLDERS = 20

export async function getGroupSummary(holdingId: string, access: GroupAccess): Promise<GroupSummary> {
  const [holding, shareholders, perimeter] = await Promise.all([
    prisma.company.findUnique({ where: { id: holdingId }, select: { id: true, slug: true, name: true, legalType: true, logo: true } }),
    prisma.shareholder.findMany({
      where: { companyId: holdingId },
      select: {
        type: true,
        name: true,
        sharePercentage: true,
        person: { select: { firstName: true, name: true, usualName: true, photo: true } },
        companyShareholderId: true,
      },
      orderBy: [{ sharePercentage: 'desc' }, { createdAt: 'asc' }],
      take: MAX_SUMMARY_SHAREHOLDERS,
    }),
    resolveGroup(holdingId, access),
  ])
  if (!holding) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  const list: GroupShareholder[] = []
  for (const row of shareholders) {
    const percentBp = percentToBp(row.sharePercentage.toString())
    const person = row.type === 'PHYSICAL' && row.person ? row.person : null
    if (person) {
      const name = `${person.firstName} ${person.usualName || person.name}`.trim()
      if (name) list.push({ name, photo: person.photo ?? null, percentBp, kind: 'person' })
      continue
    }
    if (row.companyShareholderId) {
      // A company of the instance: shown only when the user reads it, with its own name and logo.
      const id = row.companyShareholderId
      const read = await readIfAllowed(access, id, () => prisma.company.findUnique({ where: { id }, select: { name: true, logo: true } }))
      if (read.ok && read.value) list.push({ name: read.value.name, photo: read.value.logo ?? null, percentBp, kind: 'company' })
      continue
    }
    if (row.name?.trim()) list.push({ name: row.name.trim(), photo: null, percentBp, kind: 'company' })
  }
  list.sort((a, b) => b.percentBp - a.percentBp)
  return {
    holding: { id: holding.id, slug: holding.slug, name: holding.name, legalType: holding.legalType ?? null, logo: holding.logo },
    name: `Groupe ${holding.name}`,
    readableCount: 1 + perimeter.subsidiaries.length,
    unreadableCount: perimeter.unreachable.length + perimeter.truncated,
    shareholders: list,
  }
}
