/**
 * Sociétés of the group space (docs/vue-groupe.md): each company of the
 * group the user reads, with its legal form, the holding's stake, its
 * officers and its key figures for the holding's fiscal year (the same
 * figures as the vue combinée, read-member.ts), and the slug that links
 * into its own pages.
 *
 * Officers: Kledg records them in the approval of the accounts
 * (lib/approval, details.officers: name and title); the most recent
 * approval is read. A company without approval shows none. An officer who
 * is also an associé of the company (same name) shows the associé's photo.
 */

import { prisma } from '@/lib/prisma'
import type { GroupAccess } from '@/lib/management-fees/access'
import { loadStatementAccounts } from '@/lib/reports/statements/load'
import { formatIsoDateFr } from '@/lib/utils/date'
import { parseCents } from '@/lib/utils/money'
import type { KeyFigures } from './combine'
import { periodRef, resolveHoldingFiscalYear, type GroupViewQuery, type PeriodRef } from './get-group-view.service'
import { normalizeName } from './match'
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink } from './members'
import type { UnreachableSubsidiary } from './perimeter'
import { samePeriod } from './periods'
import { figuresOf, matchFiscalYear } from './read-member'

export interface Officer {
  name: string
  title: string | null
  /** Photo of the associé of the same name, when the officer is one (Person.photo). */
  photo?: string | null
}

export interface GroupCompany {
  company: GroupCompanyLink
  siren: string
  legalType: string | null
  legalForm: string | null
  logo: string | null
  /** Capital social of the company record, in cents. */
  shareCapitalCents: number | null
  numberOfShares: number | null
  officers: Officer[]
  fiscalYear: PeriodRef | null
  samePeriod: boolean
  figures: KeyFigures | null
}

export interface GroupCompaniesReport {
  holding: { id: string; name: string }
  fiscalYear: PeriodRef
  companies: GroupCompany[]
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

/** The officers of an approval's details (lib/approval/schemas.ts), the malformed ones left out. */
export function officersOf(details: unknown): Officer[] {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return []
  const list = (details as Record<string, unknown>).officers
  if (!Array.isArray(list)) return []
  return list.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const { name, title } = item as Record<string, unknown>
    return typeof name === 'string' && name.trim() ? [{ name: name.trim(), title: typeof title === 'string' && title.trim() ? title.trim() : null }] : []
  })
}

export async function getGroupCompanies(holdingId: string, query: GroupViewQuery, access: GroupAccess): Promise<GroupCompaniesReport> {
  const fy = await resolveHoldingFiscalYear(holdingId, query.fiscalYearId)
  const read = await readGroupMembers(holdingId, access, async (ref) => {
    const [company, approval, year, persons] = await Promise.all([
      prisma.company.findUnique({
        where: { id: ref.id },
        select: { siren: true, legalType: true, legalForm: true, logo: true, shareCapital: true, totalShares: true },
      }),
      prisma.accountsApproval.findFirst({ where: { companyId: ref.id }, orderBy: { fiscalYear: { endDate: 'desc' } }, select: { details: true } }),
      matchFiscalYear(ref.id, fy.startDate, fy.endDate),
      prisma.shareholder.findMany({
        where: { companyId: ref.id, type: 'PHYSICAL', person: { photo: { not: null } } },
        select: { person: { select: { firstName: true, name: true, usualName: true, photo: true } } },
        take: 100,
      }),
    ])
    const photos = new Map(persons.flatMap((s) => (s.person ? [[normalizeName(`${s.person.firstName} ${s.person.usualName || s.person.name}`), s.person.photo]] : [])))
    const officers = officersOf(approval?.details).map((o) => ({ ...o, photo: photos.get(normalizeName(o.name)) ?? null }))
    const accounts = year ? await loadStatementAccounts(ref.id, year) : null
    return { company, officers, year, figures: year && accounts ? figuresOf(ref.id, year.id, accounts) : null }
  })
  const companies: GroupCompany[] = read.members.flatMap(({ ref, value }) =>
    value.company
      ? [
          {
            company: linkOf(ref),
            siren: value.company.siren,
            legalType: value.company.legalType ?? null,
            legalForm: value.company.legalForm,
            logo: value.company.logo,
            shareCapitalCents: value.company.shareCapital === null ? null : parseCents(value.company.shareCapital),
            numberOfShares: value.company.totalShares,
            officers: value.officers,
            fiscalYear: value.year ? periodRef(value.year) : null,
            samePeriod: value.year ? samePeriod(value.year, fy.startDate, fy.endDate) : false,
            figures: value.figures,
          },
        ]
      : [],
  )
  const warnings = perimeterWarnings(read.unreachable.length, read.truncated)
  for (const c of companies) {
    if (!c.fiscalYear) warnings.push(`${c.company.name} n’a pas d’exercice qui couvre cette période.`)
    else if (!c.samePeriod) warnings.push(`${c.company.name} : l’exercice lu va du ${formatIsoDateFr(c.fiscalYear.startDate)} au ${formatIsoDateFr(c.fiscalYear.endDate)}.`)
  }
  return { holding: { id: read.holding.id, name: read.holding.name }, fiscalYear: periodRef(fy), companies, unreachable: read.unreachable, truncated: read.truncated, warnings }
}
