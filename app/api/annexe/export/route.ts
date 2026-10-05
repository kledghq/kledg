import { companyRoute, fromQuery } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportAnnexe } from '@/lib/annexe/export-annexe.service'
import { AnnexeExportQuerySchema } from '@/lib/annexe/schemas'
import { userGroupAccess } from '@/lib/management-fees/access'

/** GET /api/annexe/export?companyId=&fiscalYearId=&format=pdf|md: the annexe as a file; 400 with what is missing. */
export const GET = companyRoute({ company: fromQuery(), permission: { reports: ['export'] }, query: AnnexeExportQuerySchema }, async ({ companyId, user, query }) => {
  await enforceRateLimit('export', user.id)
  return downloadResponse(await exportAnnexe(companyId, query.fiscalYearId, query.format, userGroupAccess(user)))
})
