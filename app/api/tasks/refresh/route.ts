import { NextResponse } from 'next/server'
import { companyRoute, fromBody } from '@/lib/api/route'
import { RefreshCompanyBodySchema, refreshCompany } from '@/lib/tasks/refresh-company'
import { limitBankCalls } from '@/lib/banking/guard'

export const POST = companyRoute(
  { company: fromBody(), permission: { banking: ['reconcile'] }, body: RefreshCompanyBodySchema },
  async ({ companyId, body }) => {
    await limitBankCalls(companyId)
    return NextResponse.json(await refreshCompany(companyId, body.maxDays))
  },
)
