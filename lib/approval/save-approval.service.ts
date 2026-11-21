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
import { calendarDayOf, formatIsoDateFr, isoDateToUtc } from '@/lib/utils/date'
import { todayParis } from '@/lib/accounting/entry-date'
import { writeAuditLog } from '@/lib/audit'
import type { ApprovalDetails } from './schemas'

/**
 * What the minutes say (#134): once the accounts are approved, the
 * decision as adopted is what the company keeps with its registers (C. com.
 * art. R221-3, R223-24, R225-106) and what the allocation entry justifies.
 * These fields no longer change; the filing ones (filedOn, filedOnline,
 * confidentiality, rcsCity) and the size data do.
 */
const MINUTES_FIELDS = [
  'decisionMode',
  'meeting',
  'chair',
  'secretary',
  'officers',
  'attendance',
  'statutoryRule',
  'votes',
  'allocation',
  'priorDividends',
  'nonDeductibleExpensesCents',
  'regulatedAgreements',
  'hasAuditor',
  'auditorName',
  'managementReport',
  'signatureCity',
] as const

/** JSON with sorted keys, to compare saved details whatever their key order. */
function canonical(value: unknown): string {
  // An empty list or object is the same as nothing (a default added since the save)
  if (Array.isArray(value)) return value.length === 0 ? 'null' : `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object' && Object.values(value).every((v) => v === undefined)) return 'null'
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export async function saveApproval(
  companyId: string,
  fiscalYearId: string,
  details: ApprovalDetails,
  userId: string,
  options: { now?: Date } = {},
): Promise<{ updatedAt: string }> {
  const fiscalYear = await ownedFiscalYear(companyId, fiscalYearId)
  const end = calendarDayOf(fiscalYear.endDate) as string
  const today = todayParis(options.now)
  for (const [label, value] of [
    ["La date d'approbation", details.approvedOn],
    ['La date de dépôt', details.filedOn],
  ] as const) {
    if (value && value > today) throw new ValidationError(`${label} ne peut pas être dans le futur\u00a0: indiquez-la une fois la décision prise ou le dépôt fait.`)
  }

  // Approved accounts: the minutes stay as adopted. Clearing the approval day alone (a mistake) reopens them.
  const saved = await prisma.accountsApproval.findUnique({
    where: { fiscalYearId_companyId: { fiscalYearId: fiscalYear.id, companyId } },
    select: { approvedOn: true, details: true },
  })
  if (saved?.approvedOn && details.approvedOn) {
    const before = (saved.details ?? {}) as Record<string, unknown>
    const after = details as unknown as Record<string, unknown>
    const changed = MINUTES_FIELDS.filter((key) => canonical(before[key]) !== canonical(after[key]))
    if (changed.length > 0 || calendarDayOf(saved.approvedOn) !== details.approvedOn) {
      throw new ValidationError(
        `Les comptes de l'exercice ${fiscalYear.year} sont approuvés depuis le ${formatIsoDateFr(calendarDayOf(saved.approvedOn) ?? '')}\u00a0: la décision ne se modifie plus telle qu'elle a été adoptée. Seules les informations de dépôt changent encore. Pour corriger une erreur de saisie, effacez d'abord la date d'approbation.`,
      )
    }
  }

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
