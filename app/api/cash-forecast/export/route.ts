import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { CashForecastQuerySchema } from '@/lib/cash-forecast/load-cash-forecast.service'
import { exportCashForecast } from '@/lib/cash-forecast/export-cash-forecast.service'

/** GET ?companyId=&horizon=&granularity=&components= : the forecast as a CSV file (periods, then the flows counted). */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['export'], banking: ['read'] }, query: CashForecastQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportCashForecast(companyId, query))
  },
)
