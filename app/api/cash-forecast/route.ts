import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { CashForecastQuerySchema, getCashForecast } from '@/lib/cash-forecast/load-cash-forecast.service'
import { CASH_FORECAST_PERMISSION } from '@/lib/cash-forecast/permissions'

/**
 * GET /api/cash-forecast?companyId=&horizon=3|6|12&granularity=month|week&components=
 * The cash forecast (lib/cash-forecast): today's bank balance, every known
 * flow of the horizon, and the projection of the components asked for (the
 * saved settings by default).
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: CASH_FORECAST_PERMISSION, query: CashForecastQuerySchema },
  async ({ companyId, query }) => NextResponse.json(await getCashForecast(companyId, query), { headers: NO_CACHE_HEADERS }),
)
