import { NextResponse } from 'next/server'
import { companyRoute, fromQuery } from '@/lib/api/route'
import { getQontoStatus } from '@/lib/integrations/providers/qonto/manage-qonto-connection.service'

/** GET /api/qonto/status?companyId=: whether Qonto is connected, without credentials. */
export const GET = companyRoute(
  { company: fromQuery(), permission: { banking: ['read'] } },
  async ({ companyId }) => NextResponse.json(await getQontoStatus(companyId)),
)
