import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { listDetectedSubscriptions } from '@/lib/subscriptions/detect-subscriptions.service'

/** GET /api/subscriptions?companyId=: recurring debits detected in the bank lines, with their decisions and totals. */
export const GET = companyRoute({ company: fromQuery(), permission: { banking: ['read'] } }, async ({ companyId }) =>
  NextResponse.json(await listDetectedSubscriptions(companyId), { headers: NO_CACHE_HEADERS }),
)
