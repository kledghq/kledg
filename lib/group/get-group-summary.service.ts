/**
 * Who the group is, for the switcher and the breadcrumb of the group space
 * (docs/vue-groupe.md): the holding, how many companies the group counts
 * (read and not read) and its main shareholder, whose photo stands for the
 * group (else the holding's logo).
 *
 * The holding's shareholders are rows of the holding, read in the request's
 * scope after the route checked the holding. The subsidiaries are only
 * counted here (perimeter.ts): none is named unless the user reads it.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { COMPANY_NOT_FOUND_MESSAGE } from '@/lib/rbac/authorize'
import type { GroupAccess } from '@/lib/management-fees/access'
import { resolveGroup } from './perimeter'
import { percentToBp } from './periods'

export interface GroupSummary {
  holding: { id: string; slug: string; name: string; legalType: string | null; logo: string | null }
  /** "Groupe <holding>". */
  name: string
  /** Companies of the group the user reads, the holding included. */
  readableCount: number
  /** Subsidiaries not read (no access, role too low, beyond the limit). */
  unreadableCount: number
  /** The holding's largest shareholder, when recorded. */
  mainShareholder: { name: string; photo: string | null; percentBp: number; kind: 'person' | 'company' } | null
}

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
        companyShareholder: { select: { name: true } },
      },
      orderBy: [{ sharePercentage: 'desc' }, { createdAt: 'asc' }],
      take: 1,
    }),
    resolveGroup(holdingId, access),
  ])
  if (!holding) throw new NotFoundError(COMPANY_NOT_FOUND_MESSAGE)
  const top = shareholders[0]
  let mainShareholder: GroupSummary['mainShareholder'] = null
  if (top) {
    const person = top.type === 'PHYSICAL' && top.person ? top.person : null
    const name = person ? `${person.firstName} ${person.usualName || person.name}`.trim() : (top.companyShareholder?.name ?? top.name ?? null)
    if (name) mainShareholder = { name, photo: person?.photo ?? null, percentBp: percentToBp(top.sharePercentage.toString()), kind: person ? 'person' : 'company' }
  }
  return {
    holding: { id: holding.id, slug: holding.slug, name: holding.name, legalType: holding.legalType ?? null, logo: holding.logo },
    name: `Groupe ${holding.name}`,
    readableCount: 1 + perimeter.subsidiaries.length,
    unreadableCount: perimeter.unreachable.length + perimeter.truncated,
    mainShareholder,
  }
}
