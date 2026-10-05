import { companyRoute, fromParam } from '@/lib/api/route'
import { downloadResponse } from '@/lib/api/download'
import { enforceRateLimit } from '@/lib/rate-limit'
import { exportRemuneration, RemunerationExportQuerySchema } from '@/lib/remuneration/export-remuneration.service'
import { REMUNERATION_EXPORT } from '@/lib/remuneration/permissions'

/** GET /api/companies/[id]/remuneration/export?fiscalYearId=&scenarioId=&inputs=&format=pdf|csv: the simulation as a file. */
export const GET = companyRoute(
  { company: fromParam(), permission: REMUNERATION_EXPORT, query: RemunerationExportQuerySchema },
  async ({ companyId, query, user }) => {
    await enforceRateLimit('export', user.id)
    return downloadResponse(await exportRemuneration(companyId, query))
  },
)
