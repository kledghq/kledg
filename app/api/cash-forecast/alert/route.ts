import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { getCashForecastAlert } from '@/lib/cash-forecast/load-cash-forecast.service'
import { CASH_FORECAST_PERMISSION } from '@/lib/cash-forecast/permissions'

/**
 * GET /api/cash-forecast/alert?companyId= : the threshold alert of the
 * dashboard, `{ alert }`, null when no threshold is saved (nothing is
 * computed then) or when the projection stays above it.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: CASH_FORECAST_PERMISSION },
  async ({ companyId }) => NextResponse.json({ alert: await getCashForecastAlert(companyId) }, { headers: NO_CACHE_HEADERS }),
)
