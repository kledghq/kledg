/**
 * Impôts et échéances of the group space (docs/vue-groupe.md): the deadline
 * calendar and the declarations tracker of every company read, for the
 * fiscal year matched to the holding's, summed up by kind
 * (deadline-summary.ts) and listed. The same service as each company's
 * Échéances page (lib/deadlines/load-deadlines.service.ts), read in the
 * company's own scope: a status recorded in a company shows here as there.
 * Read only: statuses are recorded on the company's own page.
 */

import type { GroupAccess } from '@/lib/management-fees/access'
import { loadDeadlinesView } from '@/lib/deadlines/load-deadlines.service'
import type { DeadlineCategory } from '@/lib/deadlines/types'
import type { DeclarationStatusCode } from '@/lib/declarations/status'
import { columnOf, summarizeDeadlines, type ColumnSummary, type DeadlineColumn } from './deadline-summary'
import { periodRef, resolveHoldingFiscalYear, type GroupViewQuery, type PeriodRef } from './get-group-view.service'
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink } from './members'
import type { UnreachableSubsidiary } from './perimeter'
import { matchFiscalYear } from './read-member'

export interface GroupDeadline {
  companyId: string
  id: string
  label: string
  form: string
  category: DeadlineCategory
  column: DeadlineColumn
  date: string
  /** The day after which it is late (online extension included). */
  lateAfter: string
  estimated: boolean
  status: DeclarationStatusCode
  statusLabel: string
  settled: boolean
  amountCents: number | null
}

export interface CompanyDeadlines {
  company: GroupCompanyLink
  fiscalYear: { id: string; year: number; startDate: string; endDate: string } | null
  /** No VAT regime recorded: the VAT deadlines cannot be listed. */
  missingRegimes: boolean
  summary: Record<DeadlineColumn, ColumnSummary>
}

export interface GroupDeadlinesReport {
  holding: { id: string; name: string }
  fiscalYear: PeriodRef
  today: string
  companies: CompanyDeadlines[]
  /** Every deadline of every company read, in date order. */
  deadlines: GroupDeadline[]
  totals: { overdue: number; pending: number; settled: number }
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

export async function getGroupDeadlines(holdingId: string, query: GroupViewQuery, access: GroupAccess, now?: Date): Promise<GroupDeadlinesReport> {
  const fy = await resolveHoldingFiscalYear(holdingId, query.fiscalYearId)
  const read = await readGroupMembers(holdingId, access, async (ref) => {
    const year = await matchFiscalYear(ref.id, fy.startDate, fy.endDate)
    // Without a fiscal year on the period, the company's current one (as its Échéances page).
    return loadDeadlinesView(ref.id, { fiscalYearId: year?.id }, now)
  })
  const companies: CompanyDeadlines[] = read.members.map(({ ref, value }) => ({
    company: linkOf(ref),
    fiscalYear: value.fiscalYear ? { id: value.fiscalYear.id, year: value.fiscalYear.year, startDate: value.fiscalYear.startDate, endDate: value.fiscalYear.endDate } : null,
    missingRegimes: value.missingRegimes,
    summary: summarizeDeadlines(value.deadlines),
  }))
  const deadlines: GroupDeadline[] = read.members
    .flatMap(({ ref, value }) =>
      value.deadlines.map((d) => ({
        companyId: ref.id,
        id: d.id,
        label: d.label,
        form: d.form,
        category: d.category,
        column: columnOf(d),
        date: d.date,
        lateAfter: d.status.lateAfter,
        estimated: d.estimated,
        status: d.status.status,
        statusLabel: d.status.label,
        settled: d.status.settled,
        amountCents: d.status.amountCents,
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, 'fr'))
  const warnings = perimeterWarnings(read.unreachable.length, read.truncated)
  for (const c of companies) {
    if (c.missingRegimes) warnings.push(`${c.company.name} : aucun régime de TVA n’est enregistré, ses échéances de TVA ne sont pas listées.`)
  }
  return {
    holding: { id: read.holding.id, name: read.holding.name },
    fiscalYear: periodRef(fy),
    today: read.members[0]?.value.today ?? periodRef(fy).startDate,
    companies,
    deadlines,
    totals: {
      overdue: deadlines.filter((d) => !d.settled && d.status === 'overdue').length,
      pending: deadlines.filter((d) => !d.settled && d.status !== 'overdue').length,
      settled: deadlines.filter((d) => d.settled).length,
    },
    unreachable: read.unreachable,
    truncated: read.truncated,
    warnings,
  }
}
