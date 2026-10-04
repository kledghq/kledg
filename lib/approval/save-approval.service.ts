/**
 * Saves what the user entered for the approval of a fiscal year's accounts
 * (one row per fiscal year, accounts_approvals). The details are validated
 * by the route (ApprovalDetailsSchema); this service checks what depends on
 * the company: the fiscal year is the company's (404 otherwise), the
 * attendance names its own shareholders, the dates are consistent. The
 * approval and filing days are copied to their columns for the deadline
 * calendar (lib/deadlines). Written with closing:execute, audited.
 */

import { prisma } from '@/lib/prisma'
import { ownedFiscalYear } from '@/lib/accounting/manage-fiscal-years.service'
import { ValidationError } from '@/lib/accounting/errors'
import { calendarDayOf, isoDateToUtc } from '@/lib/utils/date'
import { writeAuditLog } from '@/lib/audit'
import type { ApprovalDetails } from './schemas'

export async function saveApproval(
  companyId: string,
  fiscalYearId: string,
  details: ApprovalDetails,
  userId: string,
): Promise<{ updatedAt: string }> {
  const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
  const end = calendarDayOf(fiscalYear.endDate) as string

  const ids = details.attendance.map((a) => a.shareholderId)
  if (new Set(ids).size !== ids.length) throw new ValidationError('Un associé figure deux fois dans la feuille de présence.')
  if (ids.length > 0) {
    const owned = await prisma.shareholder.count({ where: { companyId, id: { in: ids } } })
    if (owned !== ids.length) throw new ValidationError("La feuille de présence cite un associé qui n'est pas enregistré pour cette société.")
  }
  for (const [label, value] of [
    ["La date de l'assemblée ou de la décision", details.meeting.date],
    ["La date d'approbation", details.approvedOn],
    ['La date de dépôt', details.filedOn],
  ] as const) {
    if (value && value <= end) throw new ValidationError(`${label} doit être postérieure à la clôture de l'exercice (${end.split('-').reverse().join('/')}).`)
  }
  if (details.meeting.convocationDate && details.meeting.date && details.meeting.convocationDate > details.meeting.date) {
    throw new ValidationError("La date de convocation doit précéder la date de l'assemblée.")
  }
  if (details.filedOn && details.approvedOn && details.filedOn < details.approvedOn) {
    throw new ValidationError("La date de dépôt au greffe ne peut pas précéder la date d'approbation.")
  }

  const approvedOn = details.approvedOn ? isoDateToUtc(details.approvedOn) : null
  const filedOn = details.filedOn ? isoDateToUtc(details.filedOn) : null
  const row = await prisma.accountsApproval.upsert({
    where: { fiscalYearId_companyId: { fiscalYearId: fiscalYear.id, companyId } },
    create: { companyId, fiscalYearId: fiscalYear.id, details, approvedOn, filedOn, updatedById: userId },
    update: { details, approvedOn, filedOn, updatedById: userId },
    select: { updatedAt: true },
  })
  await writeAuditLog('info', `Approbation des comptes de l'exercice ${fiscalYear.year} enregistrée`, {
    action: 'SAVE_ACCOUNTS_APPROVAL',
    companyId,
    metadata: { fiscalYearId: fiscalYear.id, approvedOn: details.approvedOn ?? null, filedOn: details.filedOn ?? null },
  })
  return { updatedAt: row.updatedAt.toISOString() }
}
