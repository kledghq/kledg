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
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink, type GroupMembers } from './members'
import { computeInterests, companyKey, type OwnershipEdge } from './ownership'
import { readIfAllowed, type GroupMemberRef, type UnreachableSubsidiary } from './perimeter'
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

export interface HolderDraft {
  key: string
  kind: HolderKind
  name: string | null
  /** A subsidiary of the holding the user does not read. */
  hidden: boolean
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

/** An outside shareholder company the user may not read (KLEDG-R3-AUTHZ-08). */
export const OUTSIDE_COMPANY_LABEL = 'Société actionnaire'

const fullName = (p: { firstName: string; name: string; usualName: string | null }) => `${p.firstName} ${p.usualName || p.name}`.trim()

/** What the cap tables of the companies read say, with internal keys: shared by Associés et dirigeants and the structure diagram. */
export interface CollectedHolders {
  read: GroupMembers<MemberCapTable>
  readable: Map<string, GroupMemberRef>
  /** Every subsidiary of the holding, read or not (ids stay on the server). */
  subsidiaries: Set<string>
  drafts: Map<string, HolderDraft>
  edges: OwnershipEdge[]
}

export interface MemberCapTable {
  shareholders: Array<{
    type: string
    name: string | null
    siret: string | null
    sharePercentage: { toString(): string }
    numberOfShares: number | null
    companyShareholderId: string | null
    person: { firstName: string; name: string; usualName: string | null; email: string | null; photo: string | null } | null
  }>
  officers: Array<{ name: string; title: string | null }>
  company: { logo: string | null; legalType: string | null } | null
}

export async function collectGroupHolders(holdingId: string, access: GroupAccess): Promise<CollectedHolders> {
  const read = await readGroupMembers(holdingId, access, async (ref): Promise<MemberCapTable> => {
    const [shareholders, approval, company] = await Promise.all([
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
      prisma.company.findUnique({ where: { id: ref.id }, select: { logo: true, legalType: true } }),
    ])
    return { shareholders, officers: officersOf(approval?.details), company }
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
        holder = draft(personKey(row.person), { kind: 'person', name: fullName(row.person), photo: row.person.photo, groupCompanyId: null, hidden: false })
      } else if (row.companyShareholderId && readable.has(row.companyShareholderId)) {
        const company = readable.get(row.companyShareholderId)!
        holder = draft(companyKey(company.id), { kind: 'company', name: company.name, photo: null, groupCompanyId: company.id, hidden: false })
      } else if (row.companyShareholderId && subsidiaries.has(row.companyShareholderId)) {
        // A subsidiary the user does not read: counted in the chains, never named nor identified.
        holder = draft(companyKey(row.companyShareholderId), { kind: 'company', name: null, photo: null, groupCompanyId: null, hidden: true })
      } else if (row.companyShareholderId) {
        outside.add(row.companyShareholderId)
        // Never named from the row's stored name: only from the company itself, when the user may (below).
        holder = draft(companyKey(row.companyShareholderId), { kind: 'company', name: null, photo: null, groupCompanyId: null, hidden: false })
      } else {
        const siren = row.siret?.replace(/\s/g, '').slice(0, 9)
        holder = draft(`other:${siren || normalizeName(row.name ?? '')}`, { kind: 'other', name: row.name || 'Actionnaire sans nom', photo: null, groupCompanyId: null, hidden: false })
      }
      const shares = holder.shares.get(ref.id)
      holder.shares.set(ref.id, row.numberOfShares === null ? (shares ?? null) : (shares ?? 0) + row.numberOfShares)
      edges.push({ holderKey: holder.key, companyId: ref.id, bp })
    }
    for (const officer of value.officers) {
      const normalized = normalizeName(officer.name)
      const person = [...drafts.values()].find((d) => d.kind === 'person' && d.name && normalizeName(d.name) === normalized)
      const holder = person ?? draft(`officer:${normalized}`, { kind: 'officer', name: officer.name, photo: null, groupCompanyId: null, hidden: false })
      holder.titles.push({ companyId: ref.id, title: officer.title })
    }
  }

  // Companies outside the group: named when the user reads them (or is a member there, whose name is
  // theirs to see), else "Société actionnaire": never from the name stored on the shareholder row,
  // a snapshot of a company the user may not read (KLEDG-R3-AUTHZ-08).
  for (const id of outside) {
    const result = await readIfAllowed(access, id, () => prisma.company.findUnique({ where: { id }, select: { name: true } }))
    const holder = drafts.get(companyKey(id))
    if (!holder) continue
    const name = result.ok ? (result.value?.name ?? null) : result.unreachable.name
    holder.name = name ?? OUTSIDE_COMPANY_LABEL
  }
  return { read, readable, subsidiaries, drafts, edges }
}

export async function getGroupPersons(holdingId: string, access: GroupAccess): Promise<GroupPersonsReport> {
  const { read, readable, drafts, edges } = await collectGroupHolders(holdingId, access)
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
