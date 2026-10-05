import { NextResponse } from 'next/server'
import { companyRoute, fromParam } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { writeAuditLog } from '@/lib/audit'
import { CashForecastSettingsBody } from '@/lib/cash-forecast/settings'
import { getCashForecastSettings, saveCashForecastSettings } from '@/lib/cash-forecast/cash-forecast-settings.service'

/** GET: the cash forecast settings (threshold, horizon, components; defaults when never saved). */
export const GET = companyRoute(
  { company: fromParam('id'), permission: { settings: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getCashForecastSettings(companyId), { headers: NO_CACHE_HEADERS }),
)

/** PUT: replaces the cash forecast settings (company settings: administrators). */
export const PUT = companyRoute(
  { company: fromParam('id'), permission: { settings: ['update'] }, body: CashForecastSettingsBody },
  async ({ companyId, body }) => {
    const saved = await saveCashForecastSettings(companyId, body)
    await writeAuditLog('info', 'Cash forecast settings changed', {
      action: 'UPDATE_CASH_FORECAST_SETTINGS',
      companyId,
      metadata: { thresholdCents: body.thresholdCents, horizonMonths: body.horizonMonths, components: body.components },
    })
    return NextResponse.json(saved)
  },
)
