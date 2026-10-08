/**
 * What needs attention across the group (Vue d'ensemble of the group space,
 * docs/vue-groupe.md): for each company the user reads, the declarations of
 * the tracker that are late (lib/deadlines, lib/declarations), the bank
 * transactions still to reconcile and the draft entries. The same figures
 * as each company's own Échéances page and to-do indicator: the services
 * are reused, read in the company's own scope (members.ts).
 */

import { prisma } from '@/lib/prisma'
import type { GroupAccess } from '@/lib/management-fees/access'
import { loadDeadlinesWidget } from '@/lib/deadlines/load-deadlines.service'
import type { DeadlineCategory } from '@/lib/deadlines/types'
import { countCompanyTasks } from '@/lib/tasks/count-tasks.service'
import { linkOf, perimeterWarnings, readGroupMembers, type GroupCompanyLink } from './members'
import { GROUP_BANK_READ, GROUP_ENTRIES_READ, mergePermissions, type UnreachableSubsidiary } from './perimeter'

export interface OverdueDeclaration {
  companyId: string
  deadlineId: string
  label: string
  form: string
  category: DeadlineCategory
  /** Day it was due (yyyy-mm-dd), or the online extension. */
  date: string
}

export interface CompanyAlerts {
  company: GroupCompanyLink
  overdue: number
  unreconciled: number
  drafts: number
}

export interface GroupAlerts {
  companies: CompanyAlerts[]
  /** Late declarations of every company read, oldest first. */
  overdue: OverdueDeclaration[]
  totals: { overdue: number; unreconciled: number; drafts: number }
  unreachable: UnreachableSubsidiary[]
  truncated: number
  warnings: string[]
}

export async function getGroupAlerts(holdingId: string, access: GroupAccess, now?: Date): Promise<GroupAlerts> {
  const read = await readGroupMembers(holdingId, access, async (ref) => {
    const [widget, tasks, drafts] = await Promise.all([
      loadDeadlinesWidget(ref.id, now),
      countCompanyTasks(ref.id),
      prisma.accountingEntry.count({ where: { companyId: ref.id, status: 'draft' } }),
    ])
    const overdue = widget.deadlines
      .filter((d) => d.status.status === 'overdue')
      .map((d) => ({ companyId: ref.id, deadlineId: d.id, label: d.label, form: d.form, category: d.category, date: d.status.lateAfter }))
    return { overdue, unreconciled: tasks.unreconciledTransactions, drafts }
    // Unreconciled transactions and draft entries are counted with the rights of the company's own
    // counters: banking:read (tasks count) and entries:read (Écritures), KLEDG-R3-AUTHZ-08.
  }, mergePermissions(GROUP_BANK_READ, GROUP_ENTRIES_READ))
  const companies = read.members.map(({ ref, value }) => ({ company: linkOf(ref), overdue: value.overdue.length, unreconciled: value.unreconciled, drafts: value.drafts }))
  const overdue = read.members.flatMap((m) => m.value.overdue).sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, 'fr'))
  return {
    companies,
    overdue,
    totals: {
      overdue: overdue.length,
      unreconciled: companies.reduce((sum, c) => sum + c.unreconciled, 0),
      drafts: companies.reduce((sum, c) => sum + c.drafts, 0),
    },
    unreachable: read.unreachable,
    truncated: read.truncated,
    warnings: perimeterWarnings(read.unreachable.length, read.truncated),
  }
}
