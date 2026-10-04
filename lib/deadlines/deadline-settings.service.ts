/**
 * Settings of the deadline calendar (Company.deadlineSettings), read and
 * written for one company only: every query is keyed by the company the
 * route resolved. What is stored has been validated by DeadlineSettingsBody;
 * what is read goes through parseDeadlineSettings, so a stored value of
 * another shape falls back to the defaults field by field.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { parseDeadlineSettings, type DeadlineSettings } from './settings'

export interface DeadlineSettingsView {
  settings: DeadlineSettings
  /** True when the company never saved its settings: the defaults apply. */
  isDefault: boolean
}

export async function getDeadlineSettings(companyId: string): Promise<DeadlineSettingsView> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { deadlineSettings: true } })
  if (!company) throw new NotFoundError('Société non trouvée')
  return { settings: parseDeadlineSettings(company.deadlineSettings), isDefault: company.deadlineSettings === null }
}

export async function saveDeadlineSettings(companyId: string, settings: DeadlineSettings): Promise<DeadlineSettingsView> {
  const saved = await prisma.company.update({
    where: { id: companyId },
    data: { deadlineSettings: { ...settings } },
    select: { deadlineSettings: true },
  })
  return { settings: parseDeadlineSettings(saved.deadlineSettings), isDefault: false }
}
