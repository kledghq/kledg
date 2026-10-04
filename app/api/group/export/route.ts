import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { userGroupAccess } from '@/lib/management-fees/access'
import { exportGroup, GroupExportQuerySchema } from '@/lib/group/export-group.service'

/**
 * GET /api/group/export?companyId=&fiscalYearId=&report=combined|participations&format=csv|xlsx:
 * the group view or the participations as a file. reports:export in the
 * holding, reports:read in each subsidiary read.
 */
export const GET = companyRoute(
  { company: fromQuery(), permission: { reports: ['export'] }, query: GroupExportQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportGroup(companyId, query, userGroupAccess(user)))
  },
)
