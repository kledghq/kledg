import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportLiasse, LiasseExportQuerySchema } from '@/lib/liasse/export-liasse.service'
import { userGroupAccess } from '@/lib/management-fees/access'

/** GET /api/reports/liasse/export?companyId=&fiscalYearId=&format=pdf|csv: the liasse fiscale as a file. */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['export'] }, query: LiasseExportQuerySchema }, async ({ companyId, user, query }) => {
  await enforceRateLimit('export', user.id)
  return downloadResponse(await exportLiasse(companyId, query, userGroupAccess(user)))
})
