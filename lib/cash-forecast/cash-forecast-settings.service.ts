/**
 * Settings of the cash forecast (Company.cashForecastSettings), read and
 * written for one company only: every query is keyed by the company the
 * route resolved. What is stored has been validated by
 * CashForecastSettingsBody; what is read goes through
 * parseCashForecastSettings, so a stored value of another shape falls back
 * to the defaults field by field.
 */

import { prisma } from '@/lib/prisma'
import { NotFoundError } from '@/lib/accounting/errors'
import { parseCashForecastSettings, type CashForecastSettings } from './settings'

export interface CashForecastSettingsView {
  settings: CashForecastSettings
  /** True when the company never saved its settings: the defaults apply. */
  isDefault: boolean
}

export async function getCashForecastSettings(companyId: string): Promise<CashForecastSettingsView> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { cashForecastSettings: true } })
  if (!company) throw new NotFoundError('Société non trouvée')
  return { settings: parseCashForecastSettings(company.cashForecastSettings), isDefault: company.cashForecastSettings === null }
}

export async function saveCashForecastSettings(companyId: string, settings: CashForecastSettings): Promise<CashForecastSettingsView> {
  const saved = await prisma.company.update({
    where: { id: companyId },
    data: { cashForecastSettings: { thresholdCents: settings.thresholdCents, horizonMonths: settings.horizonMonths, components: [...settings.components] } },
    select: { cashForecastSettings: true },
  })
  return { settings: parseCashForecastSettings(saved.cashForecastSettings), isDefault: false }
}
