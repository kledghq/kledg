import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getCashForecastStatus } from '@/lib/cash-forecast/load-cash-forecast.service'
import { CASH_FORECAST_PERMISSION } from '@/lib/cash-forecast/permissions'

/**
 * GET /api/cash-forecast/alert?companyId= : the threshold status of the
 * dashboard and of the simple home, `{ thresholdCents, horizonMonths, alert }`,
 * asked by the page once displayed. Without a saved threshold nothing is
 * computed; `alert` is null when the projection stays above it.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: CASH_FORECAST_PERMISSION },
  async ({ companyId }) => NextResponse.json(await getCashForecastStatus(companyId), { headers: NO_CACHE_HEADERS }),
)
