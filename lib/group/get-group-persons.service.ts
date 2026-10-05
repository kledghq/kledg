/**
 * Associés et dirigeants of the group space (docs/vue-groupe.md): who holds
 * shares in the companies of the group (natural persons with their photo,
 * companies, other legal persons), their direct holding in each company and
 * their indirect holding through the holding and the other companies of the
 * group (ownership.ts), and the officers recorded in each company's most
 * recent approval of the accounts.
 *
 * Sources and rules:
 * - the cap table of each company read (shareholders, its Informations
 *   page), in that company's own scope; a company not read gives nothing;
 * - personal data is limited to the name and the photo: never the birth
 *   details, the address or the contact (as the capital composition);
 * - one natural person is often recorded once per company (Person rows are
 *   per company): rows are merged by email when there is one, else by the
 *   name, accents and case aside;
 * - a holder that is a subsidiary of the holding the user does not read is
 *   never named nor identified (it appears as "Filiale non accessible"); a
 *   company outside the group is named only when the user reads it.
 */

import { prisma } from '@/lib/prisma'
import type { GroupAccess } from '@/lib/management-fees/access'
import { listSubsidiaryIds } from '@/lib/management-fees/holding'
import { officersOf } from './get-group-companies.service'
import { normalizeName } from './match'
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink } from './members'
import { computeInterests, companyKey, type OwnershipEdge } from './ownership'
import { readIfAllowed, type UnreachableSubsidiary } from './perimeter'
import { percentToBp } from './periods'

export type HolderKind = 'person' | 'company' | 'other' | 'officer'

export interface HolderInterest {
  companyId: string
  directBp: number
  indirectBp: number
  totalBp: number
  /** Shares recorded on the direct rows. */
  shares: number | null
}

export interface GroupHolder {
  /** Unique within the answer only: never an email or the id of a company. */
  holderId: string
  kind: HolderKind
  /** Null for a subsidiary the user does not read. */
  name: string | null
  photo: string | null
  /** When the holder is a company of the group the user reads. */
  groupCompany: GroupCompanyLink | null
  /** Officer titles, per company of the group ("Président"). */
  titles: Array<{ companyId: string; title: string | null }>
  interests: HolderInterest[]
}

