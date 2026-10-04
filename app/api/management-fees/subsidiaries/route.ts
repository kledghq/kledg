import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { NO_CACHE_HEADERS } from '@/lib/api/cache-headers'
import { userGroupAccess } from '@/lib/management-fees/access'
import { listSubsidiaryCandidates } from '@/lib/management-fees/holding'

/**
 * GET /api/management-fees/subsidiaries?companyId=: the companies that record
 * the holding among their shareholders and that the user may read.
 */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['read'] } }, async ({ companyId, user }) =>
  NextResponse.json({ subsidiaries: await listSubsidiaryCandidates(companyId, user, userGroupAccess(user)) }, { headers: NO_CACHE_HEADERS }),
)