export interface GroupPersonsReport {
  holding: { id: string; name: string }
  companies: GroupCompanyLink[]
  holders: GroupHolder[]
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

interface HolderDraft {
  key: string
  kind: HolderKind
  name: string | null
  photo: string | null
  groupCompanyId: string | null
  titles: Array<{ companyId: string; title: string | null }>
  shares: Map<string, number | null>
}

/** Merge key of a natural person: email, else the name without accents nor case. */
export function personKey(person: { email: string | null; firstName: string; name: string; usualName: string | null }): string {
  const email = person.email?.trim().toLowerCase()
  return email ? `person:${email}` : `person:${normalizeName(`${person.firstName} ${person.usualName || person.name}`)}`
}

const fullName = (p: { firstName: string; name: string; usualName: string | null }) => `${p.firstName} ${p.usualName || p.name}`.trim()

export async function getGroupPersons(holdingId: string, access: GroupAccess): Promise<GroupPersonsReport> {
  const read = await readGroupMembers(holdingId, access, async (ref) => {
    const [shareholders, approval] = await Promise.all([
      prisma.shareholder.findMany({
        where: { companyId: ref.id },
        select: {
          type: true,
          name: true,
          siret: true,
          sharePercentage: true,
          numberOfShares: true,
          companyShareholderId: true,
          person: { select: { firstName: true, name: true, usualName: true, email: true, photo: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 500,
      }),
      prisma.accountsApproval.findFirst({ where: { companyId: ref.id }, orderBy: { fiscalYear: { endDate: 'desc' } }, select: { details: true } }),
    ])
    return { shareholders, officers: officersOf(approval?.details) }
  })
  const readable = new Map(read.members.map((m) => [m.ref.id, m.ref]))
  const subsidiaries = new Set(await listSubsidiaryIds(holdingId))

  const drafts = new Map<string, HolderDraft>()
  const edges: OwnershipEdge[] = []
  const outside = new Set<string>()
  const draft = (key: string, init: Omit<HolderDraft, 'key' | 'titles' | 'shares'>) => {
    const existing = drafts.get(key)
    if (existing) {
      existing.photo ??= init.photo
      return existing
    }
    const created: HolderDraft = { key, ...init, titles: [], shares: new Map() }
    drafts.set(key, created)
    return created
  }

  for (const { ref, value } of read.members) {
    for (const row of value.shareholders) {
      const bp = percentToBp(row.sharePercentage.toString())
      let holder: HolderDraft
      if (row.type === 'PHYSICAL' && row.person) {
        holder = draft(personKey(row.person), { kind: 'person', name: fullName(row.person), photo: row.person.photo, groupCompanyId: null })
      } else if (row.companyShareholderId && readable.has(row.companyShareholderId)) {
        const company = readable.get(row.companyShareholderId)!
        holder = draft(companyKey(company.id), { kind: 'company', name: company.name, photo: null, groupCompanyId: company.id })
      } else if (row.companyShareholderId && subsidiaries.has(row.companyShareholderId)) {
        // A subsidiary the user does not read: counted in the chains, never named nor identified.
        holder = draft(companyKey(row.companyShareholderId), { kind: 'company', name: null, photo: null, groupCompanyId: null })
      } else if (row.companyShareholderId) {
        outside.add(row.companyShareholderId)
        holder = draft(companyKey(row.companyShareholderId), { kind: 'company', name: row.name, photo: null, groupCompanyId: null })
      } else {
        const siren = row.siret?.replace(/\s/g, '').slice(0, 9)
        holder = draft(`other:${siren || normalizeName(row.name ?? '')}`, { kind: 'other', name: row.name || 'Actionnaire sans nom', photo: null, groupCompanyId: null })
      }
      const shares = holder.shares.get(ref.id)
      holder.shares.set(ref.id, row.numberOfShares === null ? (shares ?? null) : (shares ?? 0) + row.numberOfShares)
      edges.push({ holderKey: holder.key, companyId: ref.id, bp })
    }
    for (const officer of value.officers) {
      const normalized = normalizeName(officer.name)
      const person = [...drafts.values()].find((d) => d.kind === 'person' && d.name && normalizeName(d.name) === normalized)
      const holder = person ?? draft(`officer:${normalized}`, { kind: 'officer', name: officer.name, photo: null, groupCompanyId: null })
      holder.titles.push({ companyId: ref.id, title: officer.title })
    }
  }

  // Companies outside the group: named when the user reads them, else left as recorded on the row.
  for (const id of outside) {
    const result = await readIfAllowed(access, id, () => prisma.company.findUnique({ where: { id }, select: { name: true } }))
    const holder = drafts.get(companyKey(id))
    if (!holder) continue
    const name = result.ok ? (result.value?.name ?? null) : result.unreachable.name
    holder.name = name ?? holder.name ?? 'Société actionnaire'
  }

  const interests = computeInterests(edges, [...readable.keys()])
  // Keys of the answer are positions: an internal key carries an email or a company id.
  const holders: GroupHolder[] = [...drafts.values()].map((d, index) => {
    const own = interests.get(d.key)
    return {
      holderId: `holder-${index + 1}`,
      kind: d.kind,
      name: d.name,
      photo: d.photo,
      groupCompany: d.groupCompanyId ? linkOf(readable.get(d.groupCompanyId)!) : null,
      titles: d.titles,
      interests: [...(own?.entries() ?? [])]
        .map(([companyId, i]) => ({ companyId, ...i, shares: d.shares.get(companyId) ?? null }))
        .sort((a, b) => b.totalBp - a.totalBp),
    }
  })
  const rank = (h: GroupHolder) => (h.kind === 'person' ? 0 : h.kind === 'officer' ? 1 : h.kind === 'company' ? 2 : 3)
  const best = (h: GroupHolder) => Math.max(0, ...h.interests.map((i) => i.totalBp))
  holders.sort((a, b) => rank(a) - rank(b) || best(b) - best(a) || (a.name ?? '￿').localeCompare(b.name ?? '￿', 'fr'))

  const warnings = perimeterWarnings(read.unreachable.length, read.truncated)
  if (read.unreachable.length > 0) warnings.push('Les associés des filiales non lues ne sont pas connus : les pourcentages indirects qui passent par elles manquent.')
  return {
    holding: { id: read.holding.id, name: read.holding.name },
    companies: read.members.map((m) => linkOf(m.ref)),
    holders,
    unreachable: read.unreachable,
    truncated: read.truncated,
    warnings,
  }
}
